CREATE TYPE "public"."date_basis_kind" AS ENUM('recorded', 'calculated', 'adjusted');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('consultation', 'appointment', 'biometrics', 'interview', 'submission', 'meeting', 'other');--> statement-breakpoint
CREATE TYPE "public"."fact_basis" AS ENUM('verified', 'client_statement', 'staff_assessment');--> statement-breakpoint
CREATE TYPE "public"."matter_date_kind" AS ENUM('deadline', 'expiry', 'submission', 'other');--> statement-breakpoint
CREATE TYPE "public"."matter_person_role" AS ENUM('main_applicant', 'spouse_partner', 'dependant_child', 'dependant_other', 'sponsor', 'employer_contact');--> statement-breakpoint
CREATE TYPE "public"."matter_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."matter_stage_category" AS ENUM('opening', 'active', 'submitted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."note_visibility" AS ENUM('internal', 'client_visible');--> statement-breakpoint
CREATE TYPE "public"."task_assign_rule" AS ENUM('case_manager', 'consultant', 'unassigned');--> statement-breakpoint
CREATE TYPE "public"."task_recurrence" AS ENUM('none', 'daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'matter';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'task';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'fact';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'date';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'event';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'people';--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_id" uuid,
	"kind" "event_kind" DEFAULT 'appointment' NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"time_zone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"location" text,
	"notes" text,
	"matter_id" uuid,
	"client_id" uuid,
	"lead_id" uuid,
	"organiser_id" uuid,
	"external_source" text,
	"external_id" text,
	"cancelled_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"offset_days" integer NOT NULL,
	"business_days" boolean DEFAULT false NOT NULL,
	"from_label" text NOT NULL,
	"source" text NOT NULL,
	"validated_by_id" uuid,
	"validated_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"person_id" uuid,
	"kind" "matter_date_kind" NOT NULL,
	"label" text NOT NULL,
	"due_on" date NOT NULL,
	"basis_kind" date_basis_kind NOT NULL,
	"basis" text NOT NULL,
	"rule_id" uuid,
	"from_date" date,
	"calculated_on" date,
	"adjustment_reason" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"person_id" uuid,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"basis" "fact_basis" NOT NULL,
	"evidence" text,
	"recorded_by_id" uuid,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_members" (
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_members_matter_id_user_id_pk" PRIMARY KEY("matter_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "matter_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"role" "matter_person_role" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"date_of_birth" date,
	"nationality" text,
	"immigration_status" text,
	"status_expires_on" date,
	"passport_expires_on" date,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"service_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"category" "matter_stage_category" DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"service_id" uuid,
	"legal_category" text,
	"jurisdiction" text,
	"stage_id" uuid NOT NULL,
	"case_manager_id" uuid,
	"consultant_id" uuid,
	"restricted" boolean DEFAULT false NOT NULL,
	"proposal_id" uuid,
	"risk" "matter_risk" DEFAULT 'low' NOT NULL,
	"risk_note" text,
	"submission_reference" text,
	"submission_channel" text,
	"submitted_on" date,
	"outcome" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"visibility" "note_visibility" NOT NULL,
	"edited_by_id" uuid,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"matter_id" uuid,
	"client_id" uuid,
	"lead_id" uuid,
	"visibility" "note_visibility" DEFAULT 'internal' NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"service_id" uuid,
	"stage_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"priority" "lead_priority" DEFAULT 'normal' NOT NULL,
	"due_offset_days" integer,
	"assign_to" "task_assign_rule" DEFAULT 'case_manager' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"priority" "lead_priority" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"all_day" boolean DEFAULT true NOT NULL,
	"reminder_at" timestamp with time zone,
	"recurrence" "task_recurrence" DEFAULT 'none' NOT NULL,
	"recurrence_interval" integer DEFAULT 1 NOT NULL,
	"assignee_id" uuid,
	"matter_id" uuid,
	"client_id" uuid,
	"lead_id" uuid,
	"template_id" uuid,
	"previous_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "matter_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organiser_id_users_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_rules" ADD CONSTRAINT "deadline_rules_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_rules" ADD CONSTRAINT "deadline_rules_validated_by_id_users_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_rules" ADD CONSTRAINT "deadline_rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_dates" ADD CONSTRAINT "matter_dates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_dates" ADD CONSTRAINT "matter_dates_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_dates" ADD CONSTRAINT "matter_dates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_members" ADD CONSTRAINT "matter_members_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_members" ADD CONSTRAINT "matter_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_members" ADD CONSTRAINT "matter_members_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_people" ADD CONSTRAINT "matter_people_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_stages" ADD CONSTRAINT "matter_stages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_case_manager_id_users_id_fk" FOREIGN KEY ("case_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_firm_start_idx" ON "calendar_events" USING btree ("firm_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_matter_idx" ON "calendar_events" USING btree ("matter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_external_uq" ON "calendar_events" USING btree ("org_id","external_source","external_id");--> statement-breakpoint
CREATE INDEX "deadline_rules_firm_idx" ON "deadline_rules" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "matter_dates_firm_due_idx" ON "matter_dates" USING btree ("firm_id","due_on");--> statement-breakpoint
CREATE INDEX "matter_dates_matter_idx" ON "matter_dates" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "matter_facts_matter_idx" ON "matter_facts" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "matter_people_matter_idx" ON "matter_people" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "matter_stages_firm_idx" ON "matter_stages" USING btree ("firm_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "matters_firm_ref_uq" ON "matters" USING btree ("firm_id","ref");--> statement-breakpoint
CREATE INDEX "matters_firm_client_idx" ON "matters" USING btree ("firm_id","client_id");--> statement-breakpoint
CREATE INDEX "matters_firm_stage_idx" ON "matters" USING btree ("firm_id","stage_id");--> statement-breakpoint
CREATE INDEX "matters_case_manager_idx" ON "matters" USING btree ("firm_id","case_manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_revisions_note_version_uq" ON "note_revisions" USING btree ("note_id","version");--> statement-breakpoint
CREATE INDEX "notes_matter_idx" ON "notes" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "notes_client_idx" ON "notes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "notes_firm_idx" ON "notes" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "task_templates_firm_idx" ON "task_templates" USING btree ("firm_id","stage_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_firm_idx" ON "tasks" USING btree ("firm_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_matter_idx" ON "tasks" USING btree ("matter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_template_once_uq" ON "tasks" USING btree ("matter_id","template_id");--> statement-breakpoint
CREATE INDEX "activities_matter_idx" ON "activities" USING btree ("matter_id","created_at");