import {openDatabase} from './db.js';
import {validate,id,readBody,ApiError} from './validation.js';
import {queries} from './queries.js';
import {handleEmployeeApi} from './employee-api.js';
import {handleAuth,requireSession} from './auth.js';

const master={departments:['departments','department_id'],employees:['employees','employee_id'],vehicles:['vehicles','vehicle_id']};
const execute=(sql,query,values=[])=>sql.unsafe(query,values);
async function find(sql,table,key,value,lock=false){
  const rows=await execute(sql,`SELECT * FROM ${table} WHERE ${key}=$1${lock?' FOR UPDATE':''}`,[value]);
  if(!rows[0])throw new ApiError(404,'找不到指定資料。');return rows[0];
}
async function insert(sql,table,body){
  const keys=Object.keys(body);return (await execute(sql,`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(body)))[0];
}
async function update(sql,table,key,value,body){
  await find(sql,table,key,value);const keys=Object.keys(body);
  return (await execute(sql,`UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE ${key}=$${keys.length+1} RETURNING *`,[...Object.values(body),value]))[0];
}
async function saveEmployee(sql,body,value){
  const {phone_numbers,...data}=body;
  const row=value?await update(sql,'employees','employee_id',value,data):await insert(sql,'employees',data);
  await execute(sql,'DELETE FROM employee_phones WHERE employee_id=$1',[row.employee_id]);
  for(const phone of phone_numbers)await execute(sql,'INSERT INTO employee_phones(employee_id,phone_number) VALUES ($1,$2)',[row.employee_id,phone]);
  if(body.password)await execute(sql,'DELETE FROM auth_sessions WHERE employee_id=$1',[row.employee_id]);
  delete row.password;return {...row,phone_numbers};
}
export async function handleApi(request,env,databaseFactory=openDatabase){
  const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean),resource=parts[1],action=parts[3],method=request.method;
  let sql;
  try{
    if(!['GET','POST','PUT','DELETE'].includes(method))throw new ApiError(405,'不支援的操作。');
    if(resource==='auth'){sql=databaseFactory(env);return await handleAuth(request,sql);}
    if(['employee-context','my-applications','my-dispatches','availability'].includes(resource)||(['vehicles','health'].includes(resource)&&method==='GET')){
      sql=databaseFactory(env);const session=await requireSession(request,sql);
      if(['employee-context','my-applications','my-dispatches','availability'].includes(resource))return await handleEmployeeApi(request,env,databaseFactory,session.employee_id);
    }
    const known=[...Object.keys(master),'applications','dispatches','maintenance','refueling','dashboard','statistics','health'];
    if(!known.includes(resource)||parts.length>4)throw new ApiError(404,'找不到指定 API。');
    const value=parts[2]===undefined?null:id(Number(parts[2]));
    let body;
    if(method==='POST'||method==='PUT'){
      if(action==='review')body=validate('review',await readBody(request));
      else if(!action)body=validate(resource,await readBody(request));
      else if(!['cancel','return'].includes(action))throw new ApiError(404,'找不到指定操作。');
    }
    sql ||= databaseFactory(env);
    let result,status=200;
    if(method==='GET'&&value===null&&!action){
      switch(resource){
        case 'health':await execute(sql,'SELECT 1');result={status:'ok',database:'connected',runtime:'GPT Sites Worker'};break;
        case 'departments':result=await execute(sql,'SELECT * FROM departments ORDER BY department_id');break;
        case 'employees':case 'vehicles':case 'maintenance':case 'refueling':result=await execute(sql,queries[resource][0]);break;
        case 'applications':result=await execute(sql,queries.applications_base+' WHERE ($1::text IS NULL OR a.approval_status=$2) ORDER BY a.created_at DESC',[url.searchParams.get('status'),url.searchParams.get('status')]);break;
        case 'dispatches':result=await execute(sql,queries.dispatches_base+' ORDER BY ds.actual_start_date DESC');break;
        case 'dashboard':result=await sql.begin('isolation level repeatable read read only',async transaction=>{
          const data=[];for(const query of queries.dashboard)data.push((await execute(transaction,query))[0]);
          return {vehicles:data[0].n,...data[1],unreturned:data[2].n,month_cost:data[3].cost};
        });break;
        case 'statistics':result=await sql.begin('isolation level repeatable read read only',async transaction=>{
          const data=[];for(const query of queries.statistics)data.push(await execute(transaction,query));
          return {approval_status:data[0],departments:data[1],months:data[2],totals:data[3][0]};
        });break;
      }
    }else if(method==='POST'&&value===null&&!action&&master[resource]){
      status=201;result=await sql.begin(transaction=>resource==='employees'?saveEmployee(transaction,body):insert(transaction,master[resource][0],body));
    }else if(method==='PUT'&&value!==null&&!action&&master[resource]){
      result=await sql.begin(async transaction=>{
        if(resource==='employees')return saveEmployee(transaction,body,value);
        if(resource==='vehicles'){
          await find(transaction,'vehicles','vehicle_id',value,true);
          if(body.vehicle_status!=='available'&&(await execute(transaction,'SELECT 1 FROM dispatches WHERE vehicle_id=$1 AND returned_at IS NULL',[value])).length)throw new ApiError(409,'車輛有未歸還的派車紀錄，請先完成歸還。');
        }
        return update(transaction,master[resource][0],master[resource][1],value,body);
      });
    }else if(method==='DELETE'&&value!==null&&!action){
      if(!master[resource])throw new ApiError(405,'歷史紀錄不提供刪除，請使用取消或歸還流程。');
      result=await sql.begin(async transaction=>{await find(transaction,...master[resource],value);await execute(transaction,`DELETE FROM ${master[resource][0]} WHERE ${master[resource][1]}=$1`,[value]);return {deleted:true};});
    }else if(method==='POST'&&resource==='applications'&&value===null&&!action){
      status=201;result=await sql.begin(transaction=>insert(transaction,'applications',body));
    }else if(method==='POST'&&resource==='applications'&&value!==null&&['review','cancel'].includes(action)){
      result=await sql.begin(async transaction=>{
        const row=await find(transaction,'applications','application_id',value,true);
        if(action==='review'){
          if(row.approval_status!=='pending')throw new ApiError(409,'僅待審核申請可以核准或駁回。');
          return update(transaction,'applications','application_id',value,body);
        }
        if(!['pending','approved'].includes(row.approval_status)||(await execute(transaction,'SELECT 1 FROM dispatches WHERE application_id=$1',[value])).length)throw new ApiError(409,'此申請已結案或已派車，無法取消。');
        return update(transaction,'applications','application_id',value,{approval_status:'cancelled'});
      });
    }else if(method==='POST'&&resource==='dispatches'&&value===null&&!action){
      status=201;result=await sql.begin(async transaction=>{
        const owner=await find(transaction,'applications','application_id',body.application_id);
        await find(transaction,'employees','employee_id',owner.employee_id,true);
        const application=await find(transaction,'applications','application_id',body.application_id,true);
        const vehicle=await find(transaction,'vehicles','vehicle_id',body.vehicle_id,true);
        if(application.approval_status!=='approved')throw new ApiError(409,'請先核准申請，再進行派車。');
        if(vehicle.vehicle_status!=='available')throw new ApiError(409,'此車輛目前維修中或已停用。');
        if(Date.parse(body.actual_start_date)<new Date(application.requested_start_date).getTime()||Date.parse(body.actual_end_date)>new Date(application.requested_end_date).getTime())throw new ApiError(409,'派車期間必須在申請期間內。');
        const conflict=await execute(transaction,`SELECT 1 FROM dispatches ds JOIN applications a USING(application_id)
          WHERE (ds.vehicle_id=$1 OR a.employee_id=$2) AND ds.actual_start_date<$3
          AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$4`,
          [body.vehicle_id,application.employee_id,body.actual_end_date,body.actual_start_date]);
        if(conflict.length)throw new ApiError(409,'車輛或員工在此期間已有派車，請選擇其他車輛或時段。');
        return insert(transaction,'dispatches',body);
      });
    }else if(method==='POST'&&resource==='dispatches'&&value!==null&&action==='return'){
      result=await sql.begin(async transaction=>{
        const row=await find(transaction,'dispatches','dispatch_id',value,true);
        if(row.returned_at)throw new ApiError(409,'此派車已完成歸還。');
        const now=new Date();if(now<new Date(row.actual_start_date))throw new ApiError(409,'尚未開始使用，不能登記歸還。');
        return update(transaction,'dispatches','dispatch_id',value,{returned_at:now.toISOString()});
      });
    }else if(method==='POST'&&resource==='maintenance'&&value===null&&!action){
      status=201;result=await sql.begin(async transaction=>{
        await find(transaction,'vehicles','vehicle_id',body.vehicle_id,true);
        return insert(transaction,'maintenance_records',body);
      });
    }else if(method==='POST'&&resource==='refueling'&&value===null&&!action){
      status=201;result=await sql.begin(transaction=>insert(transaction,'refueling_records',body));
    }else throw new ApiError(405,'不支援的操作。');
    return Response.json(result,{status});
  }catch(error){
    if(error instanceof ApiError)return Response.json({detail:error.message},{status:error.status});
    if(error.code==='23505')return Response.json({detail:({'maintenance_records_pkey':'同一輛車同一天只能有一筆保養紀錄。','refueling_records_pkey':'同一輛車同一天只能有一筆加油紀錄。'})[error.constraint_name]||'資料重複：車牌、名稱或派車申請已存在。'},{status:409});
    if(error.code==='23503')return Response.json({detail:'關聯資料不存在，或此資料已有歷史紀錄，無法刪除。'},{status:409});
    if(error.code==='23514'||error.code==='22003')return Response.json({detail:'資料不符合資料庫限制，請檢查日期、數值及必填欄位。'},{status:409});
    console.error('FleetFlow database request failed',{code:error.code||error.name});
    return Response.json({detail:'資料庫暫時無法連線，請稍後再試。'},{status:503});
  }finally{if(sql)await sql.end({timeout:1}).catch(()=>{});}
}
