import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker.js';
const env={DB_HOST:'database.example',DB_NAME:'fleet',DB_USER:'test',DB_PASSWORD:'test-only-password'};
const assets={'/index.html':{body:'<h1>FleetFlow</h1>',type:'text/html'}};
test('homepage serves the employee login shell',async()=>{const r=await createWorker(assets).fetch(new Request('https://fleetflow.example/'),env);assert.equal(r.status,200);assert.equal(await r.text(),'<h1>FleetFlow</h1>');});
test('missing database configuration fails closed',async()=>{assert.equal((await createWorker(assets).fetch(new Request('https://fleetflow.example/api/vehicles'),{})).status,503);});
test('foreign origin cannot mutate data',async()=>{assert.equal((await createWorker(assets).fetch(new Request('https://fleetflow.example/api/vehicles',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'}),env)).status,403);});
test('API runs inside the worker and keeps database credentials out of responses',async()=>{
  let called=false;
  const worker=createWorker(assets,async(request,values)=>{called=true;assert.equal(values.DB_PASSWORD,env.DB_PASSWORD);return Response.json([{vehicle_id:1}]);});
  const response=await worker.fetch(new Request('https://fleetflow.example/api/vehicles'),env);
  assert(called);assert.deepEqual(await response.json(),[{vehicle_id:1}]);assert.equal(response.headers.get('DB_PASSWORD'),null);
});
test('unsupported HTTP methods are rejected before database access',async()=>{assert.equal((await createWorker(assets).fetch(new Request('https://fleetflow.example/api/vehicles',{method:'PATCH'}),env)).status,405);});

test('production worker does not expose legacy administration routes',async()=>{
  let calls=0;const worker=createWorker(assets,async()=>{calls++;return Response.json({});});
  for(const [path,method] of [['departments','GET'],['employees','POST'],['applications/1/review','POST'],['vehicles','DELETE'],['dispatches','POST'],['statistics','GET']]){
    assert.equal((await worker.fetch(new Request('https://fleetflow.example/api/'+path,{method}),env)).status,404);
  }assert.equal(calls,0);
  assert.equal((await worker.fetch(new Request('https://fleetflow.example/api/employee-options'),env)).status,404);assert.equal(calls,0);
  const loggedIn=createWorker(assets,async()=>Response.json({employee:{employee_id:1}},{headers:{'Set-Cookie':'fleetflow_session=test; HttpOnly; Secure; SameSite=Strict'}}));
  const login=await loggedIn.fetch(new Request('https://fleetflow.example/api/auth/login',{method:'POST',body:'{}'}),env);assert.match(login.headers.get('Set-Cookie'),/HttpOnly/);
});
