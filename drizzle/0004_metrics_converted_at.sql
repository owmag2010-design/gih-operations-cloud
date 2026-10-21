-- Count conversions by the time they happened, not the lead's last update.
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH allowed AS (
    SELECT f.id FROM firms f
    WHERE f.id = ANY (p_firm_ids)
      AND f.org_id::text = current_setting('app.org_id', true)
      AND (f.share_aggregate_metrics OR f.id = ANY (app_firm_ids()))
  )
  SELECT
    a.id,
    (SELECT count(*) FROM leads l WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND l.created_at >= p_since),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open'),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open' AND l.assigned_to_id IS NULL),
    (SELECT count(*) FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND s.category = 'open' AND l.follow_up_at < now()),
    (SELECT count(*) FROM leads l
       WHERE l.firm_id = a.id AND l.deleted_at IS NULL AND l.converted_at >= p_since),
    (SELECT count(*) FROM clients c WHERE c.firm_id = a.id AND c.deleted_at IS NULL AND c.status = 'active'),
    (SELECT count(*) FROM clients c WHERE c.firm_id = a.id AND c.deleted_at IS NULL AND c.created_at >= p_since)
  FROM allowed a
$$;
