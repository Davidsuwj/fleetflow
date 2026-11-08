-- Run inside one transaction (backend.db.migrate does so).
-- Only the losslessly reconstructible legacy alias is removed; no CASCADE.
SET search_path TO fleetflow;
LOCK TABLE employees IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=current_schema() AND table_name='employees' AND column_name='employee_code') THEN
    IF EXISTS (SELECT 1 FROM employees
               WHERE employee_code IS DISTINCT FROM
                 ('EMP' || lpad(employee_id::text, greatest(4,length(employee_id::text)), '0'))
                  OR employee_code !~ '^EMP[0-9]{4,19}$') THEN
      RAISE EXCEPTION 'Employee identity migration aborted: legacy codes are not safely reconstructible';
    END IF;
    ALTER TABLE employees DROP COLUMN employee_code;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES (7) ON CONFLICT DO NOTHING;
