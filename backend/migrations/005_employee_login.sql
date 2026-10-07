ALTER TABLE employees ADD COLUMN IF NOT EXISTS password varchar(128);
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_hash varchar(64) PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees ON DELETE CASCADE,
  csrf_token varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sessions_employee ON auth_sessions(employee_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_login_limits (
  bucket varchar(80) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  window_start timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
