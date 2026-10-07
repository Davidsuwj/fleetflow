import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import hmac
import psycopg
from psycopg import sql
from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from backend.db import connection
from backend.bootstrap import bootstrap
from backend.employee_service import build_router
from backend.auth import build_auth
from backend.schemas import (Department, Employee, Vehicle, Application, Review,
                             Dispatch, Maintenance, Refueling)

log = logging.getLogger('fleetflow')

@asynccontextmanager
async def lifespan(app):
    if len(os.environ.get('SERVICE_API_KEY','')) < 32:
        raise RuntimeError('SERVICE_API_KEY 至少 32 字元')
    bootstrap()
    yield

def service_access(request:Request,x_fleetflow_key:str|None=Header(default=None)):
    if request.url.path == '/health':
        return
    if request.url.path.startswith('/api/auth/') or request.url.path.startswith(('/api/employee-context','/api/my-applications','/api/my-dispatches','/api/availability')) or (request.url.path=='/api/vehicles' and request.method=='GET'):
        return # These routes require an employee session instead of a service key.
    local = request.client and request.client.host in ('127.0.0.1','::1') and request.url.hostname in ('127.0.0.1','localhost','::1') and not any(request.headers.get(k) for k in ('x-forwarded-for','x-forwarded-host','forwarded'))
    expected = os.environ.get('SERVICE_API_KEY','')
    if not local and (len(expected) < 32 or not hmac.compare_digest(x_fleetflow_key or '',expected)):
        raise HTTPException(403,'請從私人 GPT Site 操作系統。')

app = FastAPI(title='FleetFlow API',version='1.0.0',lifespan=lifespan,dependencies=[Depends(service_access)])
auth_router,require_employee=build_auth(lambda: connection())
app.include_router(auth_router)
app.add_middleware(CORSMiddleware,
    allow_origins=[v.strip() for v in os.environ.get('CORS_ORIGINS','http://127.0.0.1:8767').split(',') if v.strip()],
    allow_credentials=False,allow_methods=['GET','POST','PUT','DELETE'],
    allow_headers=['Content-Type','X-Fleetflow-Key','ngrok-skip-browser-warning'])

@app.exception_handler(psycopg.IntegrityError)
def integrity_error(request, exc):
    if isinstance(exc, psycopg.errors.UniqueViolation):
        message = {'maintenance_records_pkey':'同一輛車同一天只能有一筆保養紀錄。',
                   'refueling_records_pkey':'同一輛車同一天只能有一筆加油紀錄。'}.get(exc.diag.constraint_name, '資料重複：車牌、名稱或派車申請已存在。')
    elif isinstance(exc, psycopg.errors.ForeignKeyViolation):
        message = '關聯資料不存在，或此資料已有歷史紀錄，無法刪除。'
    else:
        message = '資料不符合資料庫限制，請檢查日期、數值及必填欄位。'
    return JSONResponse(status_code=409,content={'detail':message})

@app.exception_handler(psycopg.OperationalError)
def database_error(request, exc):
    log.error('PostgreSQL unavailable (%s)',type(exc).__name__)
    return JSONResponse(status_code=503,content={'detail':'資料庫暫時無法連線，請稍後再試。'})


def must_find(conn, table, key, value, lock=False):
    query = sql.SQL('SELECT * FROM {} WHERE {}=%s' + (' FOR UPDATE' if lock else '')).format(sql.Identifier(table),sql.Identifier(key))
    row = conn.execute(query,(value,)).fetchone()
    if not row:
        raise HTTPException(404,'找不到指定資料。')
    return row

def insert(conn, table, values):
    keys = list(values)
    query = sql.SQL('INSERT INTO {} ({}) VALUES ({}) RETURNING *').format(
        sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,keys)),sql.SQL(',').join(sql.Placeholder() for _ in keys))
    return conn.execute(query,[values[k] for k in keys]).fetchone()

def update(conn, table, key, value, values):
    must_find(conn,table,key,value)
    query = sql.SQL('UPDATE {} SET {} WHERE {}=%s RETURNING *').format(sql.Identifier(table),
        sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(k)) for k in values),sql.Identifier(key))
    return conn.execute(query,[*values.values(),value]).fetchone()

@app.get('/health')
def health():
    return {'status':'ok','service':'FleetFlow Python API','version':'1.0.0'}

@app.get('/api/health')
def db_health():
    with connection() as conn:
        conn.execute('SELECT 1')
    return {'status':'ok','database':'connected'}

@app.get('/api/departments')
def departments():
    with connection() as c:
        return c.execute('SELECT * FROM departments ORDER BY department_id').fetchall()

@app.post('/api/departments',status_code=201)
def create_department(body:Department):
    with connection() as c:
        return insert(c,'departments',body.model_dump())

@app.put('/api/departments/{record_id}')
def edit_department(record_id:int,body:Department):
    with connection() as c:
        return update(c,'departments','department_id',record_id,body.model_dump())

@app.get('/api/employees')
def employees():
    with connection() as c:
        return c.execute("""SELECT e.employee_id,e.employee_code,e.employee_name,e.department_id,d.department_name,
            COALESCE((SELECT array_agg(p.phone_number ORDER BY p.phone_number) FROM employee_phones p
                      WHERE p.employee_id=e.employee_id), ARRAY[]::varchar[]) AS phone_numbers
            FROM employees e JOIN departments d USING(department_id)
            ORDER BY e.employee_id""").fetchall()

def save_employee(c,body,record_id=None):
    values = body.model_dump(exclude={'phone_numbers'},exclude_none=True)
    row = update(c,'employees','employee_id',record_id,values) if record_id else insert(c,'employees',values)
    c.execute('DELETE FROM employee_phones WHERE employee_id=%s',(row['employee_id'],))
    for phone in body.phone_numbers:
        c.execute('INSERT INTO employee_phones(employee_id,phone_number) VALUES (%s,%s)',(row['employee_id'],phone))
    row.pop('password',None)
    if body.password:
        c.execute('DELETE FROM auth_sessions WHERE employee_id=%s',(row['employee_id'],))
    return {**row,'phone_numbers':body.phone_numbers}

@app.post('/api/employees',status_code=201)
def create_employee(body:Employee):
    with connection() as c:
        return save_employee(c,body)

@app.put('/api/employees/{record_id}')
def edit_employee(record_id:int,body:Employee):
    with connection() as c:
        return save_employee(c,body,record_id)

@app.get('/api/vehicles')
def vehicles(employee_id:int=Depends(require_employee)):
    with connection() as c:
        return c.execute("""SELECT v.*, EXISTS(SELECT 1 FROM dispatches d WHERE d.vehicle_id=v.vehicle_id
            AND d.returned_at IS NULL AND now() >= d.actual_start_date AND now() < d.actual_end_date) AS in_use
            FROM vehicles v ORDER BY vehicle_id""").fetchall()

@app.post('/api/vehicles',status_code=201)
def create_vehicle(body:Vehicle):
    with connection() as c:
        return insert(c,'vehicles',body.model_dump())

@app.put('/api/vehicles/{record_id}')
def edit_vehicle(record_id:int,body:Vehicle):
    with connection() as c:
        must_find(c,'vehicles','vehicle_id',record_id,True)
        if body.vehicle_status != 'available' and c.execute('SELECT 1 FROM dispatches WHERE vehicle_id=%s AND returned_at IS NULL',(record_id,)).fetchone():
            raise HTTPException(409,'車輛有未歸還的派車紀錄，請先完成歸還。')
        return update(c,'vehicles','vehicle_id',record_id,body.model_dump())

APPLICATION_QUERY = '''SELECT a.*,e.employee_name,d.department_name,ds.dispatch_id,ds.vehicle_id,v.license_plate,
    ds.returned_at,ds.actual_start_date AS dispatch_start_date,ds.actual_end_date AS dispatch_end_date FROM applications a JOIN employees e USING(employee_id)
    JOIN departments d ON d.department_id=e.department_id
    LEFT JOIN dispatches ds USING(application_id) LEFT JOIN vehicles v ON v.vehicle_id=ds.vehicle_id'''

@app.get('/api/applications')
def applications(status:str|None=None):
    with connection() as c:
        return c.execute(APPLICATION_QUERY + ' WHERE (%s::text IS NULL OR a.approval_status=%s) ORDER BY a.created_at DESC',
                         (status,status)).fetchall()

@app.post('/api/applications',status_code=201)
def create_application(body:Application):
    with connection() as c:
        return insert(c,'applications',body.model_dump())

@app.post('/api/applications/{record_id}/review')
def review(record_id:int,body:Review):
    with connection() as c:
        row = must_find(c,'applications','application_id',record_id,True)
        if row['approval_status'] != 'pending':
            raise HTTPException(409,'僅待審核申請可以核准或駁回。')
        return update(c,'applications','application_id',record_id,body.model_dump())

@app.post('/api/applications/{record_id}/cancel')
def cancel(record_id:int):
    with connection() as c:
        row = must_find(c,'applications','application_id',record_id,True)
        if row['approval_status'] not in ('pending','approved') or c.execute('SELECT 1 FROM dispatches WHERE application_id=%s',(record_id,)).fetchone():
            raise HTTPException(409,'此申請已結案或已派車，無法取消。')
        return update(c,'applications','application_id',record_id,{'approval_status':'cancelled'})

DISPATCH_QUERY = '''SELECT ds.*,v.license_plate,v.vehicle_model,a.purpose,e.employee_name,a.employee_id
    FROM dispatches ds JOIN vehicles v USING(vehicle_id) JOIN applications a USING(application_id)
    JOIN employees e USING(employee_id)'''

@app.get('/api/dispatches')
def dispatches():
    with connection() as c:
        return c.execute(DISPATCH_QUERY + ' ORDER BY ds.actual_start_date DESC').fetchall()

@app.post('/api/dispatches',status_code=201)
def create_dispatch(body:Dispatch):
    with connection() as c:
        # Serializes reservations for the same employee as well as the same vehicle.
        owner = must_find(c,'applications','application_id',body.application_id)
        must_find(c,'employees','employee_id',owner['employee_id'],True)
        row = must_find(c,'applications','application_id',body.application_id,True)
        vehicle = must_find(c,'vehicles','vehicle_id',body.vehicle_id,True)
        if row['approval_status'] != 'approved':
            raise HTTPException(409,'請先核准申請，再進行派車。')
        if vehicle['vehicle_status'] != 'available':
            raise HTTPException(409,'此車輛目前維修中或已停用。')
        if body.actual_start_date < row['requested_start_date'] or body.actual_end_date > row['requested_end_date']:
            raise HTTPException(409,'派車期間必須在申請期間內。')
        conflict = c.execute('''SELECT 1 FROM dispatches ds JOIN applications a USING(application_id)
            WHERE (ds.vehicle_id=%s OR a.employee_id=%s)
            AND ds.actual_start_date < %s AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date) > %s''',
            (body.vehicle_id,row['employee_id'],body.actual_end_date,body.actual_start_date)).fetchone()
        if conflict:
            raise HTTPException(409,'車輛或員工在此期間已有派車，請選擇其他車輛或時段。')
        return insert(c,'dispatches',body.model_dump())

@app.post('/api/dispatches/{record_id}/return')
def return_vehicle(record_id:int):
    with connection() as c:
        row = must_find(c,'dispatches','dispatch_id',record_id,True)
        if row['returned_at']:
            raise HTTPException(409,'此派車已完成歸還。')
        now = datetime.now(timezone.utc)
        if now < row['actual_start_date']:
            raise HTTPException(409,'尚未開始使用，不能登記歸還。')
        return update(c,'dispatches','dispatch_id',record_id,{'returned_at':now})

@app.get('/api/maintenance')
def maintenance():
    with connection() as c:
        return c.execute('SELECT m.*,v.license_plate FROM maintenance_records m JOIN vehicles v USING(vehicle_id) ORDER BY maintenance_date DESC, m.vehicle_id').fetchall()

@app.post('/api/maintenance',status_code=201)
def create_maintenance(body:Maintenance):
    with connection() as c:
        must_find(c,'vehicles','vehicle_id',body.vehicle_id,True)
        return insert(c,'maintenance_records',body.model_dump())

@app.get('/api/refueling')
def refueling():
    with connection() as c:
        return c.execute('SELECT r.*,v.license_plate FROM refueling_records r JOIN vehicles v USING(vehicle_id) ORDER BY refueling_date DESC,r.vehicle_id').fetchall()

@app.post('/api/refueling',status_code=201)
def create_refueling(body:Refueling):
    with connection() as c:
        return insert(c,'refueling_records',body.model_dump())

app.include_router(build_router(lambda: connection(), APPLICATION_QUERY, DISPATCH_QUERY,require_employee))

@app.delete('/api/{resource}/{record_id}')
def delete_master(resource:str,record_id:int):
    tables = {'departments':('departments','department_id'),'employees':('employees','employee_id'),'vehicles':('vehicles','vehicle_id')}
    if resource not in tables:
        raise HTTPException(405,'歷史紀錄不提供刪除，請使用取消或歸還流程。')
    table,key = tables[resource]
    with connection() as c:
        must_find(c,table,key,record_id)
        c.execute(sql.SQL('DELETE FROM {} WHERE {}=%s').format(sql.Identifier(table),sql.Identifier(key)),(record_id,))
    return {'deleted':True}

@app.get('/api/dashboard')
def dashboard():
    with connection() as c:
        vehicles_count = c.execute('SELECT count(*) AS n FROM vehicles WHERE vehicle_status<>\'retired\'').fetchone()['n']
        stats = c.execute('''SELECT count(*) FILTER(WHERE approval_status='pending') AS pending,
            count(*) FILTER(WHERE approval_status='approved') AS approved FROM applications''').fetchone()
        active = c.execute('''SELECT count(*) AS n FROM dispatches ds JOIN applications a USING(application_id)
            WHERE ds.returned_at IS NULL''').fetchone()['n']
        costs = c.execute('''SELECT
            COALESCE((SELECT sum(maintenance_cost) FROM maintenance_records WHERE date_trunc('month',maintenance_date)=date_trunc('month',CURRENT_DATE)),0)
            + COALESCE((SELECT sum(fuel_cost) FROM refueling_records WHERE date_trunc('month',refueling_date)=date_trunc('month',CURRENT_DATE)),0) AS cost''').fetchone()['cost']
    return {'vehicles':vehicles_count,**stats,'unreturned':active,'month_cost':costs}

@app.get('/api/statistics')
def statistics():
    with connection() as c:
        status = c.execute('SELECT approval_status,count(*) AS count FROM applications GROUP BY approval_status ORDER BY approval_status').fetchall()
        departments = c.execute('''SELECT d.department_name,count(a.application_id) AS applications,
            count(ds.dispatch_id) AS dispatches FROM departments d
            LEFT JOIN employees e USING(department_id) LEFT JOIN applications a USING(employee_id)
            LEFT JOIN dispatches ds USING(application_id) GROUP BY d.department_id,d.department_name
            ORDER BY applications DESC,d.department_name''').fetchall()
        months = c.execute('''WITH months AS (
            SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',
                                   date_trunc('month',CURRENT_DATE),interval '1 month')::date AS month
        ), maintenance AS (
            SELECT date_trunc('month',maintenance_date)::date AS month,sum(maintenance_cost) AS cost
            FROM maintenance_records GROUP BY 1
        ), fuel AS (
            SELECT date_trunc('month',refueling_date)::date AS month,sum(fuel_cost) AS cost
            FROM refueling_records GROUP BY 1
        ) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE(a.cost,0) AS maintenance_cost,
            COALESCE(f.cost,0) AS fuel_cost,COALESCE(a.cost,0)+COALESCE(f.cost,0) AS total
            FROM months m LEFT JOIN maintenance a USING(month) LEFT JOIN fuel f USING(month) ORDER BY m.month''').fetchall()
        totals = c.execute('''SELECT (SELECT count(*) FROM applications) AS applications,
            (SELECT count(*) FROM dispatches) AS dispatches,
            (SELECT count(*) FROM dispatches WHERE returned_at IS NOT NULL) AS returned,
            (SELECT COALESCE(sum(maintenance_cost),0) FROM maintenance_records)
            + (SELECT COALESCE(sum(fuel_cost),0) FROM refueling_records) AS lifetime_cost''').fetchone()
    return {'totals':totals,'approval_status':status,'departments':departments,'months':months}

# Same-origin local frontend; production frontend is hosted by GPT Sites.
app.mount('/',StaticFiles(directory=Path(__file__).resolve().parent.parent/'dist',html=True),name='frontend')
