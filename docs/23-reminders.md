# Reminders

`src/server/modules/reminders`, the daily job at `/api/cron/reminders`, and each practice's **Settings › Reminders**.

## What is sent
- **Client reminders.** These go to a client by email when all of the following are true:
  - the client has an open portal and was sent its invite;
  - the matter is open;
  - at least one required, client-visible request is still requested, or was sent back for a new copy;
  - one of those requests is due within 3 days, was sent back for a new copy, or has been waiting for the practice's interval (3 to 30 days, default 7).

  A client gets at most one reminder per interval for each matter. The email lists what is still needed and links to the portal. Staff-only, optional and waived requests are never listed.
- **Team digest.** This goes once a day to each active staff member of the practice who is on an open matter (case manager, consultant or added to the team). It lists:
  - deadlines and key dates in the next 1 to 60 days (default 7);
  - client documents that are overdue;
  - documents waiting for review, only for people with "review and approve documents";
  - accepted documents expiring within 14 to 365 days (default 90).

  Restricted matters only appear for their own team. Nobody is sent an empty digest.

## Safeguards
- Both are **off** until a practice administrator (`firm:manage`) switches them on. Each change is written to the audit log.
- Every reminder is first claimed in `reminder_log` with a key for the matter or person and the day. Running the job twice on the same day sends nothing more. Log rows can't be deleted, and their only allowed change is from "claimed" to the outcome.
- The job runs per practice with that practice's row-level security scope.
- Without an email provider (`RESEND_API_KEY`), reminders are logged as "not set up", and the matter page shows that.

## Where staff see it
- Settings › Reminders shows the current settings and how many reminders and digests were sent in the last 7 days.
- On a matter, "Documents from the client" shows whether client reminders are on and when the last one was sent.

Known limitations: L78–L81 in docs/14-known-limitations.md.
