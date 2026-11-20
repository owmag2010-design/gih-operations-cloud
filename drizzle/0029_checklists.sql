CREATE TYPE "public"."checklist_applies_to" AS ENUM('matter', 'main_applicant', 'each_applicant', 'partner', 'dependants', 'sponsor');--> statement-breakpoint
CREATE TYPE "public"."checklist_template_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."document_request_status" AS ENUM('requested', 'received', 'under_review', 'accepted', 'rejected', 'waived');--> statement-breakpoint
CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"guidance" text,
	"applies_to" "checklist_applies_to" DEFAULT 'main_applicant' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"tracks_expiry" boolean DEFAULT false NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"service_id" uuid,
	"status" "checklist_template_status" DEFAULT 'draft' NOT NULL,
	"source_id" uuid,
	"source_note" text,
	"change_note" text,
	"published_by_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" "document_request_status",
	"to_status" "document_request_status" NOT NULL,
	"file_id" uuid,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"checklist_id" uuid,
	"template_item_id" uuid,
	"person_id" uuid,
	"label" text NOT NULL,
	"guidance" text,
	"required" boolean DEFAULT true NOT NULL,
	"tracks_expiry" boolean DEFAULT false NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"status" "document_request_status" DEFAULT 'requested' NOT NULL,
	"due_on" date,
	"file_id" uuid,
	"expires_on" date,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"applied_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matter_stages" ADD COLUMN "requires_documents" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_source_id_jurisdiction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."jurisdiction_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_events" ADD CONSTRAINT "document_request_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_events" ADD CONSTRAINT "document_request_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_checklists" ADD CONSTRAINT "matter_checklists_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_checklists" ADD CONSTRAINT "matter_checklists_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_template_items_template_idx" ON "checklist_template_items" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_family_version_uq" ON "checklist_templates" USING btree ("family_id","version");--> statement-breakpoint
CREATE INDEX "checklist_templates_firm_idx" ON "checklist_templates" USING btree ("firm_id","country_code");--> statement-breakpoint
CREATE INDEX "document_request_events_request_idx" ON "document_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "document_requests_matter_idx" ON "document_requests" USING btree ("matter_id","position");--> statement-breakpoint
CREATE INDEX "document_requests_firm_status_idx" ON "document_requests" USING btree ("firm_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "matter_checklists_matter_template_uq" ON "matter_checklists" USING btree ("matter_id","template_id");