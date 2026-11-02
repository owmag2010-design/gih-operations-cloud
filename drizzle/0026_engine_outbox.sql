-- Replying from Conversations. Staff replies are written to ops_engine.outbox; a trigger
-- hands each new row to the engine (Edge Function engine-relay, through pg_net), which sends
-- it on WhatsApp, email or website chat with the same code as the engine dashboard and writes
-- the result back to the row. A one-minute sweep retries anything the trigger could not hand
-- over. The engine setting `ops_cloud_send` decides what may be sent from here:
-- 'off' (nothing), 'tests' (test contacts only) or 'on' (everyone).
--
-- gih_app may insert a reply only for a conversation its scope can see (the ops_engine.leads
-- view) and only as itself, and may read back only replies on conversations it can see.
-- Idempotent: applied by hand before the release workflow runs it again.

CREATE TABLE IF NOT EXISTS ops_engine.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email', 'webchat')),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  subject text CHECK (subject IS NULL OR length(subject) <= 160),
  reopen boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'blocked')),
  detail text,
  attempts int NOT NULL DEFAULT 0,
  processed_at timestamptz,
  CHECK (reopen OR length(btrim(body)) > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_lead_idx ON ops_engine.outbox (lead_id, created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_queued_idx ON ops_engine.outbox (created_at) WHERE status IN ('queued', 'sending');--> statement-breakpoint

ALTER TABLE ops_engine.outbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS outbox_read ON ops_engine.outbox;--> statement-breakpoint
CREATE POLICY outbox_read ON ops_engine.outbox FOR SELECT TO gih_app
  USING (org_id::text = current_setting('app.org_id', true) AND lead_id IN (SELECT id FROM ops_engine.leads));--> statement-breakpoint
DROP POLICY IF EXISTS outbox_write ON ops_engine.outbox;--> statement-breakpoint
CREATE POLICY outbox_write ON ops_engine.outbox FOR INSERT TO gih_app
  WITH CHECK (
    org_id::text = current_setting('app.org_id', true)
    AND user_id::text = current_setting('app.user_id', true)
    AND status = 'queued' AND attempts = 0 AND processed_at IS NULL AND detail IS NULL
    AND lead_id IN (SELECT id FROM ops_engine.leads)
  );--> statement-breakpoint
REVOKE ALL ON ops_engine.outbox FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT ON ops_engine.outbox TO gih_app;--> statement-breakpoint

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ops_engine.outbox FROM anon, authenticated';
  END IF;
  IF to_regclass('engine.config') IS NULL THEN
    RAISE NOTICE 'engine schema not present: send switch view skipped';
    RETURN;
  END IF;
  -- The engine's send switch, readable by the app (only this one setting).
  EXECUTE $v$
    CREATE OR REPLACE VIEW ops_engine.send_switch AS
    SELECT COALESCE((SELECT value FROM engine.config WHERE key = 'ops_cloud_send'), 'off') AS mode
  $v$;
  EXECUTE 'REVOKE ALL ON ops_engine.send_switch FROM PUBLIC';
  EXECUTE 'GRANT SELECT ON ops_engine.send_switch TO gih_app';
  INSERT INTO engine.config (key, value) VALUES ('ops_cloud_send', 'tests') ON CONFLICT (key) DO NOTHING;
END
$mig$;--> statement-breakpoint

-- Hand a new reply to the engine. Without pg_net (local and test databases) the row simply
-- waits; the relay's sweep or a test picks it up.
CREATE OR REPLACE FUNCTION ops_engine.outbox_dispatch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE k text;
BEGIN
  IF to_regproc('net.http_post') IS NULL OR to_regclass('engine.config') IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE 'SELECT value FROM engine.config WHERE key = ''intake_key''' INTO k;
  IF k IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := ''{"Content-Type":"application/json"}''::jsonb)'
    USING 'https://hwcofcngqgtsqqkojdzg.supabase.co/functions/v1/engine-relay?k=' || k, jsonb_build_object('id', NEW.id);
  RETURN NEW;
END
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS outbox_dispatch ON ops_engine.outbox;--> statement-breakpoint
CREATE TRIGGER outbox_dispatch AFTER INSERT ON ops_engine.outbox FOR EACH ROW EXECUTE FUNCTION ops_engine.outbox_dispatch();
