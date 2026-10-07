"""Employee-facing Python reference API; online deployment uses the matching JS Worker."""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Query
from psycopg import sql
from backend.schemas import EmployeeApplication, AvailabilityPeriod


def build_router(connection_factory, application_query, dispatch_query, require_employee):
    router = APIRouter(prefix='/api', tags=['員工用車'])

    def find(c, table, key, value, lock=False):
        query = sql.SQL('SELECT * FROM {} WHERE {}=%s' + (' FOR UPDATE' if lock else '')).format(sql.Identifier(table), sql.Identifier(key))
        row = c.execute(query, (value,)).fetchone()
        if not row:
            raise HTTPException(404, '找不到指定資料。')
        return row

    def own_application(c, employee, record):
        find(c, 'employees', 'employee_id', employee, True)
        row = find(c, 'applications', 'application_id', record, True)
        if row['employee_id'] != employee:
            raise HTTPException(403, '只能操作目前員工自己的申請。')
        trip = c.execute('SELECT * FROM dispatches WHERE application_id=%s FOR UPDATE', (record,)).fetchone()
        if trip and (trip['returned_at'] or trip['actual_start_date'] <= datetime.now(timezone.utc)):
            raise HTTPException(409, '行程已開始或已歸還，無法修改、取消或刪單。')
        return row, trip

    def select_vehicle(c, employee, start, end, except_id=0, preferred=None):
        if start <= datetime.now(timezone.utc):
            raise HTTPException(409, '預計起日須晚於目前時間，請選擇未來的用車時段。')
        conflict = '''SELECT 1 FROM dispatches ds JOIN applications a USING(application_id)
            WHERE {condition} AND ds.application_id<>%s AND ds.actual_start_date<%s
            AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>%s'''
        if c.execute(conflict.format(condition='a.employee_id=%s'), (employee, except_id, end, start)).fetchone():
            raise HTTPException(409, '你在此時段已有行程，請選擇其他時間。')
        candidates = c.execute("SELECT vehicle_id FROM vehicles WHERE vehicle_status='available' AND (%s::bigint IS NULL OR vehicle_id=%s) ORDER BY vehicle_id",(preferred,preferred)).fetchall()
        for candidate in candidates:
            vehicle = find(c, 'vehicles', 'vehicle_id', candidate['vehicle_id'], True)
            if vehicle['vehicle_status'] != 'available':
                continue
            if not c.execute(conflict.format(condition='ds.vehicle_id=%s'), (vehicle['vehicle_id'], except_id, end, start)).fetchone():
                return vehicle
        raise HTTPException(409, '這台車在所選時段無法借用，請換車或調整時間。' if preferred else '所選時段沒有可用車輛，請調整用車時間後再送出。')

    def save(c, employee, body, record=None):
        if body.employee_id != employee:
            raise HTTPException(403, '申請員工與目前員工不一致。')
        old_trip = None
        if record:
            old, old_trip = own_application(c, employee, record)
            if old['approval_status'] not in ('pending', 'approved'):
                raise HTTPException(409, '已取消或已駁回的申請無法修改，請重新申請。')
        else:
            find(c, 'employees', 'employee_id', employee, True)
        vehicle = select_vehicle(c, employee, body.requested_start_date, body.requested_end_date, record or 0,body.vehicle_id)
        values = (body.purpose, body.requested_start_date, body.requested_end_date)
        if record:
            row = c.execute("UPDATE applications SET purpose=%s,requested_start_date=%s,requested_end_date=%s,approval_status='approved' WHERE application_id=%s RETURNING *", (*values, record)).fetchone()
        else:
            row = c.execute("INSERT INTO applications(employee_id,purpose,requested_start_date,requested_end_date,approval_status) VALUES(%s,%s,%s,%s,'approved') RETURNING *", (employee, *values)).fetchone()
        if old_trip:
            trip = c.execute('UPDATE dispatches SET vehicle_id=%s,actual_start_date=%s,actual_end_date=%s WHERE dispatch_id=%s RETURNING *', (vehicle['vehicle_id'], body.requested_start_date, body.requested_end_date, old_trip['dispatch_id'])).fetchone()
        else:
            trip = c.execute('INSERT INTO dispatches(application_id,vehicle_id,actual_start_date,actual_end_date) VALUES(%s,%s,%s,%s) RETURNING *', (row['application_id'], vehicle['vehicle_id'], body.requested_start_date, body.requested_end_date)).fetchone()
        return {**row, 'dispatch_id': trip['dispatch_id'], 'license_plate': vehicle['license_plate'], 'auto_approved': True}

    @router.get('/employee-context')
    def context(employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            person = c.execute('''SELECT e.employee_id,e.employee_code,e.employee_name,e.department_id,d.department_name,COALESCE((SELECT array_agg(p.phone_number ORDER BY p.phone_number) FROM employee_phones p WHERE p.employee_id=e.employee_id),ARRAY[]::varchar[]) AS phone_numbers
                FROM employees e JOIN departments d USING(department_id) WHERE e.employee_id=%s''', (employee_id,)).fetchone()
            if not person:
                raise HTTPException(404, '找不到指定員工。')
            apps = c.execute(application_query+' WHERE a.employee_id=%s ORDER BY a.created_at DESC', (employee_id,)).fetchall()
            trips = c.execute(dispatch_query+' WHERE a.employee_id=%s ORDER BY ds.actual_start_date DESC', (employee_id,)).fetchall()
            cars = c.execute("""SELECT v.*,EXISTS(SELECT 1 FROM dispatches ds WHERE ds.vehicle_id=v.vehicle_id AND ds.returned_at IS NULL AND now()>=ds.actual_start_date AND now()<ds.actual_end_date) AS in_use FROM vehicles v WHERE vehicle_status<>'retired' ORDER BY vehicle_id""").fetchall()
            maintenance = c.execute('SELECT m.*,v.license_plate FROM maintenance_records m JOIN vehicles v USING(vehicle_id) ORDER BY maintenance_date DESC,m.vehicle_id').fetchall()
            refueling = c.execute('SELECT r.*,v.license_plate FROM refueling_records r JOIN vehicles v USING(vehicle_id) ORDER BY refueling_date DESC,r.vehicle_id').fetchall()
            bookings = c.execute("""SELECT ds.dispatch_id,ds.application_id,ds.vehicle_id,v.license_plate,e.employee_name,a.purpose,ds.actual_start_date,ds.actual_end_date,ds.returned_at
                FROM dispatches ds JOIN applications a USING(application_id) JOIN employees e USING(employee_id) JOIN vehicles v USING(vehicle_id)
                WHERE ds.returned_at IS NULL AND ds.actual_end_date>now() ORDER BY ds.actual_start_date,ds.vehicle_id""").fetchall()
            months = c.execute('''WITH months AS (SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',date_trunc('month',CURRENT_DATE),interval '1 month')::date AS month)
                SELECT to_char(m.month,'YYYY-MM') AS month,
                (SELECT count(*) FROM applications a WHERE a.employee_id=%s AND date_trunc('month',a.requested_start_date AT TIME ZONE 'Asia/Taipei')::date=m.month) AS applications,
                (SELECT count(*) FROM dispatches ds JOIN applications a USING(application_id) WHERE a.employee_id=%s AND date_trunc('month',ds.actual_start_date AT TIME ZONE 'Asia/Taipei')::date=m.month) AS dispatches FROM months m ORDER BY m.month''', (employee_id, employee_id)).fetchall()
        totals = {'applications': len(apps), 'dispatches': len(trips), 'returned': sum(bool(t['returned_at']) for t in trips),
                  'scheduled_hours': round(sum((t['actual_end_date']-t['actual_start_date']).total_seconds()/3600 for t in trips), 1)}
        statuses = [{'approval_status': status, 'count': sum(a['approval_status']==status for a in apps)} for status in ('pending', 'approved', 'rejected', 'cancelled')]
        return {'employee': person, 'applications': apps, 'dispatches': trips, 'vehicles': cars, 'team_bookings': bookings, 'maintenance': maintenance, 'refueling': refueling, 'statistics': {'totals': totals, 'approval_status': statuses, 'months': months}}

    @router.get('/my-applications')
    def my_applications(employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            find(c, 'employees', 'employee_id', employee_id)
            return c.execute(application_query+' WHERE a.employee_id=%s ORDER BY a.created_at DESC', (employee_id,)).fetchall()

    @router.post('/my-applications', status_code=201)
    def create(body: EmployeeApplication, employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            return save(c, employee_id, body)

    @router.put('/my-applications/{record_id}')
    def edit(record_id: int, body: EmployeeApplication, employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            return save(c, employee_id, body, record_id)

    @router.delete('/my-applications/{record_id}')
    def delete(record_id: int, employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            _, trip = own_application(c, employee_id, record_id)
            if trip:
                c.execute('DELETE FROM dispatches WHERE dispatch_id=%s', (trip['dispatch_id'],))
            c.execute('DELETE FROM applications WHERE application_id=%s', (record_id,))
            return {'deleted': True, 'application_id': record_id}

    @router.post('/my-applications/{record_id}/cancel')
    def cancel(record_id: int, employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            row, trip = own_application(c, employee_id, record_id)
            if row['approval_status'] not in ('pending', 'approved'):
                raise HTTPException(409, '此申請已取消或已結案。')
            if trip:
                c.execute('DELETE FROM dispatches WHERE dispatch_id=%s', (trip['dispatch_id'],))
            return c.execute("UPDATE applications SET approval_status='cancelled' WHERE application_id=%s RETURNING *", (record_id,)).fetchone()

    @router.get('/my-dispatches')
    def my_dispatches(employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            find(c, 'employees', 'employee_id', employee_id)
            return c.execute(dispatch_query+' WHERE a.employee_id=%s ORDER BY ds.actual_start_date DESC', (employee_id,)).fetchall()

    @router.post('/my-dispatches/{record_id}/return')
    def return_vehicle(record_id: int, employee_id: int = Depends(require_employee)):
        with connection_factory() as c:
            find(c, 'employees', 'employee_id', employee_id, True)
            owner = c.execute('SELECT employee_id FROM applications a JOIN dispatches ds USING(application_id) WHERE ds.dispatch_id=%s', (record_id,)).fetchone()
            if not owner:
                raise HTTPException(404, '找不到指定行程。')
            if owner['employee_id'] != employee_id:
                raise HTTPException(403, '只能歸還目前員工自己的車輛。')
            trip = find(c, 'dispatches', 'dispatch_id', record_id, True)
            if trip['returned_at']:
                raise HTTPException(409, '此行程已完成歸還。')
            if trip['actual_start_date'] > datetime.now(timezone.utc):
                raise HTTPException(409, '行程尚未開始，不能登記歸還。')
            return c.execute('UPDATE dispatches SET returned_at=now() WHERE dispatch_id=%s RETURNING *', (record_id,)).fetchone()

    @router.get('/availability')
    def availability(start: str, end: str,exclude: int = Query(default=0,ge=0),employee_id: int = Depends(require_employee)):
        try:
            period=AvailabilityPeriod(requested_start_date=start,requested_end_date=end)
        except ValueError:
            raise HTTPException(422,'起迄時間格式錯誤。')
        with connection_factory() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            if exclude:
                own=find(c,'applications','application_id',exclude)
                if own['employee_id']!=employee_id:
                    raise HTTPException(403,'無法排除其他員工的預約。')
            values=(exclude,period.requested_end_date,period.requested_start_date)
            cars=c.execute("""SELECT v.vehicle_id,v.license_plate,v.vehicle_model,v.vehicle_status,
                (v.vehicle_status='available' AND NOT EXISTS(SELECT 1 FROM dispatches ds WHERE ds.vehicle_id=v.vehicle_id
                AND ds.application_id<>%s AND ds.actual_start_date<%s AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>%s)) AS available_in_period
                FROM vehicles v WHERE vehicle_status<>'retired' ORDER BY vehicle_id""",values).fetchall()
            bookings=c.execute("""SELECT ds.dispatch_id,ds.vehicle_id,v.license_plate,e.employee_name,a.purpose,ds.actual_start_date,ds.actual_end_date
                FROM dispatches ds JOIN applications a USING(application_id) JOIN employees e USING(employee_id) JOIN vehicles v USING(vehicle_id)
                WHERE ds.application_id<>%s AND ds.actual_start_date<%s AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>%s ORDER BY ds.actual_start_date,ds.vehicle_id""",values).fetchall()
        return {'vehicles':cars,'bookings':bookings}

    return router
