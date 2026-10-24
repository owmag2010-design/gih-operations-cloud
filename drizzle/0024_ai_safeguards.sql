ALTER TYPE "public"."consent_purpose" ADD VALUE 'ai_assistance';--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "ai_drafting_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "ai_drafting_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "ai_drafting_changed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "matter_facts" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;