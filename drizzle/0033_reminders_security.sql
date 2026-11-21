-- Reminders: firm isolation, restricted matters, same-firm links, sensible limits, and a log
-- that can only move a claimed row to its outcome.

ALTER TABLE reminder_settings ADD CONSTRAINT reminder_settings_nudge_range CHECK (nudge_every_days BETWEEN 3 AND 30);--> statement-breakpoint
ALTER TABLE reminder_settings ADD CONSTRAINT reminder_settings_deadline_range CHECK (deadline_window_days BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE reminder_settings ADD CONSTRAINT reminder_settings_expiry_range CHECK (expiry_window_days BETWEEN 14 AND 365);--> statement-breakpoint
ALTER TABLE reminder_log ADD CONSTRAINT reminder_log_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE reminder_log ADD CONSTRAINT reminder_log_client_has_matter CHECK (kind <> 'client_documents' OR matter_id IS NOT NULL);--> statement-breakpoint

REVOKE DELETE, TRUNCATE ON reminder_log, reminder_settings FROM gih_app;--> statement-breakpoint

-- The log is history: only the status of a claimed row may change, and only once.
CREATE OR REPLACE FUNCTION reminder_log_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'claimed'
     OR NEW.firm_id IS DISTINCT FROM OLD.firm_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.matter_id IS DISTINCT FROM OLD.matter_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.items IS DISTINCT FROM OLD.items OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'reminder log rows are history' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER reminder_log_locked BEFORE UPDATE ON reminder_log FOR EACH ROW EXECUTE FUNCTION reminder_log_locked();--> statement-breakpoint

ALTER TABLE reminder_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY reminder_settings_firm_isolation ON reminder_settings FOR ALL TO gih_app
  USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()));--> statement-breakpoint
CREATE POLICY reminder_log_firm_isolation ON reminder_log FOR ALL TO gih_app
  USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()));--> statement-breakpoint
CREATE POLICY reminder_log_matter_restricted ON reminder_log AS RESTRICTIVE FOR ALL TO gih_app
  USING (matter_id IS NULL OR matter_visible(matter_id)) WITH CHECK (matter_id IS NULL OR matter_visible(matter_id));--> statement-breakpoint

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['reminder_settings', 'reminder_log'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
