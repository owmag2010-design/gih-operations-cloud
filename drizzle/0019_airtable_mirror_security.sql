-- Airtable mirror: a practice's datasets follow firm isolation; Hub datasets
-- (firm_id null) need app.mirror = 'on', set only by the mirror service for
-- callers holding the Hub mirror permission or by the sync job.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['airtable_sources', 'airtable_records', 'airtable_sync_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app
         USING (org_id::text = current_setting(''app.org_id'', true) AND (firm_id = ANY (app_firm_ids()) OR (firm_id IS NULL AND current_setting(''app.mirror'', true) = ''on'')))
         WITH CHECK (org_id::text = current_setting(''app.org_id'', true) AND (firm_id = ANY (app_firm_ids()) OR (firm_id IS NULL AND current_setting(''app.mirror'', true) = ''on'')))',
      t || '_access', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Records and runs carry their source's organisation and practice.
ALTER TABLE airtable_sources ADD CONSTRAINT airtable_sources_id_scope_uq UNIQUE NULLS NOT DISTINCT (id, org_id, firm_id);--> statement-breakpoint
ALTER TABLE airtable_records ADD CONSTRAINT airtable_records_source_scope_fk
  FOREIGN KEY (source_id, org_id, firm_id) REFERENCES airtable_sources (id, org_id, firm_id) ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE airtable_sync_runs ADD CONSTRAINT airtable_sync_runs_source_scope_fk
  FOREIGN KEY (source_id, org_id, firm_id) REFERENCES airtable_sources (id, org_id, firm_id) ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE airtable_sources ADD CONSTRAINT airtable_sources_ids_valid
  CHECK (base_id ~ '^app[A-Za-z0-9]{14}$' AND table_id ~ '^tbl[A-Za-z0-9]{14}$');--> statement-breakpoint
-- Mirrored records are never hard-deleted by the application (retention policy).
REVOKE DELETE ON airtable_records FROM gih_app;
