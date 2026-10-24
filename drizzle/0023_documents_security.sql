-- Documents: same-practice integrity, immutability of saved versions, final
-- documents and uploaded originals, and row-level security (including
-- restricted matters).
ALTER TABLE document_templates ADD CONSTRAINT document_templates_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_template_fk FOREIGN KEY (template_id, firm_id) REFERENCES document_templates (id, firm_id);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_client_same_firm_fk FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_template_same_firm_fk FOREIGN KEY (template_id, firm_id) REFERENCES document_templates (id, firm_id);--> statement-breakpoint
ALTER TABLE document_versions ADD CONSTRAINT document_versions_doc_same_firm_fk FOREIGN KEY (document_id, firm_id) REFERENCES documents (id, firm_id);--> statement-breakpoint
ALTER TABLE document_comments ADD CONSTRAINT document_comments_doc_same_firm_fk FOREIGN KEY (document_id, firm_id) REFERENCES documents (id, firm_id);--> statement-breakpoint
ALTER TABLE document_files ADD CONSTRAINT document_files_client_same_firm_fk FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE document_files ADD CONSTRAINT document_files_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE document_files ADD CONSTRAINT document_files_doc_same_firm_fk FOREIGN KEY (document_id, firm_id) REFERENCES documents (id, firm_id);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_final_has_version CHECK (status <> 'final' OR (final_version IS NOT NULL AND finalised_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE document_versions ADD CONSTRAINT document_versions_final_has_pdf CHECK (NOT is_final OR (pdf IS NOT NULL AND pdf_sha256 IS NOT NULL));--> statement-breakpoint
ALTER TABLE document_files ADD CONSTRAINT document_files_size_valid CHECK (size > 0 AND size = octet_length(data));--> statement-breakpoint

-- A final document is never overwritten: its content, title and final version are fixed.
CREATE OR REPLACE FUNCTION document_final_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'final' AND (
    NEW.status IS DISTINCT FROM OLD.status OR NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.final_version IS DISTINCT FROM OLD.final_version OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.matter_id IS DISTINCT FROM OLD.matter_id
  ) THEN
    RAISE EXCEPTION 'A final document cannot be changed; start a new document from it instead';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER documents_final_guard BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION document_final_guard();--> statement-breakpoint

-- Saved versions, template versions and uploaded originals are append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON document_versions, document_template_versions FROM gih_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON documents, document_templates, document_comments, document_files FROM gih_app;--> statement-breakpoint
REVOKE UPDATE ON document_files FROM gih_app;--> statement-breakpoint
GRANT UPDATE (ocr_status, ocr_text, ocr_engine, ocr_confidence, ocr_error, ocr_at, description, document_id) ON document_files TO gih_app;--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_templates', 'document_template_versions', 'documents', 'document_versions', 'document_comments', 'document_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()))',
      t || '_firm_isolation', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['documents', 'document_versions', 'document_comments', 'document_files'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO gih_app USING (matter_visible(matter_id)) WITH CHECK (matter_visible(matter_id))',
      t || '_matter_restricted', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.document_templates, public.document_template_versions, public.documents, public.document_versions, public.document_comments, public.document_files FROM %I', r);
    END IF;
  END LOOP;
END
$$;
