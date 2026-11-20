CREATE TYPE "public"."calendar_status" AS ENUM('draft', 'verified', 'retired');--> statement-breakpoint
CREATE TYPE "public"."capability_area" AS ENUM('payments', 'accounting', 'messaging', 'email', 'e_signature', 'privacy', 'professional_regulation', 'data_residency');--> statement-breakpoint
CREATE TYPE "public"."capability_status" AS ENUM('not_assessed', 'pending', 'verified', 'unavailable', 'not_needed');--> statement-breakpoint
CREATE TYPE "public"."country_status" AS ENUM('draft', 'in_review', 'verified', 'operational', 'retired');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_source_kind" AS ENUM('legislation', 'official_fees', 'requirements', 'checklist', 'holidays', 'guidance', 'other');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_source_status" AS ENUM('draft', 'verified', 'superseded');--> statement-breakpoint
CREATE TABLE "business_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"region" text,
	"name" text NOT NULL,
	"status" "calendar_status" DEFAULT 'draft' NOT NULL,
	"source_title" text NOT NULL,
	"source_url" text NOT NULL,
	"notes" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "country_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "country_status" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"changed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "country_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"date_format" text NOT NULL,
	"phone_prefix" text,
	"timezones" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_timezone" text NOT NULL,
	"address_format" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status" "country_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"self_reviewed" boolean DEFAULT false NOT NULL,
	"operational_by_id" uuid,
	"operational_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_country_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"area" "capability_area" NOT NULL,
	"provider" text,
	"status" "capability_status" DEFAULT 'not_assessed' NOT NULL,
	"note" text,
	"evidence_url" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"kind" "jurisdiction_source_kind" NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"publisher" text,
	"version_label" text,
	"effective_from" date,
	"effective_to" date,
	"status" "jurisdiction_source_status" DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"next_review_on" date,
	"notes" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "other_nationalities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "deadline_rules" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "registered_country" text;--> statement-breakpoint
ALTER TABLE "matters" ADD COLUMN "operating_office_id" uuid;--> statement-breakpoint
ALTER TABLE "matters" ADD COLUMN "operating_country" text;--> statement-breakpoint
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_calendar_id_business_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."business_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profile_versions" ADD CONSTRAINT "country_profile_versions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profile_versions" ADD CONSTRAINT "country_profile_versions_profile_id_country_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."country_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profile_versions" ADD CONSTRAINT "country_profile_versions_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_operational_by_id_users_id_fk" FOREIGN KEY ("operational_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_profiles" ADD CONSTRAINT "country_profiles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_country_capabilities" ADD CONSTRAINT "entity_country_capabilities_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_country_capabilities" ADD CONSTRAINT "entity_country_capabilities_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_country_capabilities" ADD CONSTRAINT "entity_country_capabilities_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_country_capabilities" ADD CONSTRAINT "entity_country_capabilities_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_sources" ADD CONSTRAINT "jurisdiction_sources_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_sources" ADD CONSTRAINT "jurisdiction_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_sources" ADD CONSTRAINT "jurisdiction_sources_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_sources" ADD CONSTRAINT "jurisdiction_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendars_org_name_uq" ON "business_calendars" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "business_calendars_country_idx" ON "business_calendars" USING btree ("org_id","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holidays_cal_date_name_uq" ON "calendar_holidays" USING btree ("calendar_id","date","name");--> statement-breakpoint
CREATE INDEX "country_profile_versions_profile_idx" ON "country_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "country_profiles_org_code_uq" ON "country_profiles" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_country_capabilities_uq" ON "entity_country_capabilities" USING btree ("firm_id","country_code","area");--> statement-breakpoint
CREATE INDEX "jurisdiction_sources_country_idx" ON "jurisdiction_sources" USING btree ("org_id","country_code","kind");--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_operating_office_id_offices_id_fk" FOREIGN KEY ("operating_office_id") REFERENCES "public"."offices"("id") ON DELETE set null ON UPDATE no action;