import {ApiError,readBody,validate,id} from './validation.js';
import {digest} from './auth.js';
import {queries} from './queries.js';
const encoder=new TextEncoder(),COOKIE='fleetflow_dev_session';
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const bytes=value=>Uint8Array.from(value.match(/../g)||[],v=>parseInt(v,16));
export async function hashDevPassword(password,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const hash=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:100000},key,256);
  return `pbkdf2-sha256$100000$${salt}$${hex(hash)}`;
}
export async function verifyDevPassword(password,stored){
  if(typeof password!=='string'||password.length<1||password.length>128||typeof stored!=='string'||!/^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored))return false;
  const actual=await hashDevPassword(password,stored.split('$')[2]);let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^stored.charCodeAt(i);return diff===0;
}
function configured(env){if(!/^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(env.DEV_ADMIN_PASSWORD_HASH||''))throw new ApiError(503,'DEV 管理帳號尚未啟用。');}
function cookie(request,token='',age=28800){return `${COOKIE}=${token}; Path=/api/dev; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
// Additive schema-only bootstrap for the external PostgreSQL deployment. Existing
// domain and employee authentication tables/data are never changed.
export async function ensureDevSessions(sql){
  await sql.begin(async tx=>{
    await tx.unsafe('SELECT pg_advisory_xact_lock(681031426)');
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS dev_auth_sessions (
      session_hash varchar(64) PRIMARY KEY, csrf_token varchar(64) NOT NULL,
      credential_version varchar(64) NOT NULL, expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
  });
}
export async function requireDevSession(request,env,sql){
  configured(env);
  const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)fleetflow_dev_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)throw new ApiError(401,'請先使用 DEV 帳號登入。');
  await ensureDevSessions(sql);
  const session=(await sql.unsafe('SELECT session_hash,csrf_token FROM dev_auth_sessions WHERE session_hash=$1 AND credential_version=$2 AND expires_at>now()',[await digest(token),await digest(env.DEV_ADMIN_PASSWORD_HASH)]))[0];
  if(!session)throw new ApiError(401,'DEV 登入已失效，請重新登入。');
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('X-CSRF-Token')!==session.csrf_token)throw new ApiError(403,'操作驗證失敗，請重新登入。');
  return session;
}
export function validateDevVehicle(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['license_plate','vehicle_model','vehicle_status'].includes(k)))throw new ApiError(422,'車輛資料包含未知欄位。');
  const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new ApiError(422,`${label}不可空白或超過 ${max} 字元。`);return value.trim();};
  if(!['available','maintenance','retired'].includes(body.vehicle_status))throw new ApiError(422,'請選擇有效車況。');
  return {license_plate:text(text(body.license_plate,20,'車牌').toUpperCase(),20,'車牌'),vehicle_model:text(body.vehicle_model,100,'車型'),vehicle_status:body.vehicle_status};
}
// Serialize plate changes so a differently-cased legacy plate cannot race a
// new vehicle. Parameters stay bound and the existing UNIQUE constraint remains.
async function requireUniquePlate(sql,plate,except=0){
  await sql.unsafe('SELECT pg_advisory_xact_lock(681031427)');
  if((await sql.unsafe('SELECT 1 FROM vehicles WHERE upper(trim(license_plate))=$1 AND vehicle_id<>$2',[plate,except])).length)throw new ApiError(409,'此車牌已存在（包含已封存車輛），請改用其他車牌或編輯原車輛復原。');
}
export function validateImport(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['type','records'].includes(k))||!['maintenance','refueling'].includes(body.type)||!Array.isArray(body.records)||!body.records.length||body.records.length>100)throw new ApiError(422,'請上傳 1 至 100 筆保養或加油紀錄。');
  const seen=new Set();return {type:body.type,records:body.records.map((row,index)=>{
    let record;try{record=validate(body.type,row);}catch(e){throw new ApiError(422,`第 ${index+1} 筆：${e.message}`);}
    const key=`${record.vehicle_id}:${record[body.type==='maintenance'?'maintenance_date':'refueling_date']}`;
    if(seen.has(key))throw new ApiError(422,`第 ${index+1} 筆與檔案內其他紀錄的車輛、日期重複。`);seen.add(key);return record;
  })};
}
async function insertRecord(sql,type,body){
  const table=type==='maintenance'?'maintenance_records':'refueling_records',keys=Object.keys(body);
  return (await sql.unsafe(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(body)))[0];
}
export async function handleDevApi(request,env,sql){
  configured(env);const {pathname}=new URL(request.url),method=request.method;
  if(pathname==='/api/dev/login'&&method==='POST'){
    const body=await readBody(request);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['username','password'].includes(k))||typeof body.username!=='string'||typeof body.password!=='string'||body.password.length>128)throw new ApiError(422,'請填寫 DEV 帳號與密碼。');
    await ensureDevSessions(sql);
    const ip=await digest(request.headers.get('CF-Connecting-IP')||'local');
    const outcome=await sql.begin(async tx=>{
      const buckets=['dev:account',`dev:ip:${ip}`],limits=[];
      for(const bucket of buckets){
        await tx.unsafe('INSERT INTO auth_login_limits(bucket) VALUES($1) ON CONFLICT DO NOTHING',[bucket]);
        let row=(await tx.unsafe('SELECT * FROM auth_login_limits WHERE bucket=$1 FOR UPDATE',[bucket]))[0];
        if(new Date(row.window_start).getTime()<Date.now()-900000)row=(await tx.unsafe('UPDATE auth_login_limits SET attempts=0,window_start=now() WHERE bucket=$1 RETURNING *',[bucket]))[0];limits.push(row);
      }
      if(limits.some((r,i)=>r.attempts>=(i===0?10:30)))return {status:429};
      const valid=await verifyDevPassword(body.password,env.DEV_ADMIN_PASSWORD_HASH);
      if(body.username.trim().toUpperCase()!=='DEV'||!valid){await tx.unsafe('UPDATE auth_login_limits SET attempts=attempts+1 WHERE bucket=ANY($1::text[])',[buckets]);return {status:401};}
      await tx.unsafe('DELETE FROM auth_login_limits WHERE bucket=$1',[buckets[0]]);
      await tx.unsafe('DELETE FROM dev_auth_sessions WHERE expires_at<=now()');
      const token=random(),csrf=random();
      await tx.unsafe("INSERT INTO dev_auth_sessions(session_hash,csrf_token,credential_version,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[await digest(token),csrf,await digest(env.DEV_ADMIN_PASSWORD_HASH)]);
      return {token,csrf_token:csrf};
    });
    if(outcome.status)throw new ApiError(outcome.status,outcome.status===429?'登入嘗試過多，請 15 分鐘後再試。':'DEV 帳號或密碼錯誤。');
    return Response.json({role:'dev',username:'DEV',csrf_token:outcome.csrf_token},{headers:{'Set-Cookie':cookie(request,outcome.token)}});
  }
  const session=await requireDevSession(request,env,sql);
  if(pathname==='/api/dev/session'&&method==='GET')return Response.json({role:'dev',username:'DEV',csrf_token:session.csrf_token});
  if(pathname==='/api/dev/logout'&&method==='POST'){
    await sql.unsafe('DELETE FROM dev_auth_sessions WHERE session_hash=$1',[session.session_hash]);
    return Response.json({logged_out:true},{headers:{'Set-Cookie':cookie(request,'',0)}});
  }
  if(pathname==='/api/dev/context'&&method==='GET')return Response.json(await sql.begin('isolation level repeatable read read only',async tx=>({vehicles:await tx.unsafe(queries.vehicles[0]),maintenance:await tx.unsafe(queries.maintenance[0]),refueling:await tx.unsafe(queries.refueling[0])})));
  if(pathname==='/api/dev/vehicles'&&method==='POST'){
    const body=validateDevVehicle(await readBody(request));
    const result=await sql.begin(async tx=>{
      await requireUniquePlate(tx,body.license_plate);
      return (await tx.unsafe('INSERT INTO vehicles (license_plate,vehicle_model,vehicle_status) VALUES ($1,$2,$3) RETURNING *',[body.license_plate,body.vehicle_model,body.vehicle_status]))[0];
    });return Response.json(result,{status:201});
  }
  const match=pathname.match(/^\/api\/dev\/vehicles\/([0-9]+)$/);
  if(match&&method==='PUT'){
    const vehicleId=id(Number(match[1])),body=validateDevVehicle(await readBody(request));
    const result=await sql.begin(async tx=>{
      await requireUniquePlate(tx,body.license_plate,vehicleId);
      const vehicle=(await tx.unsafe('SELECT * FROM vehicles WHERE vehicle_id=$1 FOR UPDATE',[vehicleId]))[0];if(!vehicle)throw new ApiError(404,'找不到指定車輛。');
      if(body.vehicle_status!=='available'&&(await tx.unsafe('SELECT 1 FROM dispatches WHERE vehicle_id=$1 AND returned_at IS NULL',[vehicleId])).length)throw new ApiError(409,'車輛有尚未歸還或未開始的預約，請先完成歸還或取消預約。');
      return (await tx.unsafe('UPDATE vehicles SET license_plate=$1,vehicle_model=$2,vehicle_status=$3 WHERE vehicle_id=$4 RETURNING *',[body.license_plate,body.vehicle_model,body.vehicle_status,vehicleId]))[0];
    });return Response.json(result);
  }
  if(match&&method==='DELETE'){
    const vehicleId=id(Number(match[1]));
    const result=await sql.begin(async tx=>{
      const vehicle=(await tx.unsafe('SELECT * FROM vehicles WHERE vehicle_id=$1 FOR UPDATE',[vehicleId]))[0];if(!vehicle)throw new ApiError(404,'找不到指定車輛。');
      if((await tx.unsafe('SELECT 1 FROM dispatches WHERE vehicle_id=$1 AND returned_at IS NULL',[vehicleId])).length)throw new ApiError(409,'此車輛有尚未歸還或未開始的預約，無法刪除（封存）。請先完成歸還或取消預約。');
      // Soft deletion: preserve the vehicle PK and every historical relationship.
      // Repeated requests are safe; editing the status restores the same vehicle.
      const row=(await tx.unsafe("UPDATE vehicles SET vehicle_status='retired' WHERE vehicle_id=$1 RETURNING *",[vehicleId]))[0];
      return {...row,archived:true};
    });return Response.json(result);
  }
  const type=pathname.split('/')[3];
  if(method==='POST'&&pathname===`/api/dev/${type}`&&['maintenance','refueling','import'].includes(type)){
    const raw=await readBody(request),batch=type==='import'?validateImport(raw):{type,records:[validate(type,raw)]};
    const created=await sql.begin(async tx=>{
      for(const vehicleId of [...new Set(batch.records.map(r=>r.vehicle_id))].sort((a,b)=>a-b))if(!(await tx.unsafe('SELECT vehicle_id FROM vehicles WHERE vehicle_id=$1 FOR UPDATE',[vehicleId])).length)throw new ApiError(422,`找不到車輛編號 ${vehicleId}，本次未寫入任何紀錄。`);
      const result=[];for(const record of batch.records)result.push(await insertRecord(tx,batch.type,record));return result;
    });return Response.json(type==='import'?{created:created.length}:created[0],{status:201});
  }
  throw new ApiError(404,'找不到指定 DEV API。');
}
