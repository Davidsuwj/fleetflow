import os
from contextlib import contextmanager
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / '.env')

@contextmanager
def connection():
    with psycopg.connect(
        host=os.environ.get('DB_HOST', '140.117.68.35'),
        port=int(os.environ.get('DB_PORT', '5432')),
        dbname=os.environ.get('DB_NAME', 'project_17'),
        user=os.environ.get('DB_USER', 'project_17'),
        password=os.environ['DB_PASSWORD'],
        sslmode=os.environ.get('DB_SSLMODE', 'prefer'),
        connect_timeout=8, row_factory=dict_row,
    ) as conn:
        conn.execute('SET search_path TO fleetflow')
        conn.execute("SET TIME ZONE 'Asia/Taipei'")
        conn.execute("SET statement_timeout TO '12s'")
        yield conn

def migrate():
    with connection() as conn:
        conn.execute('SELECT pg_advisory_xact_lock(170017)')
        conn.execute((ROOT / 'backend/schema.sql').read_text(encoding='utf-8'))
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=2').fetchone():
            conn.execute((ROOT / 'backend/migrations/002_remove_accounts.sql').read_text(encoding='utf-8'))
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=3').fetchone():
            conn.execute((ROOT / 'backend/migrations/003_phone_identifier.sql').read_text(encoding='utf-8'))
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=4').fetchone():
            conn.execute((ROOT / 'backend/migrations/004_date_partial_keys.sql').read_text(encoding='utf-8'))
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=5').fetchone():
            conn.execute((ROOT / 'backend/migrations/005_employee_login.sql').read_text(encoding='utf-8'))
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=6').fetchone():
            conn.execute((ROOT / 'backend/migrations/006_employee_codes.sql').read_text(encoding='utf-8'))
