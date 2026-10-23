-- Email: firm mailboxes, templates, threads and messages belong to their firm.
-- Hub rows (firm_id IS NULL) are visible only to callers with Hub intake scope.

-- ── Same-firm integrity ──
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE email_threads ADD CONSTRAINT email_threads_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE email_threads ADD CONSTRAINT email_threads_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE email_threads ADD CONSTRAINT email_threads_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE email_threads ADD CONSTRAINT email_threads_mailbox_same_firm_fk
  FOREIGN KEY (mailbox_id, firm_id) REFERENCES mailboxes (id, firm_id);--> statement-breakpoint
ALTER TABLE email_messages ADD CONSTRAINT email_messages_thread_same_firm_fk
  FOREIGN KEY (thread_id, firm_id) REFERENCES email_threads (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE email_threads ADD CONSTRAINT email_threads_hub_has_no_records
  CHECK (firm_id IS NOT NULL OR (lead_id IS NULL AND client_id IS NULL));--> statement-breakpoint
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_addresses_valid
  CHECK (inbound_address::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND from_address::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');--> statement-breakpoint

-- ── Row-level security ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates', 'email_threads', 'email_messages'] LOOP
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

-- Mailboxes are organisation configuration (addresses and sender names, no client data).
ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY mailboxes_org ON mailboxes FOR ALL TO gih_app
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint

-- Firms may use the Hub's shared templates (read only) as well as their own.
CREATE POLICY email_templates_hub_read ON email_templates FOR SELECT TO gih_app
  USING (firm_id IS NULL AND org_id::text = current_setting('app.org_id', true));--> statement-breakpoint

-- Sent and received messages are a record: the app can't rewrite their content.
REVOKE UPDATE, DELETE, TRUNCATE ON email_messages FROM gih_app;--> statement-breakpoint
GRANT UPDATE (status, error, provider_id) ON email_messages TO gih_app;--> statement-breakpoint

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.mailboxes, public.email_templates, public.email_threads, public.email_messages FROM %I', r);
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint

-- Delivery webhooks carry only Resend's message id. This updates the status of
-- that one outbound message and nothing else, without needing a firm scope.
CREATE OR REPLACE FUNCTION email_record_delivery(p_provider_id text, p_status text, p_error text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('delivered', 'bounced', 'complained', 'failed') THEN RETURN; END IF;
  UPDATE public.email_messages
     SET status = p_status::public.email_message_status, error = left(p_error, 300)
   WHERE provider_id = p_provider_id AND direction = 'outbound'
     AND status IN ('queued', 'sent', 'delivered');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION email_record_delivery(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION email_record_delivery(text, text, text) TO gih_app;
