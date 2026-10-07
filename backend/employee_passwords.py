"""Provision demo plaintext passwords into employees.password; never print credentials."""
import argparse
import getpass
import secrets
from pathlib import Path
from backend.db import connection,migrate,ROOT

def provision_missing(output):
    migrate();lines=['FleetFlow 員工登入資料（僅供本機使用）','']
    with connection() as c:
        people=c.execute('SELECT employee_id,employee_code,employee_name FROM employees WHERE password IS NULL ORDER BY employee_id FOR UPDATE').fetchall()
        for person in people:
            password=secrets.token_urlsafe(9)
            c.execute('UPDATE employees SET password=%s WHERE employee_id=%s',(password,person['employee_id']))
            lines.append(f"工號：{person['employee_code']}　姓名：{person['employee_name']}　密碼：{password}")
        if people:
            path=Path(output).resolve()
            path.parent.mkdir(parents=True,exist_ok=True)
            # Preserve the existing private credential file on future provisioning.
            with path.open('a',encoding='utf-8') as file:
                file.write('\n'.join(lines)+'\n')
    print(f'已建立 {len(people)} 位員工密碼；登入資料保存於本機檔案。')

def reset(employee):
    password=getpass.getpass('新密碼（8 至 128 字元）：')
    if not 8<=len(password)<=128:
        raise SystemExit('密碼需 8 至 128 字元')
    with connection() as c:
        row=c.execute('UPDATE employees SET password=%s WHERE employee_code=%s RETURNING employee_id',(password,employee)).fetchone()
        if not row:
            raise SystemExit('員工不存在')
        c.execute('DELETE FROM auth_sessions WHERE employee_id=%s',(row['employee_id'],))
    print('密碼已更新，既有登入已登出。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--provision-missing',action='store_true');group.add_argument('--reset',help='員工工號，例如 EMP0001')
    parser.add_argument('--output',default=str(ROOT/'.local/員工登入資料.txt'))
    args=parser.parse_args()
    provision_missing(args.output) if args.provision_missing else reset(args.reset)
