import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {hashDevPassword,verifyDevPassword,validateDevVehicle,validateImport} from '../site-backend/dev-api.js';
import {handleApi} from '../site-backend/api.js';
import {createWorker} from '../worker.js';
import {digest} from '../site-backend/auth.js';

// Isolated SQL contract fake: never opens a network connection or reads DB env.
const password='dev-test-only-password',salt='01'.repeat(16);
const hash=`pbkdf2-sha256$100000$${salt}$${pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex')}`;
const env={DEV_ADMIN_PASSWORD_HASH:hash};
function database(){
  const db={sessions:new Map(),limits:new Map(),vehicles:new Map([[1,{vehicle_id:1}],[2,{vehicle_id:2}]]),records:[],calls:[],depth:0,active:false,failInsert:0,inserts:0};
  db.begin=async(...args)=>{const snapshot=structuredClone({sessions:db.sessions,limits:db.limits,records:db.records,vehicles:db.vehicles});db.depth++;try{return await args.at(-1)(db);}catch(e){Object.assign(db,snapshot);throw e;}finally{db.depth--;}};
  db.end=async()=>{};
  db.unsafe=async(q,v=[])=>{
    db.calls.push({q,v,depth:db.depth});
    if(q.startsWith('SELECT pg_advisory')||q.startsWith('CREATE TABLE'))return [];
    if(q.startsWith('INSERT INTO auth_login_limits')){if(!db.limits.has(v[0]))db.limits.set(v[0],{attempts:0,window_start:new Date()});return [];}
    if(q.startsWith('SELECT * FROM auth_login_limits'))return [db.limits.get(v[0])];
    if(q.startsWith('UPDATE auth_login_limits SET attempts=0')){const r={attempts:0,window_start:new Date()};db.limits.set(v[0],r);return [r];}
    if(q.startsWith('UPDATE auth_login_limits SET attempts=attempts+1')){for(const b of v[0])db.limits.get(b).attempts++;return [];}
    if(q.startsWith('DELETE FROM auth_login_limits')){db.limits.delete(v[0]);return [];}
    if(q.startsWith('INSERT INTO dev_auth_sessions')){db.sessions.set(v[0],{session_hash:v[0],csrf_token:v[1],credential_version:v[2],expires_at:Date.now()+28800000});return [];}
    if(q.startsWith('SELECT session_hash,csrf_token')){const s=db.sessions.get(v[0]);return s&&s.credential_version===v[1]&&s.expires_at>Date.now()?[s]:[];}
    if(q.startsWith('DELETE FROM dev_auth_sessions WHERE session_hash')){db.sessions.delete(v[0]);return [];}
    if(q.startsWith('DELETE FROM dev_auth_sessions WHERE expires_at')){for(const [k,s] of db.sessions)if(s.expires_at<=Date.now())db.sessions.delete(k);return [];}
    if(q.startsWith('SELECT 1 FROM vehicles WHERE upper'))return [...db.vehicles.values()].some(row=>row.license_plate?.trim().toUpperCase()===v[0]&&row.vehicle_id!==v[1])?[{exists:1}]:[];
    if(q.startsWith('INSERT INTO vehicles')){assert(db.depth>0);const vehicle_id=Math.max(0,...db.vehicles.keys())+1,row={vehicle_id,license_plate:v[0],vehicle_model:v[1],vehicle_status:v[2]};db.vehicles.set(vehicle_id,row);return [row];}
    if(q.startsWith("UPDATE vehicles SET vehicle_status='retired'")){assert(db.depth>0);const row={...db.vehicles.get(v[0]),vehicle_status:'retired'};db.vehicles.set(v[0],row);return [row];}
    if(q.startsWith('SELECT vehicle_id FROM vehicles')||q.startsWith('SELECT * FROM vehicles WHERE'))return db.vehicles.has(v[0])?[db.vehicles.get(v[0])]:[];
    if(q.startsWith('SELECT 1 FROM dispatches'))return db.active?[{exists:1}]:[];
    if(q.startsWith('UPDATE vehicles SET')){const row={vehicle_id:v[3],license_plate:v[0],vehicle_model:v[1],vehicle_status:v[2]};db.vehicles.set(v[3],row);return [row];}
    if(q.startsWith('INSERT INTO maintenance_records')||q.startsWith('INSERT INTO refueling_records')){assert(db.depth>0);if(++db.inserts===db.failInsert)throw Object.assign(new Error('simulated duplicate'),{code:'23505'});db.records.push({q,v});return [{vehicle_id:v[0]}];}
    throw new Error('Unhandled fake query: '+q);
  };return db;
}
async function call(db,path,method='GET',body,headers={},configuration=env){return handleApi(new Request('https://fleet.test/api/dev/'+path,{method,headers,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),configuration,()=>db);}
async function login(db){const r=await call(db,'login','POST',{username:'DEV',password});assert.equal(r.status,200);const data=await r.json();return {Cookie:r.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':data.csrf_token};}
const maintenance=(vehicle_id=1,maintenance_date='2026-11-10')=>({vehicle_id,maintenance_date,maintenance_item:'Oil',maintenance_cost:'123.45'});
const vehicle={license_plate:' abc-123 ',vehicle_model:' New custom model ',vehicle_status:'available'};

test('PBKDF2 interoperates with independent Node implementation and rejects malformed credentials',async()=>{
  assert.equal(await hashDevPassword(password,salt),hash);assert.equal(await verifyDevPassword(password,hash),true);
  for(const [p,h] of [['wrong',hash],['',hash],['a'.repeat(129),hash],[null,hash],[password,'plaintext'],[password,hash.replace('100000','1')]])assert.equal(await verifyDevPassword(p,h),false);
  assert.notEqual(await hashDevPassword(password),await hashDevPassword(password));
});
test('unset or malformed DEV configuration fails closed without SQL',async()=>{for(const configuration of [{},{DEV_ADMIN_PASSWORD_HASH:'plaintext'}]){const db=database();assert.equal((await call(db,'login','POST',{username:'DEV',password},{},configuration)).status,503);assert.equal(db.calls.length,0);}});
test('employee cookies, forged cookies and missing cookies never authorize DEV',async()=>{for(const Cookie of ['',`fleetflow_session=${'a'.repeat(64)}`,`fleetflow_dev_session=${'b'.repeat(64)}`])assert.equal((await call(database(),'session','GET',undefined,{Cookie})).status,401);});
test('DEV cookie security, session lookup, CSRF, expiry, credential rotation and logout revocation',async()=>{
  const db=database(),r=await call(db,'login','POST',{username:'dev',password});assert.equal(r.status,200);const cookie=r.headers.get('Set-Cookie');for(const flag of ['Path=/api/dev','HttpOnly','Secure','SameSite=Strict','Max-Age=28800'])assert(cookie.includes(flag));
  const data=await r.json(),headers={Cookie:cookie.split(';')[0],'X-CSRF-Token':data.csrf_token};
  assert.equal((await call(db,'session','GET',undefined,headers)).status,200);
  assert.equal((await call(db,'logout','POST',{}, {Cookie:headers.Cookie})).status,403);
  assert.equal((await call(db,'logout','POST',{}, {...headers,'X-CSRF-Token':'wrong'})).status,403);
  const changed={DEV_ADMIN_PASSWORD_HASH:await hashDevPassword('changed-password',salt)};
  assert.equal((await call(db,'session','GET',undefined,headers,changed)).status,401);
  const stored=db.sessions.get(await digest(headers.Cookie.split('=')[1]));stored.expires_at=Date.now()-1;
  assert.equal((await call(db,'session','GET',undefined,headers)).status,401);stored.expires_at=Date.now()+10000;
  const logout=await call(db,'logout','POST',{},headers);assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal((await call(db,'session','GET',undefined,headers)).status,401);
});
test('login rejects malformed JSON, oversized bodies, wrong shapes and wrong credentials; rate limit persists',async()=>{
  const db=database();for(const body of ['{',null,[],{username:'DEV',password,role:'admin'},{username:1,password}])assert.equal((await call(db,'login','POST',body)).status,422);
  assert.equal((await call(db,'login','POST',' '.repeat(32769))).status,413);
  for(let i=0;i<10;i++)assert.equal((await call(db,'login','POST',{username:'DEV',password:'wrong'})).status,401);
  assert.equal((await call(db,'login','POST',{username:'DEV',password})).status,429);assert.equal(db.sessions.size,0);
});
test('vehicle validation is strict and permits custom model',()=>{
  assert.deepEqual(validateDevVehicle(vehicle),{license_plate:'ABC-123',vehicle_model:'New custom model',vehicle_status:'available'});
  for(const body of [null,[],{...vehicle,unexpected:1},{...vehicle,license_plate:' '},{...vehicle,license_plate:'ß'.repeat(20)},{...vehicle,vehicle_model:'x'.repeat(101)},{...vehicle,vehicle_status:'disabled'}])assert.throws(()=>validateDevVehicle(body),{status:422});
});
test('CSV-derived batch validation rejects duplicate vehicle/date rows, bad dates, numbers and fields',()=>{
  assert.equal(validateImport({type:'maintenance',records:[maintenance(),maintenance(2)]}).records.length,2);
  for(const body of [{type:'other',records:[maintenance()]},{type:'maintenance',records:[]},{type:'maintenance',records:Array(101).fill(maintenance())},{type:'maintenance',records:[maintenance(),maintenance()]},{type:'maintenance',records:[maintenance(1,'2026-02-30')]},{type:'maintenance',records:[{...maintenance(),maintenance_cost:'1; DROP TABLE vehicles'}]},{type:'maintenance',records:[{...maintenance(),injected:'x'}]},{type:'refueling',records:[{vehicle_id:1,refueling_date:'2026-11-10',fuel_liters:0,fuel_cost:1}]}])assert.throws(()=>validateImport(body),{status:422});
});
test('batch inserts are transaction-bound, lock in sorted order and bind user strings rather than interpolate',async()=>{
  const db=database(),headers=await login(db),payload="Oil'); DROP TABLE vehicles;--";
  const r=await call(db,'import','POST',{type:'maintenance',records:[{...maintenance(2),maintenance_item:payload},maintenance(1)]},headers);assert.equal(r.status,201);assert.deepEqual(await r.json(),{created:2});
  const locks=db.calls.filter(c=>c.q.startsWith('SELECT vehicle_id FROM vehicles'));assert.deepEqual(locks.map(c=>c.v[0]),[1,2]);
  const inserts=db.calls.filter(c=>c.q.startsWith('INSERT INTO maintenance_records'));assert.equal(inserts.length,2);assert(inserts.every(c=>c.depth===1&&!c.q.includes(payload)));assert.equal(inserts[0].v[2],payload);assert.match(inserts[0].q,/VALUES \(\$1,\$2,\$3,\$4\)/);
});
test('batch errors roll back all inserts; unknown vehicle aborts before writes',async()=>{
  for(const missing of [false,true]){const db=database(),headers=await login(db);if(!missing)db.failInsert=2;
    const r=await call(db,'import','POST',{type:'maintenance',records:[maintenance(),maintenance(missing?999:2)]},headers);assert.equal(r.status,missing?422:409);assert.equal(db.records.length,0);if(missing)assert.equal(db.inserts,0);
  }
});
test('vehicle editing requires valid ID, existing vehicle and no open dispatch for disabling',async()=>{
  const db=database(),headers=await login(db);assert.equal((await call(db,'vehicles/0','PUT',vehicle,headers)).status,422);assert.equal((await call(db,'vehicles/999','PUT',vehicle,headers)).status,404);
  db.active=true;assert.equal((await call(db,'vehicles/1','PUT',{...vehicle,vehicle_status:'maintenance'},headers)).status,409);
  const r=await call(db,'vehicles/1','PUT',vehicle,headers);assert.equal(r.status,200);assert.equal((await r.json()).vehicle_model,'New custom model');
});
test('worker gates legacy routes, foreign Origin and methods before backend; DEV unknown routes return 404',async()=>{
  let calls=0;const worker=createWorker({},async()=>{calls++;return Response.json({});}),configuration={DB_HOST:'fake',DB_NAME:'fake',DB_USER:'fake',DB_PASSWORD:'fake'};
  for(const [path,method,status,headers] of [['/api/employees','GET',404,{}],['/api/vehicles/1','PUT',404,{}],['/api/dev/login','PATCH',405,{}],['/api/dev/login','POST',403,{Origin:'https://evil.test'}]])assert.equal((await worker.fetch(new Request('https://fleet.test'+path,{method,headers}),configuration)).status,status);
  assert.equal(calls,0);assert.equal((await worker.fetch(new Request('https://fleet.test/api/dev/session'),configuration)).status,200);assert.equal(calls,1);
  const db=database(),auth=await login(db);for(const [path,method] of [['employees','GET'],['import/extra','POST'],['vehicles/1/extra','PUT'],['login/extra','POST']])assert.equal((await call(db,path,method,method==='GET'?undefined:{},auth)).status,404);
});
test('individual maintenance and refueling creation use validated parameterized transaction writes',async()=>{
  const db=database(),headers=await login(db);
  assert.equal((await call(db,'maintenance','POST',maintenance(),headers)).status,201);
  const fuel={vehicle_id:2,refueling_date:'2026-11-11',fuel_liters:'40.123',fuel_cost:'2100.50'};
  assert.equal((await call(db,'refueling','POST',fuel,headers)).status,201);
  const insert=db.records.at(-1);assert.match(insert.q,/^INSERT INTO refueling_records \(vehicle_id,refueling_date,fuel_liters,fuel_cost\) VALUES \(\$1,\$2,\$3,\$4\)/);assert.deepEqual(insert.v,Object.values(fuel));
  assert.throws(()=>validateImport({type:'refueling',records:[fuel,{...fuel}]}),{status:422});
  assert.equal((await call(db,'maintenance','POST',{...maintenance(),vehicle_id:3},headers)).status,422);
});

test('DEV vehicle creation and archive reject employees, missing sessions and bad CSRF before writes',async()=>{
  const db=database(),auth=await login(db);for(const [path,method,body] of [['vehicles','POST',vehicle],['vehicles/1','DELETE',undefined]]){
    for(const headers of [{},{Cookie:`fleetflow_session=${'a'.repeat(64)}`},{Cookie:auth.Cookie},{...auth,'X-CSRF-Token':'wrong'}]){
      const before=db.vehicles.size,r=await call(db,path,method,body,headers);assert.equal(r.status,headers.Cookie===auth.Cookie?403:401);assert.equal(db.vehicles.size,before);
    }
  }assert.equal(db.calls.filter(c=>c.q.startsWith('INSERT INTO vehicles')||c.q.startsWith('UPDATE vehicles SET')).length,0);
});
test('DEV creates an assigned ID, trims and normalizes plate, rejects duplicate including archived and legacy lowercase plates',async()=>{
  const db=database(),auth=await login(db),r=await call(db,'vehicles','POST',vehicle,auth);assert.equal(r.status,201);
  const row=await r.json();assert.equal(row.vehicle_id,3);assert.equal(row.license_plate,'ABC-123');assert.equal(row.vehicle_model,'New custom model');
  assert.equal((await call(db,'vehicles','POST',{...vehicle,license_plate:'aBc-123'},auth)).status,409);assert.equal(db.vehicles.size,3);
  db.vehicles.get(3).vehicle_status='retired';assert.equal((await call(db,'vehicles','POST',vehicle,auth)).status,409);
  db.vehicles.get(3).license_plate=' abc-123 ';assert.equal((await call(db,'vehicles/1','PUT',vehicle,auth)).status,409);
  assert.equal((await call(db,'vehicles/3','PUT',vehicle,auth)).status,200);
  for(const body of [{...vehicle,license_plate:' '},{...vehicle,vehicle_id:100},{...vehicle,vehicle_status:'other'}])assert.equal((await call(db,'vehicles','POST',body,auth)).status,422);
});
test('DEV delete archives reversibly, protects all history, rejects missing IDs and is idempotent',async()=>{
  const db=database(),auth=await login(db);db.vehicles.set(1,{vehicle_id:1,...vehicle,license_plate:'ABC-123'});
  db.records.push({vehicle_id:1,type:'maintenance'},{vehicle_id:1,type:'refueling'},{vehicle_id:1,type:'returned-trip'});const history=structuredClone(db.records);
  assert.equal((await call(db,'vehicles/0','DELETE',undefined,auth)).status,422);assert.equal((await call(db,'vehicles/999','DELETE',undefined,auth)).status,404);
  for(let i=0;i<2;i++){const r=await call(db,'vehicles/1','DELETE',undefined,auth);assert.equal(r.status,200);const row=await r.json();assert.equal(row.archived,true);assert.equal(row.vehicle_id,1);assert.equal(row.vehicle_status,'retired');}
  assert.equal(db.vehicles.size,2);assert.deepEqual(db.records,history);assert.equal(db.calls.some(c=>/^DELETE FROM (vehicles|dispatches|maintenance_records|refueling_records)/.test(c.q)),false);
  assert.equal((await call(db,'vehicles/1','PUT',vehicle,auth)).status,200);assert.equal(db.vehicles.get(1).vehicle_status,'available');assert.deepEqual(db.records,history);
  const lock=db.calls.findIndex(c=>c.q.startsWith('SELECT * FROM vehicles WHERE')&&c.q.includes('FOR UPDATE'));const update=db.calls.findIndex(c=>c.q.startsWith("UPDATE vehicles SET vehicle_status='retired'"));assert(lock<update);assert.equal(db.calls[update].depth,1);
});
test('open or upcoming reservations block archive without partial changes',async()=>{
  const db=database(),auth=await login(db);db.vehicles.set(1,{vehicle_id:1,...vehicle});const before=structuredClone(db.vehicles.get(1));db.active=true;
  const r=await call(db,'vehicles/1','DELETE',undefined,auth);assert.equal(r.status,409);assert.match((await r.json()).detail,/歸還.*預約/);assert.deepEqual(db.vehicles.get(1),before);
});
