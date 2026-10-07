"""Integration checks use a disposable, unique schema, never the live fleetflow data."""
import os
import uuid
from contextlib import contextmanager
from datetime import datetime,timedelta,timezone
import pytest
from psycopg import sql
from fastapi.testclient import TestClient
from backend.db import connection, ROOT
from backend import main

@pytest.fixture(scope='module')
def test_db():
    name = 'fleetflow_test_' + uuid.uuid4().hex[:12]
    with connection() as c:
        c.execute((ROOT/'backend/schema.sql').read_text(encoding='utf-8').replace('fleetflow',name))
    @contextmanager
    def isolated():
        with connection() as c:
            c.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(name)))
            yield c
    yield isolated
    assert name.startswith('fleetflow_test_') and len(name)==27
    with connection() as c:
        c.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(name)))

@pytest.fixture
def client(test_db,monkeypatch):
    monkeypatch.setattr(main,'connection',test_db)
    monkeypatch.setenv('SERVICE_API_KEY','integration-service-key-32-characters-minimum')
    return TestClient(main.app)

@pytest.fixture
def admin_headers():
    return {'X-Fleetflow-Key':'integration-service-key-32-characters-minimum'}

@pytest.fixture
def resources(client,admin_headers):
    h=admin_headers;tag=uuid.uuid4().hex[:8]
    d=client.post('/api/departments',headers=h,json={'department_name':'Test '+tag}).json()
    e=client.post('/api/employees',headers=h,json={'employee_name':'Test Employee','department_id':d['department_id'],
        'password':'test-password-2026','phone_numbers':['0911-000-000','0912-000-000','0911-000-000']}).json()
    login=client.post('/api/auth/login',json={'employee_code':e['employee_code'],'password':'test-password-2026'})
    assert login.status_code==200
    h={**h,'Cookie':login.headers['set-cookie'].split(';')[0],'X-CSRF-Token':login.json()['csrf_token']}
    v=client.post('/api/vehicles',headers=h,json={'license_plate':'TEST-'+tag,'vehicle_model':'Rolls-Royce Cullinan 6.75 V12'}).json()
    start=datetime.now(timezone.utc)-timedelta(hours=1);end=start+timedelta(hours=3)
    app_body={'employee_id':e['employee_id'],'purpose':'Integration test','requested_start_date':start.isoformat(),'requested_end_date':end.isoformat()}
    app=client.post('/api/applications',headers=h,json=app_body).json()
    return {'department':d,'employee':e,'vehicle':v,'application':app,'app_body':app_body,'headers':h,
            'dispatch_body':{'application_id':app['application_id'],'vehicle_id':v['vehicle_id'],
                'actual_start_date':start.isoformat(),'actual_end_date':end.isoformat()}}

def approve(client,r,app_id=None):
    return client.post(f"/api/applications/{app_id or r['application']['application_id']}/review",headers=r['headers'],json={'approval_status':'approved'})

def future_employee_body(r):
    start=datetime.now(timezone.utc)+timedelta(days=2)
    return {**r['app_body'],'requested_start_date':start.isoformat(),'requested_end_date':(start+timedelta(hours=2)).isoformat()}

def employee_path(r,resource='my-applications',record=None,action=None):
    return '/api/'+resource+(f'/{record}' if record else '')+(f'/{action}' if action else '')+f"?employee_id={r['employee']['employee_id']}"

def test_employee_auto_approval_and_personal_context(client,resources):
    r=resources;body=future_employee_body(r)
    created=client.post(employee_path(r),headers=r['headers'],json=body)
    assert created.status_code==201
    assert created.json()['approval_status']=='approved' and created.json()['dispatch_id']
    assert client.post(employee_path(r),headers=r['headers'],json=body).status_code==409
    response=client.get(employee_path(r,'employee-context'),headers=r['headers'])
    assert response.status_code==200
    data=response.json();assert data['statistics']['totals']['applications']==2
    assert all(a['employee_id']==r['employee']['employee_id'] for a in data['applications'])
    assert len(data['statistics']['months'])==6
    assert client.get('/api/employee-context',headers=r['headers']).status_code==200
    assert 'password' not in data['employee']

def test_employee_edit_delete_and_cancel_future_booking(client,resources):
    r=resources;body=future_employee_body(r)
    first=client.post(employee_path(r),headers=r['headers'],json=body).json()
    path=employee_path(r,record=first['application_id'])
    edited=client.put(path,headers=r['headers'],json={**body,'purpose':'Rescheduled'})
    assert edited.status_code==200 and edited.json()['dispatch_id']==first['dispatch_id']
    assert client.delete(path,headers=r['headers']).status_code==200
    assert not client.get(employee_path(r,'my-dispatches'),headers=r['headers']).json()
    second=client.post(employee_path(r),headers=r['headers'],json=body).json()
    assert client.post(employee_path(r,record=second['application_id'],action='cancel'),headers=r['headers']).status_code==200
    assert not client.get(employee_path(r,'my-dispatches'),headers=r['headers']).json()
    assert client.put(employee_path(r,record=second['application_id']),headers=r['headers'],json=body).status_code==409
    assert client.delete(employee_path(r,record=second['application_id']),headers=r['headers']).status_code==200

def test_employee_started_and_returned_trip_history_is_preserved(client,resources):
    r=resources;approve(client,r)
    trip=client.post('/api/dispatches',headers=r['headers'],json=r['dispatch_body']).json()
    assert client.delete(employee_path(r,record=r['application']['application_id']),headers=r['headers']).status_code==409
    assert client.post(employee_path(r,'my-dispatches',trip['dispatch_id'],'return'),headers=r['headers']).status_code==200
    assert client.delete(employee_path(r,record=r['application']['application_id']),headers=r['headers']).status_code==409

def test_employee_cannot_operate_other_selected_employee_order(client,resources):
    r=resources;body=future_employee_body(r)
    other=client.post('/api/employees',headers=r['headers'],json={'employee_name':'Other employee','department_id':r['department']['department_id']}).json()
    first=client.post(employee_path(r),headers=r['headers'],json=body).json()
    path=f"/api/my-applications/{first['application_id']}?employee_id={other['employee_id']}"
    assert client.delete(path,headers=r['headers']).status_code==403
    assert client.put(path,headers=r['headers'],json={**body,'employee_id':other['employee_id']}).status_code==403

def test_private_gateway_required(client):
    assert client.get('/api/vehicles').status_code==401
    assert client.get('/api/vehicles',headers={'X-Fleetflow-Key':'wrong'}).status_code==401
    assert client.get('/health').status_code==200

def test_employee_login_without_separate_accounts(client,admin_headers,test_db):
    assert client.post('/api/auth/login',headers=admin_headers,json={}).status_code==422
    assert client.get('/api/accounts',headers=admin_headers).status_code==404
    with test_db() as c:
        assert c.execute("SELECT to_regclass('accounts') AS name").fetchone()['name'] is None

def test_multi_phone_and_restrict_delete(client,resources):
    r=resources
    assert len(r['employee']['phone_numbers'])==2
    assert client.delete(f"/api/departments/{r['department']['department_id']}",headers=r['headers']).status_code==409

def test_unique_plate(client,resources):
    r=resources
    assert client.post('/api/vehicles',headers=r['headers'],json={'license_plate':r['vehicle']['license_plate'],'vehicle_model':'Rolls-Royce Cullinan 6.75 V12'}).status_code==409

def test_invalid_period(client,resources):
    r=resources;b=dict(r['app_body']);b['requested_end_date']=b['requested_start_date']
    assert client.post('/api/applications',headers=r['headers'],json=b).status_code==422
    b=dict(r['app_body']);b['requested_start_date']='2026-10-06T12:00:00'
    assert client.post('/api/applications',headers=r['headers'],json=b).status_code==422

def test_dispatch_requires_approval(client,resources):
    r=resources
    assert client.post('/api/dispatches',headers=r['headers'],json=r['dispatch_body']).status_code==409

def test_one_dispatch_and_return(client,resources):
    r=resources;assert approve(client,r).status_code==200
    first=client.post('/api/dispatches',headers=r['headers'],json=r['dispatch_body']);assert first.status_code==201
    assert client.post('/api/dispatches',headers=r['headers'],json=r['dispatch_body']).status_code==409
    path=f"/api/dispatches/{first.json()['dispatch_id']}/return"
    assert client.post(path,headers=r['headers']).status_code==200
    assert client.post(path,headers=r['headers']).status_code==409

def test_vehicle_overlap_and_adjacent(client,resources):
    r=resources;approve(client,r)
    assert client.post('/api/dispatches',headers=r['headers'],json=r['dispatch_body']).status_code==201
    other=client.post('/api/employees',headers=r['headers'],json={'employee_name':'Other','department_id':r['department']['department_id']}).json()
    b={**r['app_body'],'employee_id':other['employee_id']};app=client.post('/api/applications',headers=r['headers'],json=b).json();approve(client,r,app['application_id'])
    assert client.post('/api/dispatches',headers=r['headers'],json={**r['dispatch_body'],'application_id':app['application_id']}).status_code==409
    start=datetime.fromisoformat(r['app_body']['requested_end_date']);end=start+timedelta(hours=2)
    app=client.post('/api/applications',headers=r['headers'],json={**b,'requested_start_date':start.isoformat(),'requested_end_date':end.isoformat()}).json();approve(client,r,app['application_id'])
    assert client.post('/api/dispatches',headers=r['headers'],json={**r['dispatch_body'],'application_id':app['application_id'],'actual_start_date':start.isoformat(),'actual_end_date':end.isoformat()}).status_code==201

def test_employee_overlap(client,resources):
    r=resources;approve(client,r);client.post('/api/dispatches',headers=r['headers'],json=r['dispatch_body'])
    v=client.post('/api/vehicles',headers=r['headers'],json={'license_plate':'OTHER-'+uuid.uuid4().hex[:8],'vehicle_model':'Rolls-Royce Cullinan 6.75 V12'}).json()
    app=client.post('/api/applications',headers=r['headers'],json=r['app_body']).json();approve(client,r,app['application_id'])
    assert client.post('/api/dispatches',headers=r['headers'],json={**r['dispatch_body'],'application_id':app['application_id'],'vehicle_id':v['vehicle_id']}).status_code==409

def test_maintenance_weak_key_and_money(client,resources):
    r=resources;body={'vehicle_id':r['vehicle']['vehicle_id'],'maintenance_date':'2026-10-06','maintenance_item':'Oil','maintenance_cost':'800.00'}
    a=client.post('/api/maintenance',headers=r['headers'],json=body);b=client.post('/api/maintenance',headers=r['headers'],json=body)
    assert a.status_code==201 and b.status_code==409
    assert 'maintenance_seq' not in a.json() and '同一天' in b.json()['detail']
    assert client.post('/api/maintenance',headers=r['headers'],json={**body,'maintenance_date':'2026-10-07'}).status_code==201
    assert client.post('/api/maintenance',headers=r['headers'],json={**body,'maintenance_cost':'-1'}).status_code==422

def test_refueling_date_partial_key_and_vehicle_scope(client,resources):
    r=resources;h=r['headers'];body={'vehicle_id':r['vehicle']['vehicle_id'],'refueling_date':'2026-10-06','fuel_liters':'10.125','fuel_cost':'350.00'}
    first=client.post('/api/refueling',headers=h,json=body)
    assert first.status_code==201 and 'refueling_id' not in first.json()
    duplicate=client.post('/api/refueling',headers=h,json=body)
    assert duplicate.status_code==409 and '同一天' in duplicate.json()['detail']
    assert client.post('/api/refueling',headers=h,json={**body,'refueling_date':'2026-10-07'}).status_code==201
    car=client.post('/api/vehicles',headers=h,json={'license_plate':'DATE-'+uuid.uuid4().hex[:8]}).json()
    assert client.post('/api/refueling',headers=h,json={**body,'vehicle_id':car['vehicle_id']}).status_code==201
    maintenance={'vehicle_id':r['vehicle']['vehicle_id'],'maintenance_date':'2026-10-06','maintenance_item':'Oil','maintenance_cost':'800.00'}
    assert client.post('/api/maintenance',headers=h,json=maintenance).status_code==201
    assert client.post('/api/maintenance',headers=h,json={**maintenance,'vehicle_id':car['vehicle_id']}).status_code==201
    history=client.get(employee_path(r,'employee-context'),headers=h).json()
    assert any(m['vehicle_id']==r['vehicle']['vehicle_id'] and m['maintenance_date']=='2026-10-06' for m in history['maintenance'])
    assert any(f['vehicle_id']==r['vehicle']['vehicle_id'] and f['refueling_date']=='2026-10-06' for f in history['refueling'])

def test_fixed_vehicle_model(client,resources):
    r=resources
    assert client.post('/api/vehicles',headers=r['headers'],json={'license_plate':'WRONG-MODEL','vehicle_model':'Other car'}).status_code==422
    created=client.post('/api/vehicles',headers=r['headers'],json={'license_plate':'DEFAULT-'+uuid.uuid4().hex[:8]})
    assert created.status_code==201
    assert created.json()['vehicle_model']=='Rolls-Royce Cullinan 6.75 V12'

def test_cancel_and_historical_delete(client,resources):
    r=resources;path=f"/api/applications/{r['application']['application_id']}/cancel"
    assert client.post(path,headers=r['headers']).status_code==200
    assert approve(client,r).status_code==409
    assert client.delete(f"/api/applications/{r['application']['application_id']}",headers=r['headers']).status_code==405

def test_concurrent_reservations(client,resources,test_db):
    from concurrent.futures import ThreadPoolExecutor
    r=resources;approve(client,r)
    e=client.post('/api/employees',headers=r['headers'],json={'employee_name':'Concurrent','department_id':r['department']['department_id']}).json()
    a=client.post('/api/applications',headers=r['headers'],json={**r['app_body'],'employee_id':e['employee_id']}).json();approve(client,r,a['application_id'])
    payloads=[r['dispatch_body'],{**r['dispatch_body'],'application_id':a['application_id']}]
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(lambda b:client.post('/api/dispatches',headers=r['headers'],json=b).status_code,payloads))
    assert sorted(codes)==[201,409]

def test_update_and_query(client,resources):
    r=resources
    body={'employee_name':'Updated Employee','department_id':r['department']['department_id'],'phone_numbers':['02-0000-0000']}
    result=client.put(f"/api/employees/{r['employee']['employee_id']}",headers=r['headers'],json=body)
    assert result.status_code==200 and result.json()['employee_name']=='Updated Employee'
    found=client.get('/api/employees',headers=r['headers']).json()
    assert next(e for e in found if e['employee_id']==r['employee']['employee_id'])['phone_numbers']==['02-0000-0000']
    unused=client.post('/api/departments',headers=r['headers'],json={'department_name':'Delete '+uuid.uuid4().hex[:8]}).json()
    assert client.delete(f"/api/departments/{unused['department_id']}",headers=r['headers']).status_code==200

def test_statistics(client,resources):
    r=resources
    result=client.get('/api/statistics',headers=r['headers'])
    assert result.status_code==200
    data=result.json()
    assert len(data['months'])==6 and data['totals']['applications']>=1
    assert any(d['department_name']==r['department']['department_name'] for d in data['departments'])
    assert all(float(m['total'])==float(m['maintenance_cost'])+float(m['fuel_cost']) for m in data['months'])

def test_employee_session_security_logout_and_expiry(client,resources,test_db):
    r=resources;h=r['headers']
    assert client.get('/api/employee-context',headers={'Cookie':''}).status_code==401
    assert client.get('/api/employee-context?employee_id=999999999',headers=h).status_code==403
    assert client.post('/api/my-applications',headers={'Cookie':h['Cookie']},json=future_employee_body(r)).status_code==403
    assert client.post('/api/auth/login',json={'employee_code':r['employee']['employee_code'],'password':'wrong'}).status_code==401
    assert client.post('/api/auth/logout',headers=h).status_code==200
    assert client.get('/api/employee-context',headers=h).status_code==401
    login=client.post('/api/auth/login',json={'employee_code':r['employee']['employee_code'],'password':'test-password-2026'})
    assert login.status_code==200 and 'password' not in login.json()['employee']
    assert 'HttpOnly' in login.headers['set-cookie'] and 'SameSite=strict' in login.headers['set-cookie']
    with test_db() as c:
        c.execute("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE employee_id=%s",(r['employee']['employee_id'],))
    assert client.get('/api/auth/session').status_code==401

def test_employee_failed_login_rate_limit(client,resources):
    r=resources
    for _ in range(5):
        assert client.post('/api/auth/login',json={'employee_code':r['employee']['employee_code'],'password':'wrong'}).status_code==401
    assert client.post('/api/auth/login',json={'employee_code':r['employee']['employee_code'],'password':'test-password-2026'}).status_code==429

def test_employee_code_migration_preserves_existing_records(client,resources,test_db):
    r=resources
    assert r['employee']['employee_code'].startswith('EMP')
    assert client.post('/api/auth/login',json={'employee_id':r['employee']['employee_id'],'password':'test-password-2026'}).status_code==422
    assert client.post('/api/auth/login',json={'employee_code':str(r['employee']['employee_id']),'password':'test-password-2026'}).status_code==422
    with test_db() as c:
        schema=c.execute('SELECT current_schema() AS s').fetchone()['s']
        assert schema.startswith('fleetflow_test_')
        before=c.execute('SELECT employee_id,password FROM employees ORDER BY employee_id').fetchall()
        applications=c.execute('SELECT application_id,employee_id FROM applications ORDER BY application_id').fetchall()
        c.execute('ALTER TABLE employees DROP COLUMN employee_code')
        c.execute((ROOT/'backend/migrations/006_employee_codes.sql').read_text(encoding='utf-8').replace('fleetflow',schema))
        assert c.execute('SELECT employee_id,password FROM employees ORDER BY employee_id').fetchall()==before
        assert c.execute('SELECT application_id,employee_id FROM applications ORDER BY application_id').fetchall()==applications
        code=c.execute('INSERT INTO employees(employee_id,department_id,employee_name) VALUES(10000,%s,%s) RETURNING employee_code',(r['department']['department_id'],'Code test')).fetchone()['employee_code']
        assert code=='EMP10000'

def test_employee_shared_availability_and_preferred_car(client,resources):
    from urllib.parse import urlencode
    r=resources;h=r['headers'];body={**future_employee_body(r),'vehicle_id':r['vehicle']['vehicle_id']}
    first=client.post(employee_path(r),headers=h,json=body);assert first.status_code==201
    other=client.post('/api/employees',headers=h,json={'department_id':r['department']['department_id'],'employee_name':'Other','password':'other-test-password'}).json()
    login=client.post('/api/auth/login',json={'employee_code':other['employee_code'],'password':'other-test-password'})
    other_h={**h,'Cookie':login.headers['set-cookie'].split(';')[0],'X-CSRF-Token':login.json()['csrf_token']}
    query='/api/availability?'+urlencode({'start':body['requested_start_date'],'end':body['requested_end_date']})
    data=client.get(query,headers=other_h).json()
    assert next(v for v in data['vehicles'] if v['vehicle_id']==body['vehicle_id'])['available_in_period'] is False
    shared=client.get('/api/employee-context',headers=other_h).json()
    assert any(b['application_id']==first.json()['application_id'] for b in shared['team_bookings'])
    assert not shared['applications']
    assert client.post('/api/my-applications',headers=other_h,json={**body,'employee_id':other['employee_id']}).status_code==409
    assert client.get(query+'&exclude='+str(first.json()['application_id']),headers=other_h).status_code==403
    mine=client.get(query+'&exclude='+str(first.json()['application_id']),headers=h).json()
    assert next(v for v in mine['vehicles'] if v['vehicle_id']==body['vehicle_id'])['available_in_period'] is True
    end=datetime.fromisoformat(body['requested_end_date'])
    adjacent={**body,'employee_id':other['employee_id'],'requested_start_date':end.isoformat(),'requested_end_date':(end+timedelta(hours=1)).isoformat()}
    assert client.post('/api/my-applications',headers=other_h,json=adjacent).status_code==201

def test_employee_concurrent_preferred_car(client,resources):
    from concurrent.futures import ThreadPoolExecutor
    r=resources;h=r['headers'];other=client.post('/api/employees',headers=h,json={'department_id':r['department']['department_id'],'employee_name':'Race','password':'race-test-password'}).json()
    login=client.post('/api/auth/login',json={'employee_code':other['employee_code'],'password':'race-test-password'})
    other_h={**h,'Cookie':login.headers['set-cookie'].split(';')[0],'X-CSRF-Token':login.json()['csrf_token']}
    start=datetime.now(timezone.utc)+timedelta(days=60)
    body={**r['app_body'],'vehicle_id':r['vehicle']['vehicle_id'],'requested_start_date':start.isoformat(),'requested_end_date':(start+timedelta(hours=2)).isoformat()}
    def send(args):
        headers,employee=args
        return client.post('/api/my-applications',headers=headers,json={**body,'employee_id':employee}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(send,[(h,r['employee']['employee_id']),(other_h,other['employee_id'])]))==[201,409]
