import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../dist/dev-utils.js';
const {parseCSV,validateRecord}=globalThis.FleetDev;
const vehicles=[{vehicle_id:1},{vehicle_id:2}];
const h='vehicle_id,maintenance_date,maintenance_item,maintenance_cost\r\n';
test('CSV BOM, quoted commas, escaped quotes and newline are parsed',()=>{
 const r=parseCSV('\uFEFF'+h+'1,2026-11-10,"Oil, ""filter""\ncheck",1500.25\r\n','maintenance',vehicles);
 assert.equal(r[0].maintenance_item,'Oil, "filter"\ncheck');assert.equal(r[0].maintenance_cost,1500.25);
});
test('CSV requires known fleet, exact headers, valid date and decimal amounts',()=>{
 for(const input of [h+'9,2026-11-10,Oil,1',h+'1,2026-02-30,Oil,1',h+'1,2026-11-10,Oil,-1',h+'1,2026-11-10,Oil,1.123',h+'1,2026-11-10,"Oil,1',h+'1,2026-11-10,"Oil"x,1','wrong\n1'])assert.throws(()=>parseCSV(input,'maintenance',vehicles));
});
test('CSV enforces empty, 100 row and UTF-8 byte size boundaries',()=>{
 assert.throws(()=>parseCSV(h,'maintenance',vehicles));assert.equal(parseCSV(h+'1,2026-11-10,Oil,0\n'.repeat(100),'maintenance',vehicles).length,100);assert.throws(()=>parseCSV(h+'1,2026-11-10,Oil,0\n'.repeat(101),'maintenance',vehicles));assert.throws(()=>parseCSV('車'.repeat(11000),'maintenance',vehicles));
});
test('manual refueling validator rejects nonpositive liters and missing cost',()=>{
 const r={vehicle_id:2,refueling_date:'2026-11-10',fuel_liters:'10.125',fuel_cost:'0'};assert.equal(validateRecord('refueling',r,vehicles).fuel_liters,10.125);assert.throws(()=>validateRecord('refueling',{...r,fuel_liters:0},vehicles));assert.throws(()=>validateRecord('refueling',{...r,fuel_cost:''},vehicles));
});
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
test('DEV login uses isolated API and username, employee login retains employee_id',async()=>{
 const nodes={};let submit,path,body;const $=k=>nodes[k]??={addEventListener:(_,fn)=>submit=fn};
 const handler=source.slice(source.indexOf("$('#login-form').addEventListener"),source.indexOf("$('#logout-button').addEventListener"));
 vm.runInNewContext(handler,{$,api:async(p,m,b)=>{path=p;body=b;return {};},showWorkspace(){},loadPage:async()=>{}});
 $('#login-employee').value='dev';$('#login-password').value='test-only';await submit({preventDefault(){}});assert.equal(path,'/api/dev/login');assert.equal(body.username,'DEV');assert.equal(body.employee_id,undefined);
 $('#login-employee').value='1';await submit({preventDefault(){}});assert.equal(path,'/api/auth/login');assert.equal(body.employee_id,'1');
});
test('DEV load branches before employee context and stale file reads are discarded',()=>{
 assert.match(source,/if\(role==='dev'\)return loadDevPage\(\)/);assert.match(source,/version!==devFileVersion\|\|epoch!==authEpoch\|\|!input.isConnected/);assert.match(source,/if\(devBusy\|\|!devDraft\)return/);assert.match(source,/if\(epoch!==authEpoch\|\|role!=='dev'\)return/);
});

function devHarness(){
 const nodes={},state={role:'dev',devBusy:false,formMode:null,authEpoch:4,context:{vehicles:[{vehicle_id:1,license_plate:'TEST-1',vehicle_model:'Test Model',vehicle_status:'available'}]},selectedVehicle:'1',historyType:'maintenance',devDraft:null,document:{querySelectorAll:()=>[]},FleetDev:globalThis.FleetDev,esc:v=>String(v??'').replaceAll('<','&lt;'),statusNames:{available:'目前可借',maintenance:'保養中',retired:'已停用'},localTime:()=> '2026-11-10T10:00',FormData:class{constructor(form){return Object.entries(form.values||{});}},toast:()=>{},loadDevPage:async()=>{},api:async()=>({vehicle_id:9})};
 state.$=k=>nodes[k]??={disabled:false,innerHTML:'',textContent:'',open:false,showModal(){this.open=true;},close(){this.open=false;}};
 vm.createContext(state);vm.runInContext(source.slice(source.indexOf('function devInput('),source.indexOf('async function previewDevCSV(')),state);return {state,nodes};
}
test('new vehicle form works for an empty fleet and retains default model',()=>{
 const {state,nodes}=devHarness();state.context.vehicles=[];state.selectedVehicle=null;state.openDevForm('vehicle-new');
 assert.equal(nodes['#dialog-title'].textContent,'新增車輛');assert.equal(state.formMode.id,null);assert.equal(nodes['#edit-dialog'].open,true);assert.match(nodes['#form-fields'].innerHTML,/Rolls-Royce Cullinan/);
});
test('archive dialog names vehicle, escapes content, explains recovery and does not write until submit',()=>{
 const {state,nodes}=devHarness();let calls=0;state.api=async()=>calls++;state.context.vehicles[0].license_plate='<img>';state.openDevForm('archive','1');
 assert.equal(calls,0);assert.equal(nodes['#save-button'].textContent,'確認封存');assert.match(nodes['#form-fields'].innerHTML,/&lt;img>/);assert.match(nodes['#form-fields'].innerHTML,/保留/);assert.match(nodes['#form-fields'].innerHTML,/編輯/);
});
test('new vehicle posts once while pending and selects server-assigned ID',async()=>{
 const {state,nodes}=devHarness();state.openDevForm('vehicle-new');let calls=[],finish;state.api=(...args)=>{calls.push(args);return new Promise(r=>finish=r);};
 const form={values:{license_plate:' TEST-9 ',vehicle_model:' Custom ',vehicle_status:'available'}},pending=state.saveDevForm(form);await state.saveDevForm(form);assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/dev/vehicles');assert.equal(calls[0][1],'POST');assert.equal(calls[0][2].license_plate,'TEST-9');assert.equal(state.devBusy,true);
 finish({vehicle_id:9});await pending;assert.equal(state.selectedVehicle,'9');assert.equal(nodes['#edit-dialog'].open,false);assert.equal(state.devBusy,false);
});
test('archive submits DELETE with no editable fields; failures retain dialog for correction or cancel',async()=>{
 const {state,nodes}=devHarness();state.openDevForm('archive','1');let call;state.api=async(...args)=>{call=args;throw Error('有尚未歸還的預約');};await state.saveDevForm({});assert.equal(call[0],'/api/dev/vehicles/1');assert.equal(call[1],'DELETE');assert.equal(call[2],undefined);assert.equal(nodes['#edit-dialog'].open,true);assert.match(nodes['#form-error'].textContent,/預約/);assert.equal(state.devBusy,false);
});
test('stale dialog epoch and employee role cannot open or submit DEV form',async()=>{
 const {state,nodes}=devHarness();state.role='employee';state.openDevForm('vehicle-new');assert.equal(nodes['#edit-dialog'],undefined);state.role='dev';state.openDevForm('vehicle-new');state.authEpoch++;let calls=0;state.api=async()=>calls++;await state.saveDevForm({});assert.equal(calls,0);
});
