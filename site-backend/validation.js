export class ApiError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export const MODEL='Rolls-Royce Cullinan 6.75 V12';
const fail=message=>{throw new ApiError(422,message);};
const required=(body,key)=>{if(body[key]===undefined)fail(`請填寫 ${key}`);return body[key];};
function text(value,key,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(`${key} 不可空白或超過 ${max} 字元`);return value.trim();}
export function id(value){if(!Number.isSafeInteger(value)||value<=0)fail('編號必須為正整數');return value;}
function choice(value,key,options){if(!options.includes(value))fail(`${key} 不在允許範圍`);return value;}
function day(value,key){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail(`${key} 日期格式錯誤`);return value;}
function timestamp(value,key){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))fail(`${key} 必須包含有效時間及時區`);
  day(value.slice(0,10),key);if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19)||0)>59)fail(`${key} 時間格式錯誤`);
  return value;
}
function decimal(value,key,digits,scale,positive=false){
  if(!['string','number'].includes(typeof value))fail(`${key} 必須為數字`);
  const valueString=String(value);const pattern=new RegExp(`^\\d{1,${digits-scale}}(?:\\.\\d{1,${scale}})?$`);
  if(!pattern.test(valueString)||!Number.isFinite(Number(valueString))||(positive&&Number(valueString)<=0))fail(`${key} 數值或精度錯誤`);
  return valueString;
}
const fields={departments:['department_name'],employees:['employee_name','department_id','phone_numbers','password'],
 vehicles:['license_plate','vehicle_model','vehicle_status'],applications:['employee_id','purpose','requested_start_date','requested_end_date'],
 dispatches:['application_id','vehicle_id','actual_start_date','actual_end_date'],maintenance:['vehicle_id','maintenance_date','maintenance_item','maintenance_cost'],
 refueling:['vehicle_id','refueling_date','fuel_liters','fuel_cost'],review:['approval_status']};
fields['employee-applications']=[...fields.applications,'vehicle_id'];
fields.availability=['requested_start_date','requested_end_date'];
export function validate(resource,body){
  if(!body||typeof body!=='object'||Array.isArray(body))fail('請求必須為 JSON 物件');
  if(!fields[resource]||Object.keys(body).some(key=>!fields[resource].includes(key)))fail('包含未知欄位');
  const get=key=>required(body,key);let result;
  switch(resource){
    case 'departments':return {department_name:text(get('department_name'),'department_name',80)};
    case 'employees':{
      const phones=body.phone_numbers??[];if(!Array.isArray(phones)||phones.length>10)fail('聯絡電話最多十筆');
      result={employee_name:text(get('employee_name'),'employee_name',80),department_id:id(get('department_id')),
        phone_numbers:[...new Set(phones.map(phone=>text(phone,'phone_numbers',30)))].sort()};
      if(body.password!==undefined){if(typeof body.password!=='string'||body.password.length<8||body.password.length>128)fail('密碼需 8 至 128 字元');result.password=body.password;}break;
    }
    case 'vehicles':return {license_plate:text(get('license_plate'),'license_plate',20).toUpperCase(),
      vehicle_model:choice(body.vehicle_model??MODEL,'vehicle_model',[MODEL]),
      vehicle_status:choice(body.vehicle_status??'available','vehicle_status',['available','maintenance','retired'])};
    case 'employee-applications':
    case 'applications':result={employee_id:id(get('employee_id')),purpose:text(get('purpose'),'purpose',500),
      requested_start_date:timestamp(get('requested_start_date'),'requested_start_date'),requested_end_date:timestamp(get('requested_end_date'),'requested_end_date')};break;
    case 'availability':result={requested_start_date:timestamp(get('requested_start_date'),'requested_start_date'),requested_end_date:timestamp(get('requested_end_date'),'requested_end_date')};break;
    case 'dispatches':result={application_id:id(get('application_id')),vehicle_id:id(get('vehicle_id')),
      actual_start_date:timestamp(get('actual_start_date'),'actual_start_date'),actual_end_date:timestamp(get('actual_end_date'),'actual_end_date')};break;
    case 'maintenance':return {vehicle_id:id(get('vehicle_id')),maintenance_date:day(get('maintenance_date'),'maintenance_date'),
      maintenance_item:text(get('maintenance_item'),'maintenance_item',250),maintenance_cost:decimal(get('maintenance_cost'),'maintenance_cost',12,2)};
    case 'refueling':return {vehicle_id:id(get('vehicle_id')),refueling_date:day(get('refueling_date'),'refueling_date'),
      fuel_liters:decimal(get('fuel_liters'),'fuel_liters',9,3,true),fuel_cost:decimal(get('fuel_cost'),'fuel_cost',12,2)};
    case 'review':return {approval_status:choice(get('approval_status'),'approval_status',['approved','rejected'])};
  }
  if(resource==='employee-applications'&&body.vehicle_id!==undefined&&body.vehicle_id!==null)result.vehicle_id=id(body.vehicle_id);
  if(['applications','employee-applications','availability','dispatches'].includes(resource)){
    const start=resource!=='dispatches'?result.requested_start_date:result.actual_start_date;
    const end=resource!=='dispatches'?result.requested_end_date:result.actual_end_date;
    if(Date.parse(end)<=Date.parse(start))fail('迄日必須晚於起日');
  }
  return result;
}
export async function readBody(request){
  const raw=await request.text();if(new TextEncoder().encode(raw).length>32768)throw new ApiError(413,'請求資料過大');
  try{return JSON.parse(raw);}catch{throw new ApiError(422,'JSON 格式錯誤');}
}
