-- Caller owns the transaction and sets search_path. Lock both tables before
-- checking duplicates so writes cannot race with the key replacement.
LOCK TABLE maintenance_records, refueling_records IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM maintenance_records GROUP BY vehicle_id, maintenance_date HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM refueling_records GROUP BY vehicle_id, refueling_date HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Date-key migration blocked: duplicate vehicle/date records require explicit consolidation';
  END IF;
END $$;
ALTER TABLE maintenance_records DROP CONSTRAINT IF EXISTS maintenance_records_pkey;
ALTER TABLE maintenance_records DROP COLUMN IF EXISTS maintenance_seq;
ALTER TABLE maintenance_records ADD PRIMARY KEY (vehicle_id, maintenance_date);
ALTER TABLE refueling_records DROP CONSTRAINT IF EXISTS refueling_records_pkey;
ALTER TABLE refueling_records DROP COLUMN IF EXISTS refueling_id;
ALTER TABLE refueling_records ADD PRIMARY KEY (vehicle_id, refueling_date);
INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
