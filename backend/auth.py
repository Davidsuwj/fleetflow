"""Employee-ID/password demo authentication, matching the GPT Sites Worker."""
import hashlib
import hmac
import secrets
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

COOKIE='fleetflow_session'
def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

class Login(BaseModel):
    model_config=ConfigDict(extra='forbid')
    employee_code: str=Field(pattern=r'^EMP[0-9]{4,19}$',max_length=22)
    password: str=Field(min_length=1,max_length=128)

def build_auth(connection_factory):
    router=APIRouter(prefix='/api/auth',tags=['員工登入'])
    def require_employee(request: Request):
        token=request.cookies.get(COOKIE,'')
        if len(token)!=64 or any(ch not in '0123456789abcdef' for ch in token):
            raise HTTPException(401,'請先登入。')
        with connection_factory() as c:
            session=c.execute('SELECT s.* FROM auth_sessions s JOIN employees e USING(employee_id) WHERE session_hash=%s AND expires_at>now() AND e.password IS NOT NULL',(digest(token),)).fetchone()
        if not session:
            raise HTTPException(401,'登入已失效，請重新登入。')
        requested=request.query_params.get('employee_id')
        if requested is not None and requested!=str(session['employee_id']):
            raise HTTPException(403,'無法存取其他員工資料。')
        if request.method not in ('GET','HEAD'):
            if request.headers.get('origin') not in (None,str(request.base_url).rstrip('/')):
                raise HTTPException(403,'請在此網站內操作。')
            if not hmac.compare_digest(request.headers.get('x-csrf-token',''),session['csrf_token']):
                raise HTTPException(403,'操作驗證失敗，請重新登入。')
        request.state.session=session
        return session['employee_id']

    @router.post('/login')
    def login(body: Login,request: Request,response: Response):
        if request.headers.get('origin') not in (None,str(request.base_url).rstrip('/')):
            raise HTTPException(403,'請在此網站內操作。')
        status=None
        with connection_factory() as c:
            buckets=[f'account:{body.employee_code}','ip:'+digest(request.headers.get('cf-connecting-ip','local'))]
            limits=[]
            for key in buckets:
                c.execute('INSERT INTO auth_login_limits(bucket) VALUES(%s) ON CONFLICT DO NOTHING',(key,))
                row=c.execute('SELECT *,window_start<now()-interval \'15 minutes\' AS expired FROM auth_login_limits WHERE bucket=%s FOR UPDATE',(key,)).fetchone()
                if row['expired']:
                    row=c.execute('UPDATE auth_login_limits SET attempts=0,window_start=now() WHERE bucket=%s RETURNING *',(key,)).fetchone()
                limits.append(row)
            if any(row['attempts']>=(5 if i==0 else 30) for i,row in enumerate(limits)):
                status=429
            else:
                person=c.execute('SELECT employee_id,employee_code,employee_name,password FROM employees WHERE employee_code=%s FOR UPDATE',(body.employee_code,)).fetchone()
                if not person or not person['password'] or not hmac.compare_digest(body.password.encode(),person['password'].encode()):
                    c.execute('UPDATE auth_login_limits SET attempts=attempts+1 WHERE bucket=ANY(%s)',(buckets,));status=401
                else:
                    c.execute('DELETE FROM auth_login_limits WHERE bucket=%s',(buckets[0],))
                    c.execute('DELETE FROM auth_sessions WHERE expires_at<=now()')
                    token=secrets.token_hex(32);csrf=secrets.token_hex(32)
                    c.execute("INSERT INTO auth_sessions(session_hash,employee_id,csrf_token,expires_at) VALUES(%s,%s,%s,now()+interval '8 hours')",(digest(token),person['employee_id'],csrf))
        if status:
            raise HTTPException(status,'登入嘗試過多，請 15 分鐘後再試。' if status==429 else '工號或密碼錯誤。')
        response.set_cookie(COOKIE,token,max_age=28800,httponly=True,secure=request.url.scheme=='https',samesite='strict')
        return {'employee':{'employee_id':person['employee_id'],'employee_code':person['employee_code'],'employee_name':person['employee_name']},'csrf_token':csrf}

    @router.get('/session')
    def session(request: Request):
        employee=require_employee(request)
        with connection_factory() as c:
            person=c.execute('SELECT employee_id,employee_code,employee_name FROM employees WHERE employee_id=%s',(employee,)).fetchone()
        return {'employee':person,'csrf_token':request.state.session['csrf_token']}

    @router.post('/logout')
    def logout(request: Request,response: Response):
        require_employee(request)
        with connection_factory() as c:
            c.execute('DELETE FROM auth_sessions WHERE session_hash=%s',(request.state.session['session_hash'],))
        response.delete_cookie(COOKIE,httponly=True,secure=request.url.scheme=='https',samesite='strict')
        return {'logged_out':True}
    return router,require_employee
