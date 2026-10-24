-- Matters, tasks, notes and calendar: same-firm integrity, checks and
-- row-level security. See docs/03-database-and-isolation.md.

-- ── Composite keys so children can only point at parents in the same firm ──
ALTER TABLE matters ADD CONSTRAINT matters_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE matter_stages ADD CONSTRAINT matter_stages_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE matter_people ADD CONSTRAINT matter_people_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE deadline_rules ADD CONSTRAINT deadline_rules_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE task_templates ADD CONSTRAINT task_templates_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE notes ADD CONSTRAINT notes_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
CREATE UNIQUE INDEX matter_stages_scope_key_uq ON matter_stages (firm_id, service_id, key) NULLS NOT DISTINCT;--> statement-breakpoint

ALTER TABLE matter_stages ADD CONSTRAINT matter_stages_service_same_firm_fk
  FOREIGN KEY (service_id, firm_id) REFERENCES services (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE matters ADD CONSTRAINT matters_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE matters ADD CONSTRAINT matters_stage_same_firm_fk
  FOREIGN KEY (stage_id, firm_id) REFERENCES matter_stages (id, firm_id);--> statement-breakpoint
ALTER TABLE matters ADD CONSTRAINT matters_service_same_firm_fk
  FOREIGN KEY (service_id, firm_id) REFERENCES services (id, firm_id);--> statement-breakpoint
ALTER TABLE matters ADD CONSTRAINT matters_proposal_same_firm_fk
  FOREIGN KEY (proposal_id, firm_id) REFERENCES proposals (id, firm_id);--> statement-breakpoint
CREATE UNIQUE INDEX matters_proposal_once_uq ON matters (proposal_id) WHERE proposal_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE matter_members ADD CONSTRAINT matter_members_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE matter_people ADD CONSTRAINT matter_people_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE matter_facts ADD CONSTRAINT matter_facts_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE matter_facts ADD CONSTRAINT matter_facts_person_same_firm_fk
  FOREIGN KEY (person_id, firm_id) REFERENCES matter_people (id, firm_id) ON DELETE SET NULL (person_id);--> statement-breakpoint
ALTER TABLE matter_dates ADD CONSTRAINT matter_dates_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE matter_dates ADD CONSTRAINT matter_dates_person_same_firm_fk
  FOREIGN KEY (person_id, firm_id) REFERENCES matter_people (id, firm_id) ON DELETE SET NULL (person_id);--> statement-breakpoint
ALTER TABLE matter_dates ADD CONSTRAINT matter_dates_rule_same_firm_fk
  FOREIGN KEY (rule_id, firm_id) REFERENCES deadline_rules (id, firm_id);--> statement-breakpoint
ALTER TABLE matter_dates ADD CONSTRAINT matter_dates_basis_valid CHECK (
  (basis_kind = 'recorded')
  OR (basis_kind = 'calculated' AND rule_id IS NOT NULL AND from_date IS NOT NULL AND calculated_on IS NOT NULL)
  OR (basis_kind = 'adjusted' AND adjustment_reason IS NOT NULL AND reviewed_by_id IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE task_templates ADD CONSTRAINT task_templates_service_same_firm_fk
  FOREIGN KEY (service_id, firm_id) REFERENCES services (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE task_templates ADD CONSTRAINT task_templates_stage_same_firm_fk
  FOREIGN KEY (stage_id, firm_id) REFERENCES matter_stages (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_template_same_firm_fk
  FOREIGN KEY (template_id, firm_id) REFERENCES task_templates (id, firm_id) ON DELETE SET NULL (template_id);--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_personal_has_owner
  CHECK (firm_id IS NOT NULL OR (matter_id IS NULL AND client_id IS NULL AND lead_id IS NULL));--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_recurrence_valid CHECK (recurrence_interval BETWEEN 1 AND 365);--> statement-breakpoint
ALTER TABLE notes ADD CONSTRAINT notes_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE notes ADD CONSTRAINT notes_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE notes ADD CONSTRAINT notes_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE notes ADD CONSTRAINT notes_has_one_subject
  CHECK (num_nonnulls(matter_id, client_id, lead_id) = 1);--> statement-breakpoint
ALTER TABLE note_revisions ADD CONSTRAINT note_revisions_note_same_firm_fk
  FOREIGN KEY (note_id, firm_id) REFERENCES notes (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_client_same_firm_fk
  FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_lead_same_firm_fk
  FOREIGN KEY (lead_id, firm_id) REFERENCES leads (id, firm_id);--> statement-breakpoint
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_personal_has_no_subject
  CHECK (firm_id IS NOT NULL OR (matter_id IS NULL AND client_id IS NULL AND lead_id IS NULL));--> statement-breakpoint
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_times_valid
  CHECK (ends_at IS NULL OR ends_at >= starts_at);--> statement-breakpoint
ALTER TABLE activities ADD CONSTRAINT activities_matter_same_firm_fk
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint

-- Note history is append-only for the application.
REVOKE UPDATE, DELETE ON note_revisions FROM gih_app;--> statement-breakpoint

-- ── Row-level security: firm isolation ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'matter_stages', 'matters', 'matter_members', 'matter_people', 'matter_facts',
    'deadline_rules', 'matter_dates', 'task_templates', 'notes', 'note_revisions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()))',
      t || '_firm_isolation', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Tasks and events: a practice's rows, or the person's own personal rows.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tasks_access ON tasks FOR ALL TO gih_app
  USING (
    org_id::text = current_setting('app.org_id', true) AND (
      firm_id = ANY (app_firm_ids())
      OR (firm_id IS NULL AND (created_by_id::text = current_setting('app.user_id', true) OR assignee_id::text = current_setting('app.user_id', true)))
    )
  )
  WITH CHECK (
    org_id::text = current_setting('app.org_id', true) AND (
      firm_id = ANY (app_firm_ids())
      OR (firm_id IS NULL AND created_by_id::text = current_setting('app.user_id', true)
          AND (assignee_id IS NULL OR assignee_id::text = current_setting('app.user_id', true)))
    )
  );--> statement-breakpoint
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY calendar_events_access ON calendar_events FOR ALL TO gih_app
  USING (
    org_id::text = current_setting('app.org_id', true) AND (
      firm_id = ANY (app_firm_ids())
      OR (firm_id IS NULL AND (created_by_id::text = current_setting('app.user_id', true) OR organiser_id::text = current_setting('app.user_id', true)))
    )
  )
  WITH CHECK (
    org_id::text = current_setting('app.org_id', true) AND (
      firm_id = ANY (app_firm_ids())
      OR (firm_id IS NULL AND created_by_id::text = current_setting('app.user_id', true))
    )
  );--> statement-breakpoint

-- ── Restricted matters ──
-- A restricted matter (and everything hanging off it) is visible only to its
-- case manager, consultant, team members, and callers flagged as practice
-- administrators for this transaction (app.matter_admin_firms).
CREATE OR REPLACE FUNCTION matter_visible(p_matter uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_matter IS NULL OR EXISTS (
    SELECT 1 FROM public.matters m
     WHERE m.id = p_matter
       AND (NOT m.restricted
            OR m.case_manager_id::text = current_setting('app.user_id', true)
            OR m.consultant_id::text = current_setting('app.user_id', true)
            OR m.firm_id::text = ANY (string_to_array(COALESCE(current_setting('app.matter_admin_firms', true), ''), ','))
            OR EXISTS (SELECT 1 FROM public.matter_members mm WHERE mm.matter_id = m.id AND mm.user_id::text = current_setting('app.user_id', true)))
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION matter_visible(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION matter_visible(uuid) TO gih_app;--> statement-breakpoint

CREATE POLICY matters_restricted ON matters AS RESTRICTIVE FOR SELECT TO gih_app
  USING (NOT restricted
         OR case_manager_id::text = current_setting('app.user_id', true)
         OR consultant_id::text = current_setting('app.user_id', true)
         OR firm_id::text = ANY (string_to_array(COALESCE(current_setting('app.matter_admin_firms', true), ''), ','))
         OR EXISTS (SELECT 1 FROM matter_members mm WHERE mm.matter_id = matters.id AND mm.user_id::text = current_setting('app.user_id', true)));--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['matter_people', 'matter_facts', 'matter_dates', 'tasks', 'notes', 'calendar_events'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO gih_app USING (matter_visible(matter_id)) WITH CHECK (matter_visible(matter_id))',
      t || '_matter_restricted', t
    );
  END LOOP;
END
$$;
