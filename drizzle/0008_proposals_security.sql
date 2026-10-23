-- Release 2: price history and proposals.
-- Same-firm keys, row-level security, and the two narrow definer functions the
-- public proposal link uses (it has no staff session, so no firm scope).

-- ── Same-firm integrity ──
ALTER TABLE services ADD CONSTRAINT services_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE proposals ADD CONSTRAINT proposals_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE service_price_versions ADD CONSTRAINT service_price_versions_service_same_firm_fk
  FOREIGN KEY (service_id, firm_id) REFERENCES services (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE proposals ADD CONSTRAINT proposals_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE proposal_items ADD CONSTRAINT proposal_items_proposal_same_firm_fk
  FOREIGN KEY (proposal_id, firm_id) REFERENCES proposals (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE proposal_items ADD CONSTRAINT proposal_items_service_same_firm_fk
  FOREIGN KEY (service_id, firm_id) REFERENCES services (id, firm_id);--> statement-breakpoint
ALTER TABLE proposal_versions ADD CONSTRAINT proposal_versions_proposal_same_firm_fk
  FOREIGN KEY (proposal_id, firm_id) REFERENCES proposals (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint

-- ── Value checks ──
ALTER TABLE service_price_versions ADD CONSTRAINT service_price_versions_amounts_valid
  CHECK (total_minor >= 0 AND deposit_minor >= 0 AND deposit_minor <= total_minor AND version >= 1);--> statement-breakpoint
ALTER TABLE proposals ADD CONSTRAINT proposals_amounts_valid
  CHECK (total_minor >= 0 AND deposit_minor >= 0 AND deposit_minor <= total_minor AND version >= 1 AND valid_days BETWEEN 1 AND 90);--> statement-breakpoint
ALTER TABLE proposal_items ADD CONSTRAINT proposal_items_amounts_valid
  CHECK (unit_minor >= 0 AND deposit_minor >= 0 AND quantity BETWEEN 1 AND 99);--> statement-breakpoint

-- ── Row-level security ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_price_versions', 'proposals', 'proposal_items', 'proposal_versions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO gih_app USING (firm_id = ANY (public.app_firm_ids())) WITH CHECK (firm_id = ANY (public.app_firm_ids()))',
      t || '_firm_isolation', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Released snapshots and price history are append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON proposal_versions, service_price_versions FROM gih_app;--> statement-breakpoint

-- Supabase Data API roles never see these tables (see 0006).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.service_price_versions, public.proposals, public.proposal_items, public.proposal_versions FROM %I', r);
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint

-- Existing services get version 1 of their price history.
INSERT INTO service_price_versions (firm_id, service_id, version, name, currency, total_minor, deposit_minor, lines, add_ons, is_active, reason, created_at)
SELECT s.firm_id, s.id, 1, s.name, s.currency, s.total_minor, s.deposit_minor, s.lines, s.add_ons, s.is_active,
       coalesce(s.source_note, 'Initial fee schedule'), s.created_at
FROM services s
WHERE NOT EXISTS (SELECT 1 FROM service_price_versions v WHERE v.service_id = s.id);--> statement-breakpoint

-- ── Public proposal link ──
-- The client holds a random token; only its SHA-256 hash is stored. These
-- functions return or change exactly one released proposal, and nothing else.
CREATE OR REPLACE FUNCTION proposal_public_view(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  p public.proposals%ROWTYPE;
  snap jsonb;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.proposals WHERE link_token_hash = p_token_hash;
  IF NOT FOUND OR p.status NOT IN ('released', 'accepted', 'declined') THEN RETURN NULL; END IF;
  SELECT v.snapshot INTO snap FROM public.proposal_versions v WHERE v.proposal_id = p.id AND v.version = p.version;
  IF snap IS NULL THEN RETURN NULL; END IF;
  IF p.first_viewed_at IS NULL AND p.status = 'released' AND p.link_expires_at > now() THEN
    UPDATE public.proposals SET first_viewed_at = now() WHERE id = p.id;
    INSERT INTO public.activities (firm_id, lead_id, type, body, data)
      VALUES (p.firm_id, p.lead_id, 'proposal', 'Client opened the proposal', jsonb_build_object('proposalId', p.id, 'ref', p.ref, 'event', 'viewed'));
  END IF;
  RETURN jsonb_build_object(
    'snapshot', snap,
    'status', p.status,
    'expired', p.status = 'released' AND p.link_expires_at <= now(),
    'expiresAt', p.link_expires_at,
    'respondedAt', p.responded_at,
    'responseName', p.response_name
  );
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION proposal_public_respond(p_token_hash text, p_accept boolean, p_name text, p_note text, p_ip text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  p public.proposals%ROWTYPE;
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_org uuid;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN RETURN 'not_found'; END IF;
  SELECT * INTO p FROM public.proposals WHERE link_token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p.status IN ('accepted', 'declined') THEN RETURN 'already_' || p.status::text; END IF;
  IF p.status <> 'released' THEN RETURN 'not_found'; END IF;
  IF p.link_expires_at <= now() THEN RETURN 'expired'; END IF;
  IF length(v_name) < 2 THEN RETURN 'name_required'; END IF;

  UPDATE public.proposals
    SET status = CASE WHEN p_accept THEN 'accepted'::public.proposal_status ELSE 'declined'::public.proposal_status END,
        responded_at = now(), response_name = v_name, response_note = v_note, response_ip = left(p_ip, 64), updated_at = now()
    WHERE id = p.id;
  INSERT INTO public.activities (firm_id, lead_id, type, body, data)
    VALUES (p.firm_id, p.lead_id, 'proposal',
            CASE WHEN p_accept THEN 'Client accepted the proposal' ELSE 'Client declined the proposal' END,
            jsonb_build_object('proposalId', p.id, 'ref', p.ref, 'event', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, 'name', v_name));
  SELECT f.org_id INTO v_org FROM public.firms f WHERE f.id = p.firm_id;
  INSERT INTO public.audit_events (org_id, firm_id, action, entity_type, entity_id, summary, data, ip)
    VALUES (v_org, p.firm_id, CASE WHEN p_accept THEN 'proposal.accepted' ELSE 'proposal.declined' END, 'proposal', p.id::text,
            CASE WHEN p_accept THEN 'Client accepted ' ELSE 'Client declined ' END || p.ref || ' (v' || p.version || ')',
            jsonb_build_object('version', p.version), left(p_ip, 64));
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION proposal_public_view(text), proposal_public_respond(text, boolean, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION proposal_public_view(text), proposal_public_respond(text, boolean, text, text, text) TO gih_app;
