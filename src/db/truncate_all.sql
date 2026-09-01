-- =====================================================================
-- truncate_all.sql
--
-- Empties ALL data tables in the current database (public schema) while
-- keeping the schema itself intact (tables, columns, indexes, triggers).
--
-- - Uses TRUNCATE ... RESTART IDENTITY CASCADE so identity/serial counters
--   reset and foreign-key references are cleared automatically.
-- - Discovers tables dynamically, so it keeps working as new migrations
--   add tables.
-- - Preserves `schema_migrations` so the app does NOT try to re-run every
--   migration afterwards.
--
-- WARNING: THIS DELETES EVERY ROW IN EVERY TABLE. There is no undo.
-- Intended for local/development/staging databases only.
--
-- Run with:
--   psql "$DATABASE_URL" -f src/db/truncate_all.sql
-- =====================================================================

DO $$
DECLARE
  table_list text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO table_list
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> 'schema_migrations';

  IF table_list IS NULL THEN
    RAISE NOTICE 'No tables found to truncate.';
  ELSE
    EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY CASCADE';
    RAISE NOTICE 'Truncated: %', table_list;
  END IF;
END $$;
