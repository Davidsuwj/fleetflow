import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Evaluate the actual pure renderer without bootstrapping the app or contacting a DB.
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const escape=source.slice(source.indexOf('const esc='),source.indexOf('const paths='));
const render=source.slice(source.indexOf('function monthlyApplicationsChart('),source.indexOf('function renderStatistics('));
const chart=vm.runInNewContext(`${escape}\n${render}\nmonthlyApplicationsChart`);
const months=counts=>counts.map((applications,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,applications}));
for(const [name,counts] of Object.entries({zero:[0,0,0,0,0,0],single:[0,0,1,0,0,0],mixed:[2,5,1,9,0,3],large:[100,25,0,150,3,80]})){
  test(`${name}: six monthly labels, readable counts and finite line geometry`,()=>{
    const html=chart(months(counts));
    assert.equal((html.match(/class="monthly-chart-point"/g)||[]).length,6);
    assert.equal((html.match(/<wbr>/g)||[]).length,6);
    assert.match(html,/role="img" aria-label=/);
    assert.doesNotMatch(html,/NaN|Infinity|cost-bar/);
    counts.forEach((n,i)=>assert.ok(html.includes(`2026-${String(i+1).padStart(2,'0')}：${n} 筆`)));
    const points=html.match(/points="([^"]+)"/)[1].split(' ').map(p=>p.split(',').map(Number));
    assert.equal(points.length,6);
    points.forEach(([x,y],i)=>{assert.ok(x>0&&x<100&&y>=0&&y<=100);if(counts[i]===0)assert.equal(y,100);});
    const ticks=[...html.matchAll(/class="monthly-chart-grid"[^>]*><span>(\d+)<\/span>/g)].map(m=>Number(m[1]));
    assert.equal(ticks.length,5);assert.equal(ticks.at(-1),0);assert.ok(ticks[0]>=Math.max(...counts));
    assert.ok(ticks.every(Number.isInteger));assert.equal(new Set(ticks).size,5);
    if(name==='zero')assert.match(html,/近六個月尚無申請/);
  });
}
test('month labels are escaped in visual and accessible text',()=>{
  const data=months([0,1,2,3,4,5]);data[0].month='<img src=x onerror=alert(1)>';
  const html=chart(data);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
