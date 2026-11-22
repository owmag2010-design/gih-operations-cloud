-- Document checklists and requests: firm isolation, restricted matters,
-- same-firm links, immutable published templates and append-only history.

ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE checklist_template_items ADD CONSTRAINT checklist_template_items_template_same_firm_fk
  FOREIGN KEY (template_id, firm_id) REFERENCES checklist_templates (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE checklist_template_items ADD CONSTRAINT checklist_template_items_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_service_same_firm_fk
  FOREIGN KEY (service_id, firm_id) REFERENCES services (id, firm_id);--> statement-breakpoint
ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_country_valid CHECK (country_code ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_published_has_publisher CHECK (status = 'draft' OR published_at IS NOT NULL);--> statement-breakpoint

ALTER TABLE matter_checklists ADD CONSTRAINT matter_checklists_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE matter_checklists ADD CONSTRAINT matter_checklists_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE matter_checklists ADD CONSTRAINT matter_checklists_template_same_firm_fk
  FOREIGN KEY (template_id, firm_id) REFERENCES checklist_templates (id, firm_id);--> statement-breakpoint

ALTER TABLE document_files ADD CONSTRAINT document_files_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE document_requests ADD CONSTRAINT document_requests_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE document_requests ADD CONSTRAINT document_requests_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE document_requests ADD CONSTRAINT document_requests_checklist_same_firm_fk
  FOREIGN KEY (checklist_id, firm_id) REFERENCES matter_checklists (id, firm_id);--> statement-breakpoint
ALTER TABLE document_requests ADD CONSTRAINT document_requests_item_same_firm_fk
  FOREIGN KEY (template_item_id, firm_id) REFERENCES checklist_template_items (id, firm_id);--> statement-breakpoint
ALTER TABLE document_requests ADD CONSTRAINT document_requests_person_same_firm_fk
  FOREIGN KEY (person_id, firm_id) REFERENCES matter_people (id, firm_id) ON DELETE SET NULL (person_id);--> statement-breakpoint
ALTER TABLE document_requests ADD CONSTRAINT document_requests_file_same_firm_fk
  FOREIGN KEY (file_id, firm_id) REFERENCES document_files (id, firm_id);--> statement-breakpoint
-- The status needs its evidence: accepted needs a file and a reviewer; rejected and waived need a note.
ALTER TABLE document_requests ADD CONSTRAINT document_requests_status_evidence CHECK (
  (status <> 'accepted' OR (file_id IS NOT NULL AND reviewer_id IS NOT NULL))
  AND (status NOT IN ('rejected', 'waived') OR (note IS NOT NULL AND length(trim(note)) > 0))
  AND (status NOT IN ('received', 'under_review') OR file_id IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE document_request_events ADD CONSTRAINT document_request_events_request_same_firm_fk
  FOREIGN KEY (request_id, firm_id) REFERENCES document_requests (id, firm_id);--> statement-breakpoint
ALTER TABLE document_request_events ADD CONSTRAINT document_request_events_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint

-- History is append-only; requests are never deleted (waive instead).
REVOKE UPDATE, DELETE, TRUNCATE ON document_request_events FROM gih_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON document_requests, matter_checklists FROM gih_app;--> statement-breakpoint

-- A published (or retired) template and its items can't change; start a new version instead.
CREATE OR REPLACE FUNCTION checklist_template_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'checklist_templates' THEN
    IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published checklist versions cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
         NEW.name IS DISTINCT FROM OLD.name OR NEW.country_code IS DISTINCT FROM OLD.country_code
      OR NEW.service_id IS DISTINCT FROM OLD.service_id OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.family_id IS DISTINCT FROM OLD.family_id OR NEW.source_id IS DISTINCT FROM OLD.source_id
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR (OLD.status = 'retired' AND NEW.status <> 'retired')) THEN
      RAISE EXCEPTION 'published checklist version % is locked', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF EXISTS (SELECT 1 FROM checklist_templates t WHERE t.id = COALESCE(NEW.template_id, OLD.template_id) AND t.status <> 'draft') THEN
    RAISE EXCEPTION 'items of a published checklist version are locked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint
CREATE TRIGGER checklist_templates_locked BEFORE UPDATE OR DELETE ON checklist_templates FOR EACH ROW EXECUTE FUNCTION checklist_template_locked();--> statement-breakpoint
CREATE TRIGGER checklist_template_items_locked BEFORE INSERT OR UPDATE OR DELETE ON checklist_template_items FOR EACH ROW EXECUTE FUNCTION checklist_template_locked();--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklist_templates', 'checklist_template_items', 'matter_checklists', 'document_requests', 'document_request_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()))',
      t || '_firm_isolation', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['matter_checklists', 'document_requests', 'document_request_events'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO gih_app USING (matter_visible(matter_id)) WITH CHECK (matter_visible(matter_id))',
      t || '_matter_restricted', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['checklist_templates', 'checklist_template_items', 'matter_checklists', 'document_requests', 'document_request_events'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
