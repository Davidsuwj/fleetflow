import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');

test('login labels one employee identifier and accepts existing aliases',()=>{
  assert.doesNotMatch(html,/工號|employee_code/);
  assert.match(html,/員工編號<input[^>]+name="employee_id"/);
  const pattern=new RegExp('^(?:'+html.match(/id="login-employee"[^>]+pattern="([^"]+)"/)[1]+')$');
  for(const value of ['1','12345','EMP0001','emp0001'])assert.match(value,pattern);
  for(const value of ['','abc','-1','1.5'])assert.doesNotMatch(value,pattern);
});

test('workspace displays numeric employee_id, not the retired alias',()=>{
  const nodes={};const $=key=>nodes[key]??=( {} );
  const show=source.slice(source.indexOf('function showWorkspace('),source.indexOf("$('#login-form').addEventListener"));
  vm.runInNewContext(`${show};showWorkspace(session)`,{$,session:{employee:{employee_id:12345},csrf_token:'test'},employeeId:null,csrfToken:null});
  assert.equal(nodes['#signed-in-name'].textContent,'員工編號 12345');
  assert.equal(nodes['#workspace'].hidden,false);
});

test('login sends the unified key, clears password after success and releases errors',async()=>{
  const nodes={};let submit,payload,fail=false;
  const $=key=>nodes[key]??=({addEventListener:(_event,handler)=>{submit=handler;}});
  const handler=source.slice(source.indexOf("$('#login-form').addEventListener"),source.indexOf("$('#logout-button').addEventListener"));
  vm.runInNewContext(handler,{$,api:async(_path,_method,body)=>{payload=body;if(fail)throw new Error('test failure');return {};},showWorkspace:()=>{},loadPage:async()=>{}});
  $('#login-employee').value=' emp0001 ';$('#login-password').value='existing-password';
  await submit({preventDefault(){}});
  assert.equal(payload.employee_id,'EMP0001');assert.equal('employee_code' in payload,false);
  assert.equal($('#login-password').value,'');assert.equal($('#login-button').disabled,false);
  fail=true;$('#login-employee').value='1';$('#login-password').value='wrong';
  await submit({preventDefault(){}});
  assert.equal(payload.employee_id,'1');assert.equal($('#login-error').textContent,'test failure');
  assert.equal($('#login-button').disabled,false);
});
