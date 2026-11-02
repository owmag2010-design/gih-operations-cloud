-- Test-only copy of the enquiry engine's tables (the real ones live in Supabase,
-- created by the engine's own migrations). Columns match production; only those
-- the conversation views read matter.
CREATE SCHEMA IF NOT EXISTS engine;
CREATE TABLE IF NOT EXISTS engine.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  name text, phone text, email text, first_channel text, status text DEFAULT 'new', matter text, service_key text,
  is_test boolean DEFAULT false, last_message_at timestamptz, notes text, facts jsonb DEFAULT '{}'::jsonb,
  pending text[] DEFAULT '{}'::text[], proposal_slug text, asked_at timestamptz, instructions jsonb DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS engine.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), lead_id uuid, channel text, direction text,
  external_id text, body text, payload jsonb, skipped_reason text, delivery text);
CREATE TABLE IF NOT EXISTS engine.proposals (
  slug text PRIMARY KEY, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), lead_id uuid, status text DEFAULT 'ready', record jsonb);
CREATE TABLE IF NOT EXISTS engine.chats (
  sid text PRIMARY KEY, lead_id uuid, site text, page text, ip_hash text, created_at timestamptz DEFAULT now(), last_seen timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS engine.config (key text PRIMARY KEY, value text);
