-- Email workspace: connected mailboxes, personal mailboxes, notes, drafts,
-- signatures and stored files.

-- ── Same-firm integrity ──
ALTER TABLE email_notes ADD CONSTRAINT email_notes_thread_same_firm_fk
  FOREIGN KEY (thread_id, firm_id) REFERENCES email_threads (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_thread_same_firm_fk
  FOREIGN KEY (thread_id, firm_id) REFERENCES email_threads (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_mailbox_same_firm_fk
  FOREIGN KEY (mailbox_id, firm_id) REFERENCES mailboxes (id, firm_id);--> statement-breakpoint
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_personal_has_owner
  CHECK (kind = 'shared' OR owner_user_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE email_signatures ADD CONSTRAINT email_signatures_one_per_scope
  UNIQUE NULLS NOT DISTINCT (org_id, firm_id, user_id);--> statement-breakpoint
ALTER TABLE stored_files ADD CONSTRAINT stored_files_size_cap CHECK (size >= 0 AND size <= 26214400);--> statement-breakpoint
CREATE UNIQUE INDEX email_threads_provider_uq ON email_threads (mailbox_id, provider_thread_id) WHERE provider_thread_id IS NOT NULL;--> statement-breakpoint

-- Notes and drafts must sit in the same firm (or Hub) as their conversation and mailbox.
CREATE OR REPLACE FUNCTION email_check_firm_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE other uuid;
BEGIN
  -- Branch by table first: PL/pgSQL can't refer to a column the row doesn't have.
  IF TG_TABLE_NAME IN ('email_messages', 'email_notes') THEN
    SELECT t.firm_id INTO other FROM public.email_threads t WHERE t.id = NEW.thread_id;
    IF NEW.firm_id IS DISTINCT FROM other THEN RAISE EXCEPTION 'email record firm does not match its conversation'; END IF;
  ELSIF TG_TABLE_NAME = 'email_drafts' THEN
    IF NEW.thread_id IS NOT NULL THEN
      SELECT t.firm_id INTO other FROM public.email_threads t WHERE t.id = NEW.thread_id;
      IF NEW.firm_id IS DISTINCT FROM other THEN RAISE EXCEPTION 'email record firm does not match its conversation'; END IF;
    END IF;
    IF NEW.mailbox_id IS NOT NULL THEN
      SELECT m.firm_id INTO other FROM public.mailboxes m WHERE m.id = NEW.mailbox_id;
      IF NEW.firm_id IS DISTINCT FROM other THEN RAISE EXCEPTION 'conversation firm does not match its mailbox'; END IF;
    END IF;
  ELSIF NEW.mailbox_id IS NOT NULL THEN
    SELECT m.firm_id INTO other FROM public.mailboxes m WHERE m.id = NEW.mailbox_id;
    IF NEW.firm_id IS DISTINCT FROM other THEN RAISE EXCEPTION 'conversation firm does not match its mailbox'; END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION email_check_firm_consistency() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER email_notes_firm_consistency BEFORE INSERT OR UPDATE OF thread_id, firm_id ON email_notes
  FOR EACH ROW EXECUTE FUNCTION email_check_firm_consistency();--> statement-breakpoint
CREATE TRIGGER email_drafts_firm_consistency BEFORE INSERT OR UPDATE OF thread_id, mailbox_id, firm_id ON email_drafts
  FOR EACH ROW EXECUTE FUNCTION email_check_firm_consistency();--> statement-breakpoint

-- ── Personal mailboxes ──
-- A personal mailbox's conversations are visible only to its owner and members.
-- Mail sync and the inbound webhook run with app.mail_system = 'on'.
CREATE OR REPLACE FUNCTION email_mailbox_visible(p_mailbox uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_mailbox IS NULL
      OR current_setting('app.mail_system', true) = 'on'
      OR EXISTS (
        SELECT 1 FROM public.mailboxes m
         WHERE m.id = p_mailbox
           AND (m.kind = 'shared'
                OR m.owner_user_id::text = current_setting('app.user_id', true)
                OR EXISTS (SELECT 1 FROM public.mailbox_members mm
                            WHERE mm.mailbox_id = m.id AND mm.user_id::text = current_setting('app.user_id', true))))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION email_thread_visible(p_thread uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.email_mailbox_visible((SELECT t.mailbox_id FROM public.email_threads t WHERE t.id = p_thread))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION email_mailbox_visible(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION email_thread_visible(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION email_mailbox_visible(uuid) TO gih_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION email_thread_visible(uuid) TO gih_app;--> statement-breakpoint

CREATE POLICY email_threads_mailbox_private ON email_threads AS RESTRICTIVE FOR ALL TO gih_app
  USING (email_mailbox_visible(mailbox_id)) WITH CHECK (email_mailbox_visible(mailbox_id));--> statement-breakpoint
CREATE POLICY email_messages_mailbox_private ON email_messages AS RESTRICTIVE FOR ALL TO gih_app
  USING (email_thread_visible(thread_id)) WITH CHECK (email_thread_visible(thread_id));--> statement-breakpoint

-- ── Row-level security for the new tables ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_notes', 'stored_files'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR ALL TO gih_app
      USING (
        org_id::text = current_setting('app.org_id', true) AND (
          (firm_id IS NOT NULL AND firm_id = ANY (public.app_firm_ids()))
          OR (firm_id IS NULL AND current_setting('app.intake', true) = 'on')
        )
      )
      WITH CHECK (
        org_id::text = current_setting('app.org_id', true) AND (
          (firm_id IS NOT NULL AND firm_id = ANY (public.app_firm_ids()))
          OR (firm_id IS NULL AND current_setting('app.intake', true) = 'on')
        )
      )$p$, t || '_scope', t);
  END LOOP;
END
$$;--> statement-breakpoint
CREATE POLICY email_notes_mailbox_private ON email_notes AS RESTRICTIVE FOR ALL TO gih_app
  USING (email_thread_visible(thread_id)) WITH CHECK (email_thread_visible(thread_id));--> statement-breakpoint

-- Drafts: the author only, inside a firm (or Hub) they can reach.
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY email_drafts_owner ON email_drafts FOR ALL TO gih_app
  USING (
    org_id::text = current_setting('app.org_id', true)
    AND user_id::text = current_setting('app.user_id', true)
    AND ((firm_id IS NOT NULL AND firm_id = ANY (public.app_firm_ids())) OR (firm_id IS NULL AND current_setting('app.intake', true) = 'on'))
  )
  WITH CHECK (
    org_id::text = current_setting('app.org_id', true)
    AND user_id::text = current_setting('app.user_id', true)
    AND ((firm_id IS NOT NULL AND firm_id = ANY (public.app_firm_ids())) OR (firm_id IS NULL AND current_setting('app.intake', true) = 'on'))
  );--> statement-breakpoint

-- Organisation configuration.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mail_connections', 'mailbox_members', 'email_signatures'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR ALL TO gih_app
      USING (org_id::text = current_setting('app.org_id', true))
      WITH CHECK (org_id::text = current_setting('app.org_id', true))$p$, t || '_org', t);
  END LOOP;
END
$$;--> statement-breakpoint

-- Stored files are immutable; messages keep their content.
REVOKE UPDATE, TRUNCATE ON stored_files FROM gih_app;--> statement-breakpoint
GRANT UPDATE (status, error, provider_id, message_id, accepted_at, via) ON email_messages TO gih_app;--> statement-breakpoint

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.mail_connections, public.mailbox_members, public.email_notes, public.email_drafts, public.email_signatures, public.stored_files FROM %I', r);
    END IF;
  END LOOP;
END
$$;
