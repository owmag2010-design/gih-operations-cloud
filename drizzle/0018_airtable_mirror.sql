CREATE TYPE "public"."mirror_run_kind" AS ENUM('full', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."mirror_run_status" AS ENUM('running', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."mirror_source_of_truth" AS ENUM('airtable', 'dashboard', 'shared');--> statement-breakpoint
CREATE TABLE "airtable_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_id" uuid,
	"source_id" uuid NOT NULL,
	"record_id" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_value" text,
	"search_text" text,
	"hash" text NOT NULL,
	"airtable_created_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "airtable_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_id" uuid,
	"base_id" text NOT NULL,
	"base_name" text NOT NULL,
	"table_id" text NOT NULL,
	"table_name" text NOT NULL,
	"dataset" text NOT NULL,
	"primary_field_id" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_of_truth" "mirror_source_of_truth" DEFAULT 'airtable' NOT NULL,
	"truth_note" text,
	"maps_to" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"cursor" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_full_sync_at" timestamp with time zone,
	"last_error" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"source_count" integer,
	"schema_checked_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airtable_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_id" uuid,
	"source_id" uuid NOT NULL,
	"kind" "mirror_run_kind" NOT NULL,
	"status" "mirror_run_status" DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"restored" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "airtable_records" ADD CONSTRAINT "airtable_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_records" ADD CONSTRAINT "airtable_records_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_records" ADD CONSTRAINT "airtable_records_source_id_airtable_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."airtable_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_sources" ADD CONSTRAINT "airtable_sources_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_sources" ADD CONSTRAINT "airtable_sources_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_sources" ADD CONSTRAINT "airtable_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_sync_runs" ADD CONSTRAINT "airtable_sync_runs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_sync_runs" ADD CONSTRAINT "airtable_sync_runs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airtable_sync_runs" ADD CONSTRAINT "airtable_sync_runs_source_id_airtable_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."airtable_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "airtable_records_source_record_uq" ON "airtable_records" USING btree ("source_id","record_id");--> statement-breakpoint
CREATE INDEX "airtable_records_record_idx" ON "airtable_records" USING btree ("org_id","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "airtable_sources_table_uq" ON "airtable_sources" USING btree ("org_id","base_id","table_id");--> statement-breakpoint
CREATE INDEX "airtable_sync_runs_source_idx" ON "airtable_sync_runs" USING btree ("source_id","started_at");