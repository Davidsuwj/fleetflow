import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmployeeId,validateLogin} from '../site-backend/auth.js';

test('canonical employee identifier and old input aliases normalize identically',()=>{
  for(const value of [1,'1','0001','EMP0001'])assert.equal(normalizeEmployeeId(value),1);
  for(const key of ['employee_id','employee_code'])for(const value of [1,'1','EMP0001'])assert.equal(validateLogin({[key]:value,password:'test'}).employee_id,1);
  assert.equal(normalizeEmployeeId('EMP10000'),10000);
  assert.equal(normalizeEmployeeId('9007199254740991'),Number.MAX_SAFE_INTEGER);
});
test('invalid, ambiguous, non-integral, unsafe or coercible identifiers are rejected',()=>{
  for(const value of [null,undefined,true,false,{},[],0,-1,1.5,'',' 1','1 ','1e2','+1','EMP1','emp0001','EMP0000','9007199254740992',9007199254740992])assert.throws(()=>normalizeEmployeeId(value));
  for(const body of [null,[],{}, {employee_id:1,employee_code:'EMP0001',password:'test'}, {employee_id:null,employee_code:'EMP0001',password:'test'}, {employee_id:1,password:''},{employee_id:1,password:'x'.repeat(129)},{employee_id:1,password:'test',extra:true}])assert.throws(()=>validateLogin(body));
});
