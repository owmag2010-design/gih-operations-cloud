-- Countries and jurisdictions: organisation-level configuration.
-- Every staff member of the organisation may read it (forms need the country
-- list); changes are limited to Hub roles by the countries service.

-- Organisation scoping on every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['country_profiles', 'country_profile_versions', 'business_calendars', 'calendar_holidays', 'jurisdiction_sources', 'entity_country_capabilities'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app
         USING (org_id::text = current_setting(''app.org_id'', true))
         WITH CHECK (org_id::text = current_setting(''app.org_id'', true))',
      t || '_org', t
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Codes are ISO 3166-1 alpha-2 in capitals.
ALTER TABLE country_profiles ADD CONSTRAINT country_profiles_code_valid CHECK (code ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE country_profiles ADD CONSTRAINT country_profiles_currency_valid CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE business_calendars ADD CONSTRAINT business_calendars_country_valid CHECK (country_code ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE jurisdiction_sources ADD CONSTRAINT jurisdiction_sources_country_valid CHECK (country_code ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE jurisdiction_sources ADD CONSTRAINT jurisdiction_sources_dates_valid CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);--> statement-breakpoint
ALTER TABLE entity_country_capabilities ADD CONSTRAINT entity_country_capabilities_country_valid CHECK (country_code ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE matters ADD CONSTRAINT matters_operating_country_valid CHECK (operating_country IS NULL OR operating_country ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE firms ADD CONSTRAINT firms_registered_country_valid CHECK (registered_country IS NULL OR registered_country ~ '^[A-Z]{2}$');--> statement-breakpoint

-- Children stay in their parent's organisation.
ALTER TABLE country_profiles ADD CONSTRAINT country_profiles_id_org_uq UNIQUE (id, org_id);--> statement-breakpoint
ALTER TABLE country_profile_versions ADD CONSTRAINT country_profile_versions_same_org_fk
  FOREIGN KEY (profile_id, org_id) REFERENCES country_profiles (id, org_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE business_calendars ADD CONSTRAINT business_calendars_id_org_uq UNIQUE (id, org_id);--> statement-breakpoint
ALTER TABLE calendar_holidays ADD CONSTRAINT calendar_holidays_same_org_fk
  FOREIGN KEY (calendar_id, org_id) REFERENCES business_calendars (id, org_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE firms ADD CONSTRAINT firms_id_org_uq UNIQUE (id, org_id);--> statement-breakpoint
ALTER TABLE entity_country_capabilities ADD CONSTRAINT entity_country_capabilities_same_org_fk
  FOREIGN KEY (firm_id, org_id) REFERENCES firms (id, org_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE deadline_rules ADD CONSTRAINT deadline_rules_calendar_fk
  FOREIGN KEY (calendar_id) REFERENCES business_calendars (id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE matters ADD CONSTRAINT matters_operating_office_fk
  FOREIGN KEY (operating_office_id) REFERENCES offices (id) ON DELETE SET NULL;--> statement-breakpoint

-- History is append-only; profiles are retired, never deleted.
REVOKE UPDATE, DELETE ON country_profile_versions FROM gih_app;--> statement-breakpoint
REVOKE DELETE ON country_profiles FROM gih_app;--> statement-breakpoint

-- A verified calendar's dates can't change until it is returned to draft
-- (which the service records), so a deadline's basis stays true.
CREATE OR REPLACE FUNCTION calendar_holidays_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cal uuid := COALESCE(NEW.calendar_id, OLD.calendar_id);
BEGIN
  IF EXISTS (SELECT 1 FROM business_calendars c WHERE c.id = cal AND c.status <> 'draft') THEN
    RAISE EXCEPTION 'calendar % is not a draft; return it to draft before changing its dates', cal USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint
CREATE TRIGGER calendar_holidays_locked BEFORE INSERT OR UPDATE OR DELETE ON calendar_holidays
  FOR EACH ROW EXECUTE FUNCTION calendar_holidays_locked();--> statement-breakpoint

-- Hosted Supabase: keep the Data API roles out (see 0006).
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['country_profiles', 'country_profile_versions', 'business_calendars', 'calendar_holidays', 'jurisdiction_sources', 'entity_country_capabilities'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
