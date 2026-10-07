-- The final ERD excludes accounts and app login.
DROP TABLE IF EXISTS accounts;
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
