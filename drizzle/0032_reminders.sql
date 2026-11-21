CREATE TYPE "public"."reminder_kind" AS ENUM('client_documents', 'staff_digest');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('claimed', 'sent', 'not_configured', 'failed');--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"matter_id" uuid,
	"user_id" uuid,
	"recipient" "citext" NOT NULL,
	"dedupe_key" text NOT NULL,
	"items" integer NOT NULL,
	"status" "reminder_status" DEFAULT 'claimed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_log_dedupe_uq" UNIQUE("firm_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"client_nudges" boolean DEFAULT false NOT NULL,
	"nudge_every_days" integer DEFAULT 7 NOT NULL,
	"staff_digest" boolean DEFAULT false NOT NULL,
	"deadline_window_days" integer DEFAULT 7 NOT NULL,
	"expiry_window_days" integer DEFAULT 90 NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_log_matter_idx" ON "reminder_log" USING btree ("matter_id","created_at");
