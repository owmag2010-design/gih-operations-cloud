-- ─────────────────────────────────────────────────────────────────────────────
-- Security layer: application role, grants, cross-firm integrity, row-level
-- security and aggregate-only metric functions.
--
-- The application connects as `gih_app`. It does not own the tables, so every
-- row-level security policy below applies to it. Migrations run as the owner.
-- Per-transaction settings used by the policies (set by withScope()):
--   app.org_id      organisation of the signed-in user
--   app.user_id     signed-in user
--   app.firm_ids    comma-separated firm UUIDs the user may read in this call
--   app.intake      'on' when the caller holds intake permissions
--   app.audit_scope 'org' | 'firm' | '' for audit log reads
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gih_app') THEN
    CREATE ROLE gih_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO gih_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gih_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gih_app;--> statement-breakpoint

-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM gih_app;--> statement-breakpoint
-- Drizzle's migration bookkeeping is not the application's business.
REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM gih_app;--> statement-breakpoint

-- Tables created by later migrations get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gih_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gih_app;--> statement-breakpoint

-- Helper: firm ids allowed in this transaction (empty array when unset = deny).
CREATE OR REPLACE FUNCTION app_firm_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.firm_ids', true), '') = '' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.firm_ids', true), ',')::uuid[]
  END
$$;--> statement-breakpoint

-- ── Cross-firm integrity: child rows must belong to the same firm as parents ──
ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_stage_same_firm_fk
  FOREIGN KEY (stage_id, firm_id) REFERENCES pipeline_stages (id, firm_id);--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_duplicate_same_firm_fk
  FOREIGN KEY (duplicate_of_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_converted_client_same_firm_fk
  FOREIGN KEY (converted_client_id, firm_id) REFERENCES clients (id, firm_id) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_source_lead_same_firm_fk
  FOREIGN KEY (source_lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE activities ADD CONSTRAINT activities_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE activities ADD CONSTRAINT activities_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE consent_records ADD CONSTRAINT consent_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE consent_records ADD CONSTRAINT consent_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE activities ADD CONSTRAINT activities_has_subject
  CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE consent_records ADD CONSTRAINT consent_has_subject
  CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE services ADD CONSTRAINT services_amounts_valid
  CHECK (total_minor >= 0 AND deposit_minor >= 0 AND deposit_minor <= total_minor);--> statement-breakpoint

-- ── Row-level security on firm-owned tables ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leads', 'clients', 'activities', 'consent_records', 'saved_views',
    'pipeline_stages', 'firm_sequences', 'services'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()))',
      t || '_firm_isolation', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Saved views: private to their owner unless shared.
CREATE POLICY saved_views_owner ON saved_views AS RESTRICTIVE FOR ALL TO gih_app
  USING (is_shared OR user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint

-- Hub intake: only callers holding intake permissions, within their organisation.
ALTER TABLE intake_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY intake_items_access ON intake_items FOR ALL TO gih_app
  USING (current_setting('app.intake', true) = 'on' AND org_id::text = current_setting('app.org_id', true))
  WITH CHECK (current_setting('app.intake', true) = 'on' AND org_id::text = current_setting('app.org_id', true));--> statement-breakpoint

-- Audit log: anyone may append; reading needs an audit scope set by the audit service.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_insert ON audit_events FOR INSERT TO gih_app WITH CHECK (true);--> statement-breakpoint
CREATE POLICY audit_read ON audit_events FOR SELECT TO gih_app USING (
  org_id::text = current_setting('app.org_id', true) AND (
    current_setting('app.audit_scope', true) = 'org'
    OR (current_setting('app.audit_scope', true) = 'firm' AND firm_id = ANY (app_firm_ids()))
  )
);--> statement-breakpoint

-- ── Aggregate metrics without row access ──
-- Returns counts only, and only for firms that share aggregate metrics with the
-- group or that the caller is a member of (app.firm_ids). Runs as the owner so
-- the application role never reads other firms' rows directly.
CREATE OR REPLACE FUNCTION metrics_firm_summary(p_firm_ids uuid[], p_since timestamptz)
RETURNS TABLE (
  firm_id uuid,
  new_leads bigint,
  open_leads bigint,
  unassigned_open_leads bigint,
  overdue_follow_ups bigint,
  won_leads bigint,
  active_clients bigint,
  new_clients bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH allowed AS (
    SELECT f.id FROM firms f
    WHERE f.id = ANY (p_firm_ids)
      AND f.org_id::text = current_setting('app.org_id', true)
      AND (f.share_aggregate_metrics OR f.id = ANY (app_firm_ids()))
  )
  SELECT
    a.id,
    (SELECT count(*) FROM leads l WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND l.created_at >= p_since),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open'),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open' AND l.assigned_to_id IS NULL),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open' AND l.follow_up_at < now()),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'won' AND l.updated_at >= p_since),
    (SELECT count(*) FROM clients c WHERE c.firm_id = a.id AND c.deleted_at IS NULL AND c.status = 'active'),
    (SELECT count(*) FROM clients c WHERE c.firm_id = a.id AND c.deleted_at IS NULL AND c.created_at >= p_since)
  FROM allowed a
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION metrics_leads_by_source(p_firm_ids uuid[], p_since timestamptz)
RETURNS TABLE (firm_id uuid, source lead_source, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.firm_id, l.source, count(*)
  FROM leads l JOIN firms f ON f.id = l.firm_id
  WHERE l.firm_id = ANY (p_firm_ids)
    AND f.org_id::text = current_setting('app.org_id', true)
    AND (f.share_aggregate_metrics OR f.id = ANY (app_firm_ids()))
    AND l.deleted_at IS NULL AND l.created_at >= p_since
  GROUP BY l.firm_id, l.source
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION metrics_firm_summary(uuid[], timestamptz) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION metrics_leads_by_source(uuid[], timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION metrics_firm_summary(uuid[], timestamptz) TO gih_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION metrics_leads_by_source(uuid[], timestamptz) TO gih_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_ids() TO gih_app;
