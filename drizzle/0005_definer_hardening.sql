-- Security review L1: SECURITY DEFINER functions resolve only real tables
-- (pg_temp searched last, names schema-qualified), and the application role
-- may not create temporary tables that could shadow them.
CREATE OR REPLACE FUNCTION metrics_firm_summary(p_firm_ids uuid[], p_since timestamptz)
RETURNS TABLE (
  firm_id uuid,
  new_leads bigint,
  open_leads bigint,
  unassigned_open_leads bigint,
  overdue_follow_ups bigint,
  won_leads bigint,
  active_clients bigint,
  new_clients bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH allowed AS (
    SELECT f.id FROM public.firms f
    WHERE f.id = ANY (p_firm_ids)
      AND f.org_id::text = current_setting('app.org_id', true)
      AND (f.share_aggregate_metrics OR f.id = ANY (public.app_firm_ids()))
  )
  SELECT
    a.id,
    (SELECT count(*) FROM public.leads l WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND l.created_at >= p_since),
    (SELECT count(*) FROM public.leads l JOIN public.pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open'),
    (SELECT count(*) FROM public.leads l JOIN public.pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open' AND l.assigned_to_id IS NULL),
    (SELECT count(*) FROM public.leads l JOIN public.pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open' AND l.follow_up_at < now()),
    (SELECT count(*) FROM public.leads l
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND l.converted_at >= p_since),
    (SELECT count(*) FROM public.clients c WHERE c.firm_id = a.id AND c.deleted_at IS NULL AND c.status = 'active'),
    (SELECT count(*) FROM public.clients c WHERE c.firm_id = a.id AND c.deleted_at IS NULL AND c.created_at >= p_since)
  FROM allowed a
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION metrics_leads_by_source(p_firm_ids uuid[], p_since timestamptz)
RETURNS TABLE (firm_id uuid, source lead_source, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT l.firm_id, l.source, count(*)
  FROM public.leads l JOIN public.firms f ON f.id = l.firm_id
  WHERE l.firm_id = ANY (p_firm_ids)
    AND f.org_id::text = current_setting('app.org_id', true)
    AND (f.share_aggregate_metrics OR f.id = ANY (public.app_firm_ids()))
    AND l.deleted_at IS NULL AND l.created_at >= p_since
  GROUP BY l.firm_id, l.source
$$;--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM gih_app', current_database());
END
$$;
