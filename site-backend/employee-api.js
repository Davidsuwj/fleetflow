import {validate,id,readBody,ApiError} from './validation.js';
import {queries} from './queries.js';
import {availability,teamBookingsSQL} from './availability.js';

const execute=(sql,query,values=[])=>sql.unsafe(query,values);
async function find(sql,table,key,value,lock=false){
  const row=(await execute(sql,`SELECT * FROM ${table} WHERE ${key}=$1${lock?' FOR UPDATE':''}`,[value]))[0];
  if(!row)throw new ApiError(404,'找不到指定資料。');return row;
}
const applications=(sql,employee)=>execute(sql,queries.applications_base+' WHERE a.employee_id=$1 ORDER BY a.created_at DESC',[employee]);
const dispatches=(sql,employee)=>execute(sql,queries.dispatches_base+' WHERE a.employee_id=$1 ORDER BY ds.actual_start_date DESC',[employee]);
const conflictSQL=`SELECT 1 FROM dispatches ds JOIN applications a USING(application_id)
  WHERE %CONDITION% AND ds.application_id<>$4 AND ds.actual_start_date<$2
  AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$3`;

async function selectVehicle(sql,employee,start,end,except=0,preferred=null){
  if(Date.parse(start)<=Date.now())throw new ApiError(409,'預計起日須晚於目前時間，請選擇未來的用車時段。');
  const employeeConflict=await execute(sql,conflictSQL.replace('%CONDITION%','a.employee_id=$1'),[employee,end,start,except]);
  if(employeeConflict.length)throw new ApiError(409,'你在此時段已有行程，請選擇其他時間。');
  // Every booking path locks employees first, then vehicles in ascending order.
  // Recheck availability after acquiring the lock so concurrent requests cannot double-book.
  const candidates=await execute(sql,"SELECT vehicle_id FROM vehicles WHERE vehicle_status='available' AND ($1::bigint IS NULL OR vehicle_id=$1) ORDER BY vehicle_id",[preferred]);
  for(const candidate of candidates){
    const vehicle=await find(sql,'vehicles','vehicle_id',candidate.vehicle_id,true);
    if(vehicle.vehicle_status!=='available')continue;
    const overlap=await execute(sql,conflictSQL.replace('%CONDITION%','ds.vehicle_id=$1'),[vehicle.vehicle_id,end,start,except]);
    if(!overlap.length)return vehicle;
  }
  throw new ApiError(409,preferred?'這台車在所選時段無法借用，請換車或調整時間。':'所選時段沒有可用車輛，請調整用車時間後再送出。');
}

async function ownApplication(sql,employee,application){
  await find(sql,'employees','employee_id',employee,true);
  const row=await find(sql,'applications','application_id',application,true);
  if(row.employee_id!==employee)throw new ApiError(403,'只能操作目前員工自己的申請。');
  const trip=(await execute(sql,'SELECT * FROM dispatches WHERE application_id=$1 FOR UPDATE',[application]))[0];
  if(trip&&(trip.returned_at||new Date(trip.actual_start_date).getTime()<=Date.now()))throw new ApiError(409,'行程已開始或已歸還，無法修改、取消或刪單。');
  return {row,trip};
}

async function saveApplication(sql,employee,body,application=null){
  let old;
  if(application){
    old=await ownApplication(sql,employee,application);
    if(!['pending','approved'].includes(old.row.approval_status))throw new ApiError(409,'已取消或已駁回的申請無法修改，請重新申請。');
  }else await find(sql,'employees','employee_id',employee,true);
  const vehicle=await selectVehicle(sql,employee,body.requested_start_date,body.requested_end_date,application||0,body.vehicle_id);
  const row=application?
    (await execute(sql,`UPDATE applications SET purpose=$1,requested_start_date=$2,requested_end_date=$3,approval_status='approved'
      WHERE application_id=$4 RETURNING *`,[body.purpose,body.requested_start_date,body.requested_end_date,application]))[0]:
    (await execute(sql,`INSERT INTO applications(employee_id,purpose,requested_start_date,requested_end_date,approval_status)
      VALUES($1,$2,$3,$4,'approved') RETURNING *`,[employee,body.purpose,body.requested_start_date,body.requested_end_date]))[0];
  const trip=old?.trip?
    (await execute(sql,`UPDATE dispatches SET vehicle_id=$1,actual_start_date=$2,actual_end_date=$3 WHERE dispatch_id=$4 RETURNING *`,
      [vehicle.vehicle_id,body.requested_start_date,body.requested_end_date,old.trip.dispatch_id]))[0]:
    (await execute(sql,`INSERT INTO dispatches(application_id,vehicle_id,actual_start_date,actual_end_date) VALUES($1,$2,$3,$4) RETURNING *`,
      [row.application_id,vehicle.vehicle_id,body.requested_start_date,body.requested_end_date]))[0];
  return {...row,dispatch_id:trip.dispatch_id,license_plate:vehicle.license_plate,auto_approved:true};
}

async function context(sql,employee){
  const profile=(await execute(sql,queries.employees[0].replace('ORDER BY e.employee_id','WHERE e.employee_id=$1'),[employee]))[0];
  if(!profile)throw new ApiError(404,'找不到指定員工。');
  const apps=await applications(sql,employee),trips=await dispatches(sql,employee),vehicles=await execute(sql,queries.vehicles[0]);
  const maintenance=await execute(sql,queries.maintenance[0]),refueling=await execute(sql,queries.refueling[0]);
  const team_bookings=await execute(sql,teamBookingsSQL);
  const months=await execute(sql,`WITH months AS (
    SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',date_trunc('month',CURRENT_DATE),interval '1 month')::date AS month
  ) SELECT to_char(m.month,'YYYY-MM') AS month,
    (SELECT count(*) FROM applications a WHERE a.employee_id=$1 AND date_trunc('month',a.requested_start_date AT TIME ZONE 'Asia/Taipei')::date=m.month) AS applications,
    (SELECT count(*) FROM dispatches ds JOIN applications a USING(application_id) WHERE a.employee_id=$1 AND date_trunc('month',ds.actual_start_date AT TIME ZONE 'Asia/Taipei')::date=m.month) AS dispatches
    FROM months m ORDER BY m.month`,[employee]);
  const approval_status=['pending','approved','rejected','cancelled'].map(status=>({approval_status:status,count:apps.filter(a=>a.approval_status===status).length}));
  const totals={applications:apps.length,dispatches:trips.length,returned:trips.filter(t=>t.returned_at).length,
    scheduled_hours:Math.round(trips.reduce((sum,t)=>sum+(new Date(t.actual_end_date)-new Date(t.actual_start_date))/3600000,0)*10)/10};
  return {employee:profile,applications:apps,dispatches:trips,maintenance,refueling,team_bookings,vehicles:vehicles.filter(v=>v.vehicle_status!=='retired'),statistics:{totals,approval_status,months}};
}

export async function handleEmployeeApi(request,env,databaseFactory,employee){
  const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean),resource=parts[1],action=parts[3],method=request.method;
  if(parts.length>4)throw new ApiError(404,'找不到指定 API。');
  if(action==='review'||(resource==='my-dispatches'&&method==='POST'&&!action))throw new ApiError(403,'員工不需要手動審核或派車。');
  if(!employee)throw new ApiError(401,'請先登入。');
  const value=parts[2]===undefined?null:id(Number(parts[2]));
  let body;
  if(resource==='my-applications'&&['POST','PUT'].includes(method)&&!action){
    body=validate('employee-applications',await readBody(request));
    if(body.employee_id!==employee)throw new ApiError(403,'申請員工與目前員工不一致。');
  }
  const sql=databaseFactory(env);
  try{
    let result,status=200;
    if(resource==='availability'&&method==='GET'&&value===null&&!action){
      const period=validate('availability',{requested_start_date:url.searchParams.get('start'),requested_end_date:url.searchParams.get('end')});
      const except=url.searchParams.has('exclude')?id(Number(url.searchParams.get('exclude'))):0;
      result=await sql.begin('isolation level repeatable read read only',async transaction=>{
        if(except){const own=await find(transaction,'applications','application_id',except);if(own.employee_id!==employee)throw new ApiError(403,'無法排除其他員工的預約。');}
        return availability(transaction,period.requested_start_date,period.requested_end_date,except);
      });
    }else if(resource==='employee-context'&&method==='GET'&&value===null&&!action)result=await sql.begin('isolation level repeatable read read only',transaction=>context(transaction,employee));
    else if(resource==='my-applications'&&method==='GET'&&value===null&&!action){
      await find(sql,'employees','employee_id',employee);result=await applications(sql,employee);
    }else if(resource==='my-dispatches'&&method==='GET'&&value===null&&!action){
      await find(sql,'employees','employee_id',employee);result=await dispatches(sql,employee);
    }else if(resource==='my-applications'&&((method==='POST'&&value===null)||(method==='PUT'&&value!==null))&&!action){
      status=method==='POST'?201:200;result=await sql.begin(transaction=>saveApplication(transaction,employee,body,value));
    }else if(resource==='my-applications'&&value!==null&&((method==='DELETE'&&!action)||(method==='POST'&&action==='cancel'))){
      result=await sql.begin(async transaction=>{
        const {row,trip}=await ownApplication(transaction,employee,value);
        if(action==='cancel'&&!['pending','approved'].includes(row.approval_status))throw new ApiError(409,'此申請已取消或已結案。');
        if(trip)await execute(transaction,'DELETE FROM dispatches WHERE dispatch_id=$1',[trip.dispatch_id]);
        if(method==='DELETE'){
          await execute(transaction,'DELETE FROM applications WHERE application_id=$1',[value]);return {deleted:true,application_id:value};
        }
        return (await execute(transaction,"UPDATE applications SET approval_status='cancelled' WHERE application_id=$1 RETURNING *",[value]))[0];
      });
    }else if(resource==='my-dispatches'&&value!==null&&method==='POST'&&action==='return'){
      result=await sql.begin(async transaction=>{
        await find(transaction,'employees','employee_id',employee,true);
        const owner=(await execute(transaction,'SELECT employee_id FROM applications a JOIN dispatches ds USING(application_id) WHERE ds.dispatch_id=$1',[value]))[0];
        if(!owner)throw new ApiError(404,'找不到指定行程。');
        if(owner.employee_id!==employee)throw new ApiError(403,'只能歸還目前員工自己的車輛。');
        const trip=await find(transaction,'dispatches','dispatch_id',value,true);
        if(trip.returned_at)throw new ApiError(409,'此行程已完成歸還。');
        if(new Date(trip.actual_start_date).getTime()>Date.now())throw new ApiError(409,'行程尚未開始，不能登記歸還。');
        return (await execute(transaction,'UPDATE dispatches SET returned_at=now() WHERE dispatch_id=$1 RETURNING *',[value]))[0];
      });
    }else throw new ApiError(405,'不支援的操作。');
    return Response.json(result,{status});
  }finally{await sql.end({timeout:1}).catch(()=>{});}
}
