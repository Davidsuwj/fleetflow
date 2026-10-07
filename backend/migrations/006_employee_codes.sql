SET search_path TO fleetflow;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_code varchar(32)
  GENERATED ALWAYS AS ('EMP' || lpad(employee_id::text, greatest(4, length(employee_id::text)), '0')) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS ux_employees_code ON employees(employee_code);
INSERT INTO schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
