import {readBody,ApiError} from './validation.js';
const encoder=new TextEncoder(),COOKIE='fleetflow_session';
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const random=length=>hex(crypto.getRandomValues(new Uint8Array(length)));
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function verifyPassword(password,stored){
  const actual=encoder.encode(password),expected=encoder.encode(stored||'');
  let difference=actual.length^expected.length;for(let i=0;i<Math.max(actual.length,expected.length);i++)difference|=(actual[i]||0)^(expected[i]||0);
  return typeof stored==='string'&&stored.length>0&&difference===0;
}
function cookie(request,token='',maxAge=28800){return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
function tokenFrom(request){const match=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)fleetflow_session=([a-f0-9]{64})(?:;|$)/);return match?.[1];}
export async function requireSession(request,sql){
  const token=tokenFrom(request);if(!token)throw new ApiError(401,'請先登入。');
  const session=(await sql.unsafe('SELECT s.employee_id,s.csrf_token,s.session_hash FROM auth_sessions s JOIN employees e USING(employee_id) WHERE s.session_hash=$1 AND s.expires_at>now() AND e.password IS NOT NULL',[await digest(token)]))[0];
  if(!session)throw new ApiError(401,'登入已失效，請重新登入。');
  const requested=new URL(request.url).searchParams.get('employee_id');
  if(requested!==null&&Number(requested)!==session.employee_id)throw new ApiError(403,'無法存取其他員工資料。');
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('X-CSRF-Token')!==session.csrf_token)throw new ApiError(403,'操作驗證失敗，請重新登入。');
  return session;
}
export async function handleAuth(request,sql){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path==='/api/auth/login'&&method==='POST'){
    const body=await readBody(request);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['employee_code','password'].includes(k))||typeof body.employee_code!=='string'||!/^EMP[0-9]{4,19}$/.test(body.employee_code)||typeof body.password!=='string'||body.password.length<1||body.password.length>128)throw new ApiError(422,'請填寫工號（例如 EMP0001）與密碼。');
    const code=body.employee_code,ip=await digest(request.headers.get('CF-Connecting-IP')||'local');
    const outcome=await sql.begin(async tx=>{
      const buckets=[`account:${code}`,`ip:${ip}`],limits=[];
      for(const key of buckets){
        await tx.unsafe('INSERT INTO auth_login_limits(bucket) VALUES($1) ON CONFLICT DO NOTHING',[key]);
        let row=(await tx.unsafe('SELECT * FROM auth_login_limits WHERE bucket=$1 FOR UPDATE',[key]))[0];
        if(new Date(row.window_start).getTime()<Date.now()-900000)row=(await tx.unsafe('UPDATE auth_login_limits SET attempts=0,window_start=now() WHERE bucket=$1 RETURNING *',[key]))[0];
        limits.push(row);
      }
      if(limits.some((r,i)=>r.attempts>=(i===0?5:30)))return {status:429};
      const person=(await tx.unsafe('SELECT employee_id,employee_code,employee_name,password FROM employees WHERE employee_code=$1 FOR UPDATE',[code]))[0];
      if(!await verifyPassword(body.password,person?.password)){
        await tx.unsafe('UPDATE auth_login_limits SET attempts=attempts+1 WHERE bucket=ANY($1::text[])',[buckets]);return {status:401};
      }
      await tx.unsafe('DELETE FROM auth_login_limits WHERE bucket=$1',[buckets[0]]);
      await tx.unsafe("DELETE FROM auth_sessions WHERE expires_at<=now()");
      const token=random(32),csrf=random(32);
      await tx.unsafe("INSERT INTO auth_sessions(session_hash,employee_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[await digest(token),person.employee_id,csrf]);
      return {token,csrf_token:csrf,employee:{employee_id:person.employee_id,employee_code:person.employee_code,employee_name:person.employee_name}};
    });
    if(outcome.status)return Response.json({detail:outcome.status===429?'登入嘗試過多，請 15 分鐘後再試。':'工號或密碼錯誤。'},{status:outcome.status});
    return Response.json({employee:outcome.employee,csrf_token:outcome.csrf_token},{headers:{'Set-Cookie':cookie(request,outcome.token)}});
  }
  if(path==='/api/auth/session'&&method==='GET'){
    const session=await requireSession(request,sql),person=(await sql.unsafe('SELECT employee_id,employee_code,employee_name FROM employees WHERE employee_id=$1',[session.employee_id]))[0];
    return Response.json({employee:person,csrf_token:session.csrf_token});
  }
  if(path==='/api/auth/logout'&&method==='POST'){
    const session=await requireSession(request,sql);await sql.unsafe('DELETE FROM auth_sessions WHERE session_hash=$1',[session.session_hash]);
    return Response.json({logged_out:true},{headers:{'Set-Cookie':cookie(request,'',0)}});
  }
  throw new ApiError(404,'找不到指定 API。');
}
