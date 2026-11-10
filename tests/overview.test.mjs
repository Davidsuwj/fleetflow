import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real homepage renderer with isolated fixtures, without API or DB writes.
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const setup=source.slice(0,source.indexOf("$('#today').textContent"));
const helpers=source.slice(source.indexOf('function empty('),source.indexOf('function profile('));
const renderer=source.slice(source.indexOf('function renderOverview('),source.indexOf('function requestStatus('));
const now=Date.parse('2026-11-10T12:00:00Z');
class FixedDate extends Date{
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return now;}
}
function render(dispatches,extra={}){
  const content={innerHTML:''};
  const fixture={applications:dispatches.map(t=>({application_id:t.dispatch_id})),dispatches,...extra};
  vm.runInNewContext(`${setup}\n${helpers}\n${renderer}\ncontext=fixture;renderOverview();`,{
    document:{querySelector(selector){assert.equal(selector,'#page-content');return content;}},
    fixture,Date:FixedDate,
  });
  return content.innerHTML;
}
const trip=(id,start,changes={})=>({dispatch_id:id,license_plate:`TEST-${id}`,purpose:`Trip ${id}`,
  actual_start_date:start,actual_end_date:new Date(Date.parse(start)+3600000).toISOString(),returned_at:null,...changes});
const count=html=>(html.match(/<li class="trip-details">/g)||[]).length;

test('overview shows every reserved and active trip, in chronological order, excluding returned trips',()=>{
  const trips=[trip(3,'2026-11-12T10:00:00Z'),trip(1,'2026-11-10T11:30:00Z'),
    trip(4,'2026-11-09T10:00:00Z',{returned_at:'2026-11-09T11:00:00Z'}),trip(2,'2026-11-11T10:00:00Z')];
  trips.forEach(Object.freeze);Object.freeze(trips);
  const html=render(trips);
  assert.equal(count(html),3);
  assert(html.indexOf('TEST-1')<html.indexOf('TEST-2'));
  assert(html.indexOf('TEST-2')<html.indexOf('TEST-3'));
  assert.equal((html.match(/class="badge upcoming"/g)||[]).length,2);
  assert.equal((html.match(/class="badge dispatched"/g)||[]).length,1);
  assert.doesNotMatch(html,/TEST-4/);
  assert.match(html,/<small>尚未歸還<\/small><strong>3<\/strong>/);
  assert.match(html,/<small>已完成<\/small><strong>1<\/strong>/);
  assert.match(html,/<ul class="trip-list" aria-label="已預約與使用中的行程">/);
  assert.deepEqual(trips.map(t=>t.dispatch_id),[3,1,4,2]);
});
test('overview has no one-trip or fixed-count limit',()=>{
  const trips=Array.from({length:25},(_,i)=>trip(i+1,new Date(now+(i+1)*86400000).toISOString()));
  const html=render(trips);assert.equal(count(html),25);
  for(const t of trips)assert(html.includes(`<h3>${t.license_plate}</h3>`));
});
test('a trip remains active after its planned return until it is actually returned',()=>{
  const html=render([trip(1,'2026-11-01T10:00:00Z')]);
  assert.equal(count(html),1);assert.match(html,/class="badge dispatched"/);
});
test('a trip becomes active exactly at its start time',()=>{
  const html=render([trip(1,new Date(now).toISOString()),trip(2,new Date(now+1).toISOString())]);
  assert.equal((html.match(/class="badge dispatched"/g)||[]).length,1);
  assert.equal((html.match(/class="badge upcoming"/g)||[]).length,1);
});
test('overview retains empty state for no trips or only returned trips',()=>{
  for(const trips of [[],[trip(1,'2026-11-01T10:00:00Z',{returned_at:'2026-11-01T11:00:00Z'})]]){
    const html=render(trips);assert.equal(count(html),0);assert.match(html,/目前沒有行程/);assert.doesNotMatch(html,/class="trip-list"/);
  }
});
test('overview renders only authenticated employee dispatches, not team bookings or unassigned applications',()=>{
  const html=render([trip(1,'2026-11-11T10:00:00Z')],{
    team_bookings:[trip(2,'2026-11-11T12:00:00Z')],
    applications:[{purpose:'Pending request only',approval_status:'pending'}],
  });
  assert.equal(count(html),1);assert.match(html,/TEST-1/);assert.doesNotMatch(html,/TEST-2|Pending request only/);
});
test('every trip escapes untrusted text and displays start and return dates',()=>{
  const html=render([trip(1,'2026-11-11T00:00:00Z',{license_plate:'<b>ABC</b>',purpose:'<img src=x onerror=alert(1)>&'})]);
  assert.doesNotMatch(html,/<img|<b>ABC/);assert.match(html,/&lt;b&gt;ABC&lt;\/b&gt;/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;&amp;/);
  assert.match(html,/<dt>出發<\/dt><dd>11\/11\s08:00<\/dd>/);
  assert.match(html,/<dt>歸還<\/dt><dd>11\/11\s09:00<\/dd>/);
});
