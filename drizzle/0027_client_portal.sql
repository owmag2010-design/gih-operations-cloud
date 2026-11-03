-- Client portal (Release 4, first slice).
-- One portal per matter. The client opens a private link (only its SHA-256 hash is
-- stored), proves they own the email address with a six-digit code, and gets a
-- 30-day session. Everything the client side does goes through the SECURITY DEFINER
-- functions below, keyed by the session hash: they return or change exactly one
-- matter's client-visible data and nothing else. Staff use the tables through the
-- normal services, under firm row-level security. Codes and sessions have no policy
-- for gih_app at all, so the app can reach them only through the functions.

CREATE TABLE portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms (id),
  matter_id uuid NOT NULL,
  client_id uuid NOT NULL,
  email citext NOT NULL CHECK (position('@' in email) > 1),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  -- The link itself, encrypted with DATA_ENCRYPTION_KEY, so staff can copy it again.
  token_enc text NOT NULL,
  drive_folder_id text CHECK (drive_folder_id IS NULL OR drive_folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  created_by_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  invited_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT portal_access_id_firm_uq UNIQUE (id, firm_id),
  CONSTRAINT portal_access_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE,
  CONSTRAINT portal_access_client_same_firm_fk FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id)
);--> statement-breakpoint
-- One live portal per matter; a replaced link is revoked first.
CREATE UNIQUE INDEX portal_access_live_uq ON portal_access (matter_id) WHERE revoked_at IS NULL;--> statement-breakpoint

CREATE TABLE portal_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL REFERENCES portal_access (id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (length(code_hash) = 64),
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX portal_codes_access_idx ON portal_codes (access_id, created_at);--> statement-breakpoint

CREATE TABLE portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL REFERENCES portal_access (id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE CHECK (length(session_hash) = 64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);--> statement-breakpoint

CREATE TABLE portal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms (id),
  matter_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 160),
  group_label text CHECK (group_label IS NULL OR length(group_label) <= 80),
  status text NOT NULL DEFAULT 'needed' CHECK (status IN ('needed', 'uploaded', 'accepted', 'waived')),
  position int NOT NULL DEFAULT 0,
  created_by_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_checklist_items_id_firm_uq UNIQUE (id, firm_id),
  CONSTRAINT portal_checklist_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX portal_checklist_matter_idx ON portal_checklist_items (matter_id, position);--> statement-breakpoint

CREATE TABLE portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms (id),
  matter_id uuid NOT NULL,
  author_kind text NOT NULL CHECK (author_kind IN ('client', 'staff')),
  author_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  internal boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (author_kind = 'staff' OR NOT internal),
  CONSTRAINT portal_messages_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX portal_messages_matter_idx ON portal_messages (matter_id, created_at);--> statement-breakpoint

CREATE TABLE portal_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms (id),
  matter_id uuid NOT NULL,
  checklist_item_id uuid,
  document_file_id uuid NOT NULL REFERENCES document_files (id) ON DELETE CASCADE,
  filename text NOT NULL,
  size int NOT NULL,
  drive_status text NOT NULL DEFAULT 'pending' CHECK (drive_status IN ('pending', 'uploaded', 'failed', 'not_configured', 'no_folder')),
  drive_file_id text,
  drive_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_uploads_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE,
  CONSTRAINT portal_uploads_item_same_firm_fk FOREIGN KEY (checklist_item_id, firm_id) REFERENCES portal_checklist_items (id, firm_id) ON DELETE SET NULL (checklist_item_id)
);--> statement-breakpoint
CREATE INDEX portal_uploads_matter_idx ON portal_uploads (matter_id, created_at);--> statement-breakpoint

-- ── Row-level security ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_access', 'portal_checklist_items', 'portal_messages', 'portal_uploads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()))',
      t || '_firm_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO gih_app', t);
  END LOOP;
END
$$;--> statement-breakpoint
-- Restricted matters stay hidden from staff outside the matter team, as for notes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_access', 'portal_checklist_items', 'portal_messages', 'portal_uploads'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO gih_app USING (EXISTS (SELECT 1 FROM matters m WHERE m.id = %I.matter_id))',
      t || '_matter_visible', t, t
    );
  END LOOP;
END
$$;--> statement-breakpoint
ALTER TABLE portal_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON portal_codes, portal_sessions FROM gih_app;--> statement-breakpoint

-- ── Client side ──

-- The link itself: is it live, and which (masked) address will the code go to?
CREATE OR REPLACE FUNCTION portal_link_info(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE; v_firm text; v_first text;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.portal_access WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT trading_name INTO v_firm FROM public.firms WHERE id = a.firm_id;
  SELECT first_name INTO v_first FROM public.clients WHERE id = a.client_id;
  RETURN jsonb_build_object(
    'firstName', v_first,
    'firm', v_firm,
    'emailHint', left(split_part(a.email::text, '@', 1), 2) || '•••@' || split_part(a.email::text, '@', 2)
  );
END
$$;--> statement-breakpoint

-- Store a new sign-in code. At most five codes an hour per portal.
CREATE OR REPLACE FUNCTION portal_issue_code(p_token_hash text, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE; v_recent int; v_org uuid; v_first text;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR length(p_code_hash) <> 64 THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO a FROM public.portal_access WHERE token_hash = p_token_hash AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  SELECT count(*) INTO v_recent FROM public.portal_codes WHERE access_id = a.id AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN RETURN jsonb_build_object('result', 'too_many'); END IF;
  UPDATE public.portal_codes SET used_at = now() WHERE access_id = a.id AND used_at IS NULL;
  INSERT INTO public.portal_codes (access_id, code_hash, expires_at) VALUES (a.id, p_code_hash, now() + interval '15 minutes');
  SELECT org_id INTO v_org FROM public.firms WHERE id = a.firm_id;
  SELECT first_name INTO v_first FROM public.clients WHERE id = a.client_id;
  RETURN jsonb_build_object('result', 'sent', 'email', a.email::text, 'orgId', v_org, 'firmId', a.firm_id, 'firstName', v_first);
END
$$;--> statement-breakpoint

-- Check a code and, if it matches, open a 30-day session. Five tries per code.
CREATE OR REPLACE FUNCTION portal_verify_code(p_token_hash text, p_code_hash text, p_session_hash text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE; c public.portal_codes%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR length(p_code_hash) <> 64 OR length(p_session_hash) <> 64 THEN RETURN 'not_found'; END IF;
  SELECT * INTO a FROM public.portal_access WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO c FROM public.portal_codes WHERE access_id = a.id AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR c.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF c.attempts >= 5 THEN RETURN 'locked'; END IF;
  IF c.code_hash <> p_code_hash THEN
    UPDATE public.portal_codes SET attempts = attempts + 1 WHERE id = c.id;
    RETURN CASE WHEN c.attempts + 1 >= 5 THEN 'locked' ELSE 'wrong' END;
  END IF;
  UPDATE public.portal_codes SET used_at = now() WHERE id = c.id;
  INSERT INTO public.portal_sessions (access_id, session_hash, expires_at) VALUES (a.id, p_session_hash, now() + interval '30 days');
  RETURN 'ok';
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION portal_end_session(p_session_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.portal_sessions SET ended_at = now() WHERE session_hash = p_session_hash AND ended_at IS NULL;
$$;--> statement-breakpoint

-- The live portal behind a session, or NULL. Internal notes are never included.
CREATE OR REPLACE FUNCTION portal_session_access(p_session_hash text)
RETURNS public.portal_access
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE;
BEGIN
  IF p_session_hash IS NULL OR length(p_session_hash) <> 64 THEN RETURN NULL; END IF;
  SELECT pa.* INTO a FROM public.portal_sessions s JOIN public.portal_access pa ON pa.id = s.access_id
    WHERE s.session_hash = p_session_hash AND s.ended_at IS NULL AND s.expires_at > now() AND pa.revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN a;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION portal_view(p_session_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE; m public.matters%ROWTYPE; cl public.clients%ROWTYPE; f public.firms%ROWTYPE;
  v_stage_pos int; v_service_stages boolean; v_stages jsonb; v_items jsonb; v_msgs jsonb; v_uploads jsonb; v_service text; v_updated timestamptz;
BEGIN
  a := portal_session_access(p_session_hash);
  IF a.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.matters WHERE id = a.matter_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO cl FROM public.clients WHERE id = a.client_id;
  SELECT * INTO f FROM public.firms WHERE id = a.firm_id;
  SELECT name INTO v_service FROM public.services WHERE id = m.service_id;
  UPDATE public.portal_access SET last_seen_at = now() WHERE id = a.id;

  SELECT EXISTS (SELECT 1 FROM public.matter_stages WHERE firm_id = m.firm_id AND service_id = m.service_id AND is_active) INTO v_service_stages;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'key', st.key, 'name', st.name, 'category', st.category) ORDER BY st.position), '[]'::jsonb)
    INTO v_stages FROM public.matter_stages st
    WHERE st.firm_id = m.firm_id AND st.is_active AND st.category <> 'closed'
      AND (CASE WHEN v_service_stages THEN st.service_id = m.service_id ELSE st.service_id IS NULL END);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'group', i.group_label, 'status', i.status) ORDER BY i.position, i.created_at), '[]'::jsonb)
    INTO v_items FROM public.portal_checklist_items i WHERE i.matter_id = m.id AND i.status <> 'waived';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', pm.id, 'from', pm.author_kind, 'body', pm.body, 'at', pm.created_at,
      'name', CASE WHEN pm.author_kind = 'client' THEN cl.first_name || coalesce(' ' || cl.last_name, '') ELSE f.trading_name END
    ) ORDER BY pm.created_at), '[]'::jsonb)
    INTO v_msgs FROM public.portal_messages pm WHERE pm.matter_id = m.id AND NOT pm.internal;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'filename', u.filename, 'itemId', u.checklist_item_id, 'at', u.created_at) ORDER BY u.created_at DESC), '[]'::jsonb)
    INTO v_uploads FROM public.portal_uploads u WHERE u.matter_id = m.id;

  SELECT greatest(m.updated_at,
    (SELECT max(created_at) FROM public.portal_messages WHERE matter_id = m.id AND NOT internal),
    (SELECT max(updated_at) FROM public.portal_checklist_items WHERE matter_id = m.id)) INTO v_updated;

  RETURN jsonb_build_object(
    'client', jsonb_build_object('firstName', cl.first_name, 'lastName', cl.last_name, 'email', a.email::text, 'phone', cl.phone, 'nationality', cl.nationality, 'since', cl.created_at),
    'matter', jsonb_build_object('ref', m.ref, 'title', m.title, 'service', v_service, 'jurisdiction', m.jurisdiction, 'openedAt', m.opened_at,
                                 'stageId', m.stage_id, 'submittedOn', m.submitted_on, 'submissionChannel', m.submission_channel, 'outcome', m.outcome, 'closed', m.closed_at IS NOT NULL),
    'firm', jsonb_build_object('name', f.trading_name, 'slug', f.slug, 'email', f.contact_email, 'phone', f.contact_phone, 'website', f.website),
    'stages', v_stages, 'checklist', v_items, 'messages', v_msgs, 'uploads', v_uploads, 'updatedAt', v_updated
  );
END
$$;--> statement-breakpoint

-- A client message. Returns what the app needs to alert the team.
CREATE OR REPLACE FUNCTION portal_post_message(p_session_hash text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE; v_body text := btrim(coalesce(p_body, '')); v_id uuid;
BEGIN
  a := portal_session_access(p_session_hash);
  IF a.id IS NULL THEN RETURN jsonb_build_object('result', 'signed_out'); END IF;
  IF length(v_body) < 1 OR length(v_body) > 4000 THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF (SELECT count(*) FROM public.portal_messages WHERE matter_id = a.matter_id AND author_kind = 'client' AND created_at > now() - interval '10 minutes') >= 20 THEN
    RETURN jsonb_build_object('result', 'too_many');
  END IF;
  INSERT INTO public.portal_messages (firm_id, matter_id, author_kind, body) VALUES (a.firm_id, a.matter_id, 'client', v_body) RETURNING id INTO v_id;
  INSERT INTO public.activities (firm_id, client_id, matter_id, type, body, data)
    VALUES (a.firm_id, a.client_id, a.matter_id, 'note', 'Client sent a message in the portal', jsonb_build_object('portalMessageId', v_id));
  RETURN jsonb_build_object('result', 'ok', 'id', v_id) || portal_alert_targets(a);
END
$$;--> statement-breakpoint

-- A client upload: the file is kept with the matter's files and queued for Google Drive.
CREATE OR REPLACE FUNCTION portal_add_upload(p_session_hash text, p_item_id uuid, p_filename text, p_content_type text, p_size int, p_sha256 text, p_data bytea)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE a public.portal_access%ROWTYPE; v_file uuid; v_upload uuid; v_item text;
BEGIN
  a := portal_session_access(p_session_hash);
  IF a.id IS NULL THEN RETURN jsonb_build_object('result', 'signed_out'); END IF;
  IF p_size <= 0 OR p_size > 15 * 1024 * 1024 OR length(p_sha256) <> 64 OR length(btrim(coalesce(p_filename, ''))) = 0 THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF (SELECT count(*) FROM public.portal_uploads WHERE matter_id = a.matter_id AND created_at > now() - interval '1 hour') >= 40 THEN
    RETURN jsonb_build_object('result', 'too_many');
  END IF;
  IF p_item_id IS NOT NULL THEN
    SELECT label INTO v_item FROM public.portal_checklist_items WHERE id = p_item_id AND matter_id = a.matter_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  END IF;
  INSERT INTO public.document_files (firm_id, client_id, matter_id, filename, content_type, size, sha256, data, description, ocr_status)
    VALUES (a.firm_id, a.client_id, a.matter_id, left(p_filename, 200), left(p_content_type, 120), p_size, p_sha256, p_data,
            'Uploaded by the client in the portal' || coalesce(': ' || v_item, ''), 'pending')
    RETURNING id INTO v_file;
  INSERT INTO public.portal_uploads (firm_id, matter_id, checklist_item_id, document_file_id, filename, size, drive_status)
    VALUES (a.firm_id, a.matter_id, p_item_id, v_file, left(p_filename, 200), p_size, CASE WHEN a.drive_folder_id IS NULL THEN 'no_folder' ELSE 'pending' END)
    RETURNING id INTO v_upload;
  IF p_item_id IS NOT NULL THEN
    UPDATE public.portal_checklist_items SET status = 'uploaded', updated_at = now() WHERE id = p_item_id AND status = 'needed';
  END IF;
  INSERT INTO public.activities (firm_id, client_id, matter_id, type, body, data)
    VALUES (a.firm_id, a.client_id, a.matter_id, 'note', 'Client uploaded ' || left(p_filename, 200) || ' in the portal',
            jsonb_build_object('portalUploadId', v_upload, 'documentFileId', v_file));
  RETURN jsonb_build_object('result', 'ok', 'uploadId', v_upload, 'item', v_item, 'driveFolderId', a.drive_folder_id) || portal_alert_targets(a);
END
$$;--> statement-breakpoint

-- Who to tell, and the matter details for the alert.
CREATE OR REPLACE FUNCTION portal_alert_targets(a public.portal_access)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object(
    'orgId', f.org_id, 'firmId', f.id, 'firmSlug', f.slug, 'firmName', f.trading_name, 'firmEmail', f.contact_email,
    'matterId', m.id, 'matterRef', m.ref, 'matterTitle', m.title,
    'clientName', cl.first_name || coalesce(' ' || cl.last_name, ''),
    'staff', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('name', u.name, 'email', u.email::text))
       FROM public.users u WHERE u.status = 'active' AND (u.id = m.case_manager_id OR u.id = m.consultant_id
         OR u.id IN (SELECT mm.user_id FROM public.matter_members mm WHERE mm.matter_id = m.id))), '[]'::jsonb)
  )
  FROM public.matters m JOIN public.firms f ON f.id = m.firm_id JOIN public.clients cl ON cl.id = m.client_id
  WHERE m.id = a.matter_id;
$$;--> statement-breakpoint

-- After the app has tried Google Drive, record the result on the upload.
CREATE OR REPLACE FUNCTION portal_set_drive_result(p_upload_id uuid, p_status text, p_drive_file_id text, p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.portal_uploads
    SET drive_status = p_status, drive_file_id = left(p_drive_file_id, 120), drive_error = left(p_error, 500)
    WHERE id = p_upload_id AND drive_status = 'pending' AND p_status IN ('uploaded', 'failed', 'not_configured');
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION portal_link_info(text), portal_issue_code(text, text), portal_verify_code(text, text, text), portal_end_session(text),
  portal_session_access(text), portal_view(text), portal_post_message(text, text), portal_add_upload(text, uuid, text, text, int, text, bytea),
  portal_alert_targets(public.portal_access), portal_set_drive_result(uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION portal_link_info(text), portal_issue_code(text, text), portal_verify_code(text, text, text), portal_end_session(text),
  portal_view(text), portal_post_message(text, text), portal_add_upload(text, uuid, text, text, int, text, bytea),
  portal_set_drive_result(uuid, text, text, text) TO gih_app;
