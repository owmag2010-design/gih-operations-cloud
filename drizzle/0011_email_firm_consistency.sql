-- Security review L2: composite keys are not checked when firm_id is NULL (Hub
-- rows), so enforce that a message belongs to the same firm (or Hub) as its
-- thread, and a thread to the same firm (or Hub) as its mailbox. Runs as the
-- owner so row-level security cannot hide the parent row it compares against.
CREATE OR REPLACE FUNCTION email_check_firm_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE other uuid;
BEGIN
  IF TG_TABLE_NAME = 'email_messages' THEN
    SELECT t.firm_id INTO other FROM public.email_threads t WHERE t.id = NEW.thread_id;
    IF NEW.firm_id IS DISTINCT FROM other THEN RAISE EXCEPTION 'email message firm does not match its conversation'; END IF;
  ELSIF NEW.mailbox_id IS NOT NULL THEN
    SELECT m.firm_id INTO other FROM public.mailboxes m WHERE m.id = NEW.mailbox_id;
    IF NEW.firm_id IS DISTINCT FROM other THEN RAISE EXCEPTION 'conversation firm does not match its mailbox'; END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER email_messages_firm_consistency BEFORE INSERT OR UPDATE OF thread_id, firm_id ON email_messages
  FOR EACH ROW EXECUTE FUNCTION email_check_firm_consistency();--> statement-breakpoint
CREATE TRIGGER email_threads_firm_consistency BEFORE INSERT OR UPDATE OF mailbox_id, firm_id ON email_threads
  FOR EACH ROW EXECUTE FUNCTION email_check_firm_consistency();
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_check_firm_consistency() FROM PUBLIC;
