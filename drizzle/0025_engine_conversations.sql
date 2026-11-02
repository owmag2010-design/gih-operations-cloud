-- Conversations: a read-only window onto the Hub enquiry engine (schema `engine`, run by
-- Supabase Edge Functions). The engine keeps answering clients; this app only reads.
--
-- The engine's tables have no firm_id, so each lead is matched to a practice here, in the
-- same order the engine itself uses: Owen's instruction for that lead, then the acting firm
-- on its proposal, then the partner website it came in through. Leads that match no
-- practice belong to the Hub and are visible only with Hub intake access (app.intake = on).
--
-- The views are owned by the migration role and filter on the transaction's scope
-- (app.org_id, app.firm_ids, app.intake set by withScope), so gih_app sees exactly the rows
-- its scope allows and never touches the engine tables themselves. They live in their own
-- schema, which is not exposed through the Supabase REST API. Idempotent: it is applied by
-- hand before the release workflow runs it again.

CREATE SCHEMA IF NOT EXISTS ops_engine;--> statement-breakpoint
REVOKE ALL ON SCHEMA ops_engine FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA ops_engine TO gih_app;--> statement-breakpoint

DO $mig$
BEGIN
  IF to_regclass('engine.leads') IS NULL THEN
    RAISE NOTICE 'engine schema not present: conversation views skipped';
    RETURN;
  END IF;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ops_engine.leads WITH (security_barrier = true) AS
    SELECT x.* FROM (
      SELECT
        l.id, l.created_at, l.last_message_at, l.name, l.email, l.phone, l.first_channel, l.status, l.matter,
        l.service_key, l.is_test, l.proposal_slug,
        l.facts->>'site_source' AS site_source,
        CASE WHEN COALESCE(l.facts->>'human_until', '') ~ '^\d{4}-' THEN (l.facts->>'human_until')::timestamptz END AS human_until,
        COALESCE(l.instructions, '{}'::jsonb) AS instructions,
        f.id AS firm_id,
        f.trading_name AS firm_name,
        p.status AS proposal_status,
        p.record->>'ref' AS proposal_ref,
        lm.channel AS last_channel,
        lm.direction AS last_direction,
        left(lm.body, 240) AS last_body,
        lm.created_at AS last_at,
        (SELECT max(c.last_seen) FROM engine.chats c WHERE c.lead_id = l.id) AS chat_last_seen
      FROM engine.leads l
      LEFT JOIN engine.proposals p ON p.slug = l.proposal_slug
      LEFT JOIN LATERAL (
        SELECT m.channel, m.direction, m.body, m.created_at FROM engine.messages m
        WHERE m.lead_id = l.id ORDER BY m.created_at DESC LIMIT 1
      ) lm ON true
      LEFT JOIN public.firms f
        ON f.org_id::text = current_setting('app.org_id', true)
       AND f.trading_name = COALESCE(
             NULLIF(l.instructions->>'firm', ''),
             p.record->'firm'->>'name',
             CASE l.facts->>'site_source'
               WHEN 'veritas-site' THEN 'Veritas Emigrate'
               WHEN 'mimshac-site' THEN 'Mimshac Group'
               WHEN 'nextmove-site' THEN 'Nextmove Advisory'
             END)
    ) x
    WHERE COALESCE(current_setting('app.org_id', true), '') <> ''
      AND (x.firm_id = ANY (app_firm_ids())
           OR (x.firm_id IS NULL AND current_setting('app.intake', true) = 'on'))
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ops_engine.messages WITH (security_barrier = true) AS
    SELECT m.id, m.lead_id, m.created_at, m.channel, m.direction, m.body, m.delivery, m.skipped_reason,
           m.payload->>'by' AS sent_by
    FROM engine.messages m
    WHERE m.lead_id IN (SELECT id FROM ops_engine.leads)
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ops_engine.proposals WITH (security_barrier = true) AS
    SELECT p.slug, p.lead_id, p.status, p.created_at, p.updated_at,
           p.record->>'ref' AS ref,
           p.record->>'matter' AS matter,
           p.record->'firm'->>'name' AS firm,
           lower(COALESCE(p.record->>'currency', 'ZAR')) AS currency,
           COALESCE(NULLIF(p.record->>'deposit_pct', '')::numeric, 50) AS deposit_pct,
           (SELECT COALESCE(sum(NULLIF(fee->>'amount', '')::numeric), 0)
              FROM jsonb_array_elements(COALESCE(p.record->'fees', '[]'::jsonb)) fee) AS core,
           p.record->>'note' AS note
    FROM engine.proposals p
    WHERE p.slug NOT LIKE 'tpl-%'
      AND p.lead_id IN (SELECT id FROM ops_engine.leads)
  $v$;

  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ops_engine FROM PUBLIC';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA ops_engine TO gih_app';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ops_engine FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SCHEMA ops_engine FROM anon, authenticated';
  END IF;
END
$mig$;
