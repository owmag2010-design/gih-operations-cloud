# Migration Plan (Airtable, Notion, Pipedrive, spreadsheets)

Migration utilities are scheduled for Release 6, but leads can start flowing in now through the intake webhook. This plan fixes the approach so data moved later is clean.

## Principles
- Source systems are never modified or deleted by the migration.
- Every import goes to staging first, with a reconciliation report a person approves.
- Each imported record keeps its source id (`source_ref`) so imports can be repeated without duplicates.
- Records land in the firm that owns them. Nothing is imported into a firm without that firm's administrator agreeing.

## Sources and mapping (first pass)
| Source | What | Target |
|---|---|---|
| Airtable › Tally Leads, Enquiries | Hub enquiries | `intake_items` (closed or routed) and, where already assigned to a firm, `leads` |
| Airtable › per-firm prospect tables | Firm leads | `leads` with stage mapping per firm |
| Airtable › Services & Fees | Fee schedule | `services` (already seeded from the 20 Oct 2026 schedule) |
| Notion › client pages | Client records and portal notes | `clients` + `activities` (notes); documents wait for Release 4 storage |
| Pipedrive | Deals and persons | `leads` / `clients` |
| Zoho Books | Invoices and payments | Release 6 finance tables |

## Steps
1. Inspect each source and list its fields.
2. Agree the field map and the stage map per firm.
3. Validate (emails, phones, countries; required fields).
4. Detect duplicates within and across sources (email, phone, name + date of birth where present).
5. Import into a staging schema.
6. Produce a reconciliation report: counts by source, firm and stage; rejected rows and why.
7. A firm administrator approves.
8. Import into production in one transaction per firm.
9. Verify counts and relationships against the report.
10. Keep the staging data and a rollback script until the firm signs off.

## Incremental runs
Re-running an import updates records matched by `source_ref` and adds new ones; it never deletes.
