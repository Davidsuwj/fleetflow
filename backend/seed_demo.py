"""Optional, idempotent demonstration data. Never overwrites existing records."""
from datetime import datetime,timedelta,timezone
from backend.bootstrap import bootstrap
from backend.db import connection

def seed():
    bootstrap()
    with connection() as c:
        if c.execute('SELECT 1 FROM employees LIMIT 1').fetchone():
            print('已有員工資料，略過示範資料。');return
        people=[]
        for department,name in [('行政部','林書宇（示範）'),('業務部','陳怡安（示範）'),('資訊部','王柏翰（示範）')]:
            d=c.execute('INSERT INTO departments(department_name) VALUES (%s) ON CONFLICT(department_name) DO UPDATE SET department_name=EXCLUDED.department_name RETURNING department_id',(department,)).fetchone()['department_id']
            people.append(c.execute('INSERT INTO employees(department_id,employee_name) VALUES (%s,%s) RETURNING employee_id',(d,name)).fetchone()['employee_id'])
        cars=[]
        for plate,model,status in [('DEMO-101','Rolls-Royce Cullinan 6.75 V12','available'),('DEMO-102','Rolls-Royce Cullinan 6.75 V12','available'),('DEMO-103','Rolls-Royce Cullinan 6.75 V12','available'),('DEMO-104','Rolls-Royce Cullinan 6.75 V12','maintenance')]:
            cars.append(c.execute('INSERT INTO vehicles(license_plate,vehicle_model,vehicle_status) VALUES (%s,%s,%s) RETURNING vehicle_id',(plate,model,status)).fetchone()['vehicle_id'])
        tomorrow=(datetime.now(timezone.utc)+timedelta(days=1)).replace(hour=1,minute=0,second=0,microsecond=0)
        for i,purpose in enumerate(['示範：客戶拜訪','示範：設備運送','示範：分公司會議']):
            start=tomorrow+timedelta(days=i);end=start+timedelta(hours=5)
            application=c.execute("INSERT INTO applications(employee_id,purpose,requested_start_date,requested_end_date,approval_status) VALUES (%s,%s,%s,%s,'approved') RETURNING application_id",(people[i],purpose,start,end)).fetchone()['application_id']
            c.execute('INSERT INTO dispatches(application_id,vehicle_id,actual_start_date,actual_end_date) VALUES (%s,%s,%s,%s)',(application,cars[i],start,end))
    print('已新增標示為示範的部門、員工、車輛、核准申請與預約行程。')

if __name__=='__main__':seed()
