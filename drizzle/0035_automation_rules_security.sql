-- Automation rules: sensible limits, and every log row says what it is about.

ALTER TABLE reminder_settings ADD CONSTRAINT reminder_settings_overdue_range CHECK (overdue_task_after_days BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE reminder_settings ADD CONSTRAINT reminder_settings_renew_range CHECK (renew_days_before BETWEEN 14 AND 365);--> statement-breakpoint
ALTER TABLE reminder_log DROP CONSTRAINT reminder_log_client_has_matter;--> statement-breakpoint
-- kind::text keeps this valid in the same transaction that added the new enum values.
ALTER TABLE reminder_log ADD CONSTRAINT reminder_log_has_matter CHECK (kind::text = 'staff_digest' OR matter_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE reminder_log ADD CONSTRAINT reminder_log_mail_has_recipient CHECK (kind::text NOT IN ('client_documents', 'staff_digest') OR recipient IS NOT NULL);
