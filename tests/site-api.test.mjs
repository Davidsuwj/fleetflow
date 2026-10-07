import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import {openDatabase} from '../site-backend/db.js';
import {handleApi} from '../site-backend/api.js';

const schema='fleetflow_test_'+randomBytes(6).toString('hex');
const env=process.env;
before(async()=>{
  const sql=openDatabase(env);
  try{await sql.unsafe(fs.readFileSync('backend/schema.sql','utf8').replaceAll('fleetflow',schema)).simple();}
  finally{await sql.end({timeout:1});}
});
after(async()=>{
  assert.match(schema,/^fleetflow_test_[a-f0-9]{12}$/);
  const sql=openDatabase(env);
  try{await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`).simple();}finally{await sql.end({timeout:1});}
});
const sessions=new Map();let lastSession;const TEST_PASSWORD='test-password-2026';
async function api(path,method='GET',body,authOverride){
  const actor=new URL('https://fleetflow.test/api/'+path).searchParams.get('employee_id');
  const auth=authOverride===undefined?(actor?sessions.get(Number(actor)):lastSession):authOverride;
  const request=new Request('https://fleetflow.test/api/'+path,{method,headers:{'Content-Type':'application/json',...(auth||{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const response=await handleApi(request,env,()=>openDatabase(env,schema));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('Set-Cookie')};
}
async function resources(){
  const tag=randomBytes(4).toString('hex');
  const department=await api('departments','POST',{department_name:'Test '+tag});assert.equal(department.status,201);
  const employee=await api('employees','POST',{department_id:department.data.department_id,employee_name:'Test Employee',password:TEST_PASSWORD,phone_numbers:['0911000000','0912000000','0911000000']});assert.equal(employee.status,201);
  const login=await api('auth/login','POST',{employee_code:employee.data.employee_code,password:TEST_PASSWORD},null);assert.equal(login.status,200);lastSession={Cookie:login.cookie.split(';')[0],'X-CSRF-Token':login.data.csrf_token};sessions.set(employee.data.employee_id,lastSession);
  const vehicle=await api('vehicles','POST',{license_plate:'TEST-'+tag});assert.equal(vehicle.status,201);
  const start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString();
  const applicationBody={employee_id:employee.data.employee_id,purpose:'Integration test',requested_start_date:start,requested_end_date:end};
  const application=await api('applications','POST',applicationBody);assert.equal(application.status,201);
  return {department:department.data,employee:employee.data,vehicle:vehicle.data,application:application.data,applicationBody,
    dispatchBody:{application_id:application.data.application_id,vehicle_id:vehicle.data.vehicle_id,actual_start_date:start,actual_end_date:end}};
}
const approve=id=>api(`applications/${id}/review`,'POST',{approval_status:'approved'});

test('CRUD, multivalue phones, search results and restricted delete',async()=>{
  const r=await resources();assert.equal(r.employee.phone_numbers.length,2);
  assert.equal((await api('departments/'+r.department.department_id,'DELETE')).status,409);
  assert.equal((await api('employees/'+r.employee.employee_id,'PUT',{department_id:r.department.department_id,employee_name:'Updated',phone_numbers:['02-1234']})).status,200);
  const staff=await api('employees');assert.equal(staff.status,200);assert.deepEqual(staff.data.find(v=>v.employee_id===r.employee.employee_id).phone_numbers,['02-1234']);
  const unused=await api('departments','POST',{department_name:'Unused '+randomBytes(4).toString('hex')});assert.equal((await api('departments/'+unused.data.department_id,'DELETE')).status,200);
});
test('vehicle model and plate validation',async()=>{
  const r=await resources();assert.equal(r.vehicle.vehicle_model,'Rolls-Royce Cullinan 6.75 V12');
  assert.equal((await api('vehicles','POST',{license_plate:r.vehicle.license_plate})).status,409);
  assert.equal((await api('vehicles','POST',{license_plate:'WRONG',vehicle_model:'Other car'})).status,422);
  assert.equal((await api('vehicles/'+r.vehicle.vehicle_id,'PUT',{license_plate:'EDIT-'+randomBytes(4).toString('hex'),vehicle_status:'maintenance'})).status,200);
});
test('valid time zones and end after start are required',async()=>{
  const r=await resources();assert.equal((await api('applications','POST',{...r.applicationBody,requested_end_date:r.applicationBody.requested_start_date})).status,422);
  assert.equal((await api('applications','POST',{...r.applicationBody,requested_start_date:'2026-10-06T12:00:00'})).status,422);
  assert.equal((await api('maintenance','POST',{vehicle_id:r.vehicle.vehicle_id,maintenance_date:'2026-02-30',maintenance_item:'Test',maintenance_cost:'1'})).status,422);
});
test('approval, one-to-one dispatch and return workflow',async()=>{
  const r=await resources();assert.equal((await api('dispatches','POST',r.dispatchBody)).status,409);
  assert.equal((await approve(r.application.application_id)).status,200);
  const dispatch=await api('dispatches','POST',r.dispatchBody);assert.equal(dispatch.status,201);
  assert.equal((await api('dispatches','POST',r.dispatchBody)).status,409);
  assert.equal((await api(`dispatches/${dispatch.data.dispatch_id}/return`,'POST')).status,200);
  assert.equal((await api(`dispatches/${dispatch.data.dispatch_id}/return`,'POST')).status,409);
  const list=await api('dispatches');assert.equal(list.status,200);assert(list.data.find(v=>v.dispatch_id===dispatch.data.dispatch_id).returned_at);
});
test('vehicle and employee overlaps are rejected, adjacent periods allowed',async()=>{
  const r=await resources();await approve(r.application.application_id);assert.equal((await api('dispatches','POST',r.dispatchBody)).status,201);
  const otherEmployee=(await api('employees','POST',{employee_name:'Other',department_id:r.department.department_id})).data;
  const otherApp=(await api('applications','POST',{...r.applicationBody,employee_id:otherEmployee.employee_id})).data;await approve(otherApp.application_id);
  assert.equal((await api('dispatches','POST',{...r.dispatchBody,application_id:otherApp.application_id})).status,409);
  const otherVehicle=(await api('vehicles','POST',{license_plate:'OTHER-'+randomBytes(4).toString('hex')})).data;
  const sameEmployeeApp=(await api('applications','POST',r.applicationBody)).data;await approve(sameEmployeeApp.application_id);
  assert.equal((await api('dispatches','POST',{...r.dispatchBody,application_id:sameEmployeeApp.application_id,vehicle_id:otherVehicle.vehicle_id})).status,409);
  const start=r.applicationBody.requested_end_date,end=new Date(Date.parse(start)+3600000).toISOString();
  const adjacent=(await api('applications','POST',{...r.applicationBody,employee_id:otherEmployee.employee_id,requested_start_date:start,requested_end_date:end})).data;await approve(adjacent.application_id);
  assert.equal((await api('dispatches','POST',{...r.dispatchBody,application_id:adjacent.application_id,actual_start_date:start,actual_end_date:end})).status,201);
});
test('concurrent reservations serialize on the same vehicle',async()=>{
  const r=await resources();await approve(r.application.application_id);
  const staff=(await api('employees','POST',{employee_name:'Concurrent',department_id:r.department.department_id})).data;
  const app=(await api('applications','POST',{...r.applicationBody,employee_id:staff.employee_id})).data;await approve(app.application_id);
  const results=await Promise.all([api('dispatches','POST',r.dispatchBody),api('dispatches','POST',{...r.dispatchBody,application_id:app.application_id})]);
  assert.deepEqual(results.map(v=>v.status).sort(),[201,409]);
});
test('maintenance weak key, refueling and decimal constraints',async()=>{
  const r=await resources();const body={vehicle_id:r.vehicle.vehicle_id,maintenance_date:'2026-10-07',maintenance_item:'Oil',maintenance_cost:'800.00'};
  const first=await api('maintenance','POST',body),second=await api('maintenance','POST',body);
  assert.equal(first.status,201);assert.equal(second.status,409);assert.match(second.data.detail,/同一天/);assert.equal('maintenance_seq' in first.data,false);
  assert.equal(first.data.maintenance_date,body.maintenance_date);
  assert.equal((await api('maintenance','POST',{...body,maintenance_seq:1})).status,422);
  assert.equal((await api('maintenance','POST',{...body,maintenance_date:'2026-10-08'})).status,201);
  const other=await resources();assert.equal((await api('maintenance','POST',{...body,vehicle_id:other.vehicle.vehicle_id})).status,201);
  assert.equal((await api('maintenance','POST',{...body,maintenance_cost:'-1'})).status,422);
  const fuel={vehicle_id:r.vehicle.vehicle_id,refueling_date:'2026-10-07',fuel_liters:'10.125',fuel_cost:'350.00'};
  const refuel=await api('refueling','POST',fuel);assert.equal(refuel.status,201);assert.equal('refueling_id' in refuel.data,false);
  assert.equal(refuel.data.refueling_date,fuel.refueling_date);
  assert.equal((await api('refueling','POST',{...fuel,refueling_id:1})).status,422);
  const duplicate=await api('refueling','POST',fuel);assert.equal(duplicate.status,409);assert.match(duplicate.data.detail,/同一天/);
  assert.equal((await api('refueling','POST',{...fuel,refueling_date:'2026-10-08'})).status,201);
  assert.equal((await api('refueling','POST',{...fuel,vehicle_id:other.vehicle.vehicle_id})).status,201);
  const history=(await api(`employee-context?employee_id=${r.employee.employee_id}`)).data;
  assert(history.maintenance.some(m=>m.vehicle_id===r.vehicle.vehicle_id&&m.maintenance_date==='2026-10-07'));
  assert(history.refueling.some(f=>f.vehicle_id===r.vehicle.vehicle_id&&f.refueling_date==='2026-10-07'));
  assert.equal((await api('refueling','POST',{vehicle_id:r.vehicle.vehicle_id,refueling_date:'2026-10-07',fuel_liters:'0',fuel_cost:'0'})).status,422);
  assert.equal((await api('maintenance')).status,200);assert.equal((await api('refueling')).status,200);
});

test('concurrent weak-entity inserts enforce vehicle/date uniqueness',async()=>{
  const r=await resources();
  for(const [resource,body] of [['maintenance',{vehicle_id:r.vehicle.vehicle_id,maintenance_date:'2026-10-09',maintenance_item:'Concurrent',maintenance_cost:10}],['refueling',{vehicle_id:r.vehicle.vehicle_id,refueling_date:'2026-10-09',fuel_liters:10,fuel_cost:10}]]){
    const outcomes=await Promise.all([api(resource,'POST',body),api(resource,'POST',body)]);
    assert.deepEqual(outcomes.map(v=>v.status).sort(),[201,409]);
  }
});
test('cancelled requests retain history and no account API exists',async()=>{
  const r=await resources();assert.equal((await api(`applications/${r.application.application_id}/cancel`,'POST')).status,200);
  assert.equal((await approve(r.application.application_id)).status,409);
  assert.equal((await api(`applications/${r.application.application_id}`,'DELETE')).status,405);
  assert.equal((await api('accounts')).status,404);
});
test('dashboard and statistics query real persisted data',async()=>{
  const r=await resources();const dashboard=await api('dashboard');assert.equal(dashboard.status,200);assert(dashboard.data.vehicles>=1);
  const result=await api('statistics');assert.equal(result.status,200);assert.equal(result.data.months.length,6);
  assert(result.data.totals.applications>=1);assert(result.data.departments.some(v=>v.department_name===r.department.department_name));
  assert(result.data.months.every(v=>Number(v.total)===Number(v.maintenance_cost)+Number(v.fuel_cost)));
  const filtered=await api('applications?status=pending');assert(filtered.data.every(v=>v.approval_status==='pending'));
});

const futureBody=r=>({...r.applicationBody,requested_start_date:new Date(Date.now()+86400000).toISOString(),requested_end_date:new Date(Date.now()+93600000).toISOString()});
const personal=(resource,employee,record=null,action=null)=>`${resource}${record?'/'+record:''}${action?'/'+action:''}?employee_id=${employee}`;

test('employee context contains only the selected employee records and personal statistics',async()=>{
  const r=await resources(),other=await resources();
  const result=await api(personal('employee-context',r.employee.employee_id));assert.equal(result.status,200);
  assert.equal(result.data.employee.employee_id,r.employee.employee_id);assert.equal(result.data.applications.length,1);
  assert(result.data.applications.every(a=>a.employee_id===r.employee.employee_id));assert(!result.data.applications.some(a=>a.employee_id===other.employee.employee_id));
  assert.equal(result.data.statistics.totals.applications,1);assert.equal(result.data.statistics.months.length,6);
  assert.equal((await api('employee-options')).status,404);assert.equal('password' in result.data.employee,false);
  assert.equal((await api('employee-context','GET',undefined,null)).status,401);assert.equal((await api('employee-context?employee_id=999999999')).status,401);
});

test('employee requests atomically auto-approve and assign a vehicle; conflicts save no partial order',async()=>{
  const r=await resources(),body=futureBody(r),path=personal('my-applications',r.employee.employee_id);
  const first=await api(path,'POST',body);assert.equal(first.status,201);assert.equal(first.data.approval_status,'approved');assert(first.data.auto_approved);assert(first.data.dispatch_id);assert(first.data.license_plate);
  const conflict=await api(path,'POST',body);assert.equal(conflict.status,409);
  const after=await api(personal('employee-context',r.employee.employee_id));assert.equal(after.data.applications.length,2);assert.equal(after.data.dispatches.length,1);
  assert.equal((await api(path,'POST',r.applicationBody)).status,409);
  assert.equal((await api(path,'POST',{...body,employee_id:r.employee.employee_id+1})).status,403);
  assert.equal((await api(personal('my-applications',r.employee.employee_id,first.data.application_id,'review'),'POST',{approval_status:'approved'})).status,403);
});

test('future employee edits reschedule the same trip, preserve ownership, and roll back if no vehicles are available',async()=>{
  const r=await resources(),body=futureBody(r),first=await api(personal('my-applications',r.employee.employee_id),'POST',body);
  const path=personal('my-applications',r.employee.employee_id,first.data.application_id);
  const edited={...body,purpose:'Updated employee request',requested_end_date:new Date(Date.parse(body.requested_end_date)+3600000).toISOString()};
  const result=await api(path,'PUT',edited);assert.equal(result.status,200);assert.equal(result.data.dispatch_id,first.data.dispatch_id);assert.equal(result.data.purpose,edited.purpose);
  const other=await resources();assert.equal((await api(personal('my-applications',other.employee.employee_id,first.data.application_id),'PUT',{...edited,employee_id:other.employee.employee_id})).status,403);
  const sql=openDatabase(env,schema),original=await sql.unsafe('SELECT vehicle_id,vehicle_status FROM vehicles');
  try{
    await sql.unsafe("UPDATE vehicles SET vehicle_status='maintenance'");assert.equal((await api(path,'PUT',{...edited,purpose:'Must roll back'})).status,409);
    const saved=(await api(personal('my-applications',r.employee.employee_id))).data.find(a=>a.application_id===first.data.application_id);assert.equal(saved.purpose,edited.purpose);
  }finally{for(const row of original)await sql.unsafe('UPDATE vehicles SET vehicle_status=$1 WHERE vehicle_id=$2',[row.vehicle_status,row.vehicle_id]);await sql.end({timeout:1});}
});

test('employee deletion removes only future order and reservation; active and returned history is protected',async()=>{
  const r=await resources(),first=await api(personal('my-applications',r.employee.employee_id),'POST',futureBody(r)),other=await resources();
  assert.equal((await api(personal('my-applications',other.employee.employee_id,first.data.application_id),'DELETE')).status,403);
  assert.equal((await api(personal('my-applications',r.employee.employee_id,first.data.application_id),'DELETE')).status,200);
  const sql=openDatabase(env,schema);try{assert.equal((await sql.unsafe('SELECT 1 FROM dispatches WHERE application_id=$1',[first.data.application_id])).length,0);assert.equal((await sql.unsafe('SELECT 1 FROM applications WHERE application_id=$1',[first.data.application_id])).length,0);}finally{await sql.end({timeout:1});}
  await approve(r.application.application_id);const active=await api('dispatches','POST',r.dispatchBody);assert.equal(active.status,201);
  assert.equal((await api(personal('my-applications',r.employee.employee_id,r.application.application_id),'DELETE')).status,409);
  assert.equal((await api(personal('my-dispatches',other.employee.employee_id,active.data.dispatch_id,'return'),'POST')).status,403);
  assert.equal((await api(personal('my-dispatches',r.employee.employee_id,active.data.dispatch_id,'return'),'POST')).status,200);
  assert.equal((await api(personal('my-applications',r.employee.employee_id,r.application.application_id),'DELETE')).status,409);
});

test('employee cancellation frees the future booking but retains cancelled order',async()=>{
  const r=await resources(),first=await api(personal('my-applications',r.employee.employee_id),'POST',futureBody(r));
  assert.equal((await api(personal('my-dispatches',r.employee.employee_id,first.data.dispatch_id,'return'),'POST')).status,409);
  const cancelled=await api(personal('my-applications',r.employee.employee_id,first.data.application_id,'cancel'),'POST');assert.equal(cancelled.status,200);assert.equal(cancelled.data.approval_status,'cancelled');
  const context=await api(personal('employee-context',r.employee.employee_id));assert.equal(context.data.dispatches.length,0);assert(context.data.applications.some(a=>a.application_id===first.data.application_id));
  assert.equal((await api(personal('my-applications',r.employee.employee_id,first.data.application_id),'PUT',futureBody(r))).status,409);
  assert.equal((await api(personal('my-applications',r.employee.employee_id,first.data.application_id),'DELETE')).status,200);
});

test('concurrent automatic approvals cannot double-book the only available car',async()=>{
  const r=await resources(),other=await resources(),sql=openDatabase(env,schema),original=await sql.unsafe('SELECT vehicle_id,vehicle_status FROM vehicles');
  try{
    await sql.unsafe("UPDATE vehicles SET vehicle_status='maintenance'");await sql.unsafe("UPDATE vehicles SET vehicle_status='available' WHERE vehicle_id=$1",[r.vehicle.vehicle_id]);
    const body=futureBody(r);body.requested_start_date=new Date(Date.now()+30*86400000).toISOString();body.requested_end_date=new Date(Date.now()+30*86400000+7200000).toISOString();
    const results=await Promise.all([api(personal('my-applications',r.employee.employee_id),'POST',body),api(personal('my-applications',other.employee.employee_id),'POST',{...body,employee_id:other.employee.employee_id})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const winner=results.find(r=>r.status===201);assert.equal((await api(personal('my-applications',winner.data.employee_id,winner.data.application_id),'DELETE')).status,200);
    assert.equal((await api(personal('my-applications',r.employee.employee_id),'POST',body)).status,201);
  }finally{for(const row of original)await sql.unsafe('UPDATE vehicles SET vehicle_status=$1 WHERE vehicle_id=$2',[row.vehicle_status,row.vehicle_id]);await sql.end({timeout:1});}
});

test('concurrent automatic requests from one employee cannot overlap even with multiple available cars',async()=>{
  const r=await resources(),body=futureBody(r);body.requested_start_date=new Date(Date.now()+40*86400000).toISOString();body.requested_end_date=new Date(Date.now()+40*86400000+7200000).toISOString();
  const path=personal('my-applications',r.employee.employee_id),results=await Promise.all([api(path,'POST',body),api(path,'POST',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
});

test('employee login, session isolation, CSRF, logout and expiry',async()=>{
  const r=await resources(),other=await resources(),auth=sessions.get(r.employee.employee_id);
  assert.match(r.employee.employee_code,/^EMP[0-9]{4,19}$/);
  assert.equal((await api('auth/login','POST',{employee_id:r.employee.employee_id,password:TEST_PASSWORD},null)).status,422);
  assert.equal((await api('auth/login','POST',{employee_code:String(r.employee.employee_id),password:TEST_PASSWORD},null)).status,422);
  assert.equal((await api('employee-context','GET',undefined,null)).status,401);
  assert.equal((await api(`employee-context?employee_id=${other.employee.employee_id}`,'GET',undefined,auth)).status,403);
  assert.equal((await api('my-applications','POST',futureBody(r),{Cookie:auth.Cookie})).status,403);
  assert.equal((await api('auth/login','POST',{employee_code:r.employee.employee_code,password:'wrong'},null)).status,401);
  const me=await api('employee-context','GET',undefined,auth);assert.equal(me.status,200);assert.equal('password' in me.data.employee,false);
  const logout=await api('auth/logout','POST',undefined,auth);assert.equal(logout.status,200);assert.match(logout.cookie,/Max-Age=0/);
  assert.equal((await api('employee-context','GET',undefined,auth)).status,401);
  const login=await api('auth/login','POST',{employee_code:r.employee.employee_code,password:TEST_PASSWORD},null);assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/Secure/);assert.match(login.cookie,/SameSite=Strict/);assert.equal('password' in login.data.employee,false);
  const sql=openDatabase(env,schema);try{await sql.unsafe("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE employee_id=$1",[r.employee.employee_id]);}finally{await sql.end({timeout:1});}
  assert.equal((await api('auth/session','GET',undefined,{Cookie:login.cookie.split(';')[0]})).status,401);
});

test('employee codes stay unique without truncating ids above four digits',async()=>{
  const r=await resources(),sql=openDatabase(env,schema);
  try{
    const rows=await sql.unsafe("INSERT INTO employees(employee_id,department_id,employee_name,password) VALUES(10000,$1,'Code test',$2) RETURNING employee_code",[r.department.department_id,TEST_PASSWORD]);
    assert.equal(rows[0].employee_code,'EMP10000');
    assert.equal((await api('auth/login','POST',{employee_code:'EMP10000',password:TEST_PASSWORD},null)).status,200);
    assert.equal((await api('auth/login','POST',{employee_code:'EMP0000',password:TEST_PASSWORD},null)).status,401);
  }finally{await sql.end({timeout:1});}
});

test('invalid employee login attempts persist and are throttled',async()=>{
  const r=await resources();
  for(let i=0;i<5;i++)assert.equal((await api('auth/login','POST',{employee_code:r.employee.employee_code,password:'wrong'},null)).status,401);
  assert.equal((await api('auth/login','POST',{employee_code:r.employee.employee_code,password:TEST_PASSWORD},null)).status,429);
  assert.equal((await api('auth/login','POST',{employee_code:'EMP999999999',password:'wrong'},null)).status,401);
});

test('shared bookings and availability agree with preferred-car conflict prevention',async()=>{
  const r=await resources(),other=await resources(),body={...futureBody(r),vehicle_id:r.vehicle.vehicle_id};
  const first=await api(personal('my-applications',r.employee.employee_id),'POST',body);assert.equal(first.status,201);
  const actor=sessions.get(other.employee.employee_id),query=`availability?start=${encodeURIComponent(body.requested_start_date)}&end=${encodeURIComponent(body.requested_end_date)}`;
  const available=await api(query,'GET',undefined,actor);assert.equal(available.status,200);assert.equal(available.data.vehicles.find(v=>v.vehicle_id===r.vehicle.vehicle_id).available_in_period,false);assert(available.data.bookings.some(b=>b.vehicle_id===r.vehicle.vehicle_id));
  const shared=(await api(personal('employee-context',other.employee.employee_id))).data;assert(shared.team_bookings.some(b=>b.application_id===first.data.application_id));assert(!shared.applications.some(b=>b.application_id===first.data.application_id));
  assert.equal((await api(personal('my-applications',other.employee.employee_id),'POST',{...body,employee_id:other.employee.employee_id})).status,409);
  assert.equal((await api(query+'&exclude='+first.data.application_id,'GET',undefined,actor)).status,403);
  assert.equal((await api(query+'&exclude='+first.data.application_id,'GET',undefined,sessions.get(r.employee.employee_id))).data.vehicles.find(v=>v.vehicle_id===r.vehicle.vehicle_id).available_in_period,true);
  const adjacent={...body,employee_id:other.employee.employee_id,requested_start_date:body.requested_end_date,requested_end_date:new Date(Date.parse(body.requested_end_date)+3600000).toISOString()};
  assert.equal((await api(personal('my-applications',other.employee.employee_id),'POST',adjacent)).status,201);
  assert.equal((await api('availability?start=invalid&end=invalid','GET',undefined,actor)).status,422);
});

test('two authenticated employees cannot reserve the same preferred car concurrently',async()=>{
  const r=await resources(),other=await resources(),body={...futureBody(r),vehicle_id:r.vehicle.vehicle_id,requested_start_date:new Date(Date.now()+60*86400000).toISOString(),requested_end_date:new Date(Date.now()+60*86400000+7200000).toISOString()};
  const results=await Promise.all([api(personal('my-applications',r.employee.employee_id),'POST',body),api(personal('my-applications',other.employee.employee_id),'POST',{...body,employee_id:other.employee.employee_id})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
});
