ALTER TYPE "public"."reminder_kind" ADD VALUE 'overdue_task';--> statement-breakpoint
ALTER TYPE "public"."reminder_kind" ADD VALUE 'expiry_renewal';--> statement-breakpoint
ALTER TYPE "public"."reminder_status" ADD VALUE 'done';--> statement-breakpoint
ALTER TABLE "reminder_log" ALTER COLUMN "recipient" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "overdue_tasks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "overdue_task_after_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "renew_before_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "renew_days_before" integer DEFAULT 60 NOT NULL;