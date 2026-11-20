# Document checklists and requests

Added 21 Nov 2026.

## Checklists (Settings › Matters › Document checklists)
A checklist belongs to a practice and one **destination country**, and optionally one service from that country. Each line is a document with:
- **Who it's for:** once for the matter, the main applicant, each applicant, the partner, each dependant, or the sponsor.
- **Settings:** required or optional; whether an expiry date is recorded; whether it's shown to the client.
- **Guidance:** optional notes for the client.

**Versions:** draft → published → retired.
- Only a draft can be edited. A published version is locked, including in the database.
- *Start a new version* copies the latest version into a new draft.
- Publishing a version retires the family's previous published version.
- A matter keeps the version it was given, so editing a checklist never changes existing matters.

**Publishing needs:**
- at least one document;
- a source (from the country's source register, or a description);
- the country profile to be verified or operational (Hub › Countries).

## Requests on a matter (matter page › Documents from the client)
- **From a checklist:** apply a published checklist for the matter's destination. It creates one request per document and person, and lists anything that didn't apply, such as a sponsor document when nobody is the sponsor. A checklist for another country can't be applied.
- **One-off:** request one document at a time.

**Statuses:**

| Status | Meaning | Who |
|---|---|---|
| Requested | Asked for | `matters:edit` |
| Received | A file uploaded to this matter is attached | `matters:edit` |
| Under review | Being checked | `matters:edit` |
| Accepted | Checked and confirmed. Needs the expiry date when tracked. Records the reviewer. | `documents:approve` |
| Replacement requested | Rejected with a reason the client can act on | `documents:approve` |
| Waived | Not needed, with a reason | `matters:edit` |

**What the database enforces:**
- Every change is kept in `document_request_events`, which is append-only.
- Requests are never deleted.
- Each status needs its evidence: accepted needs a file and a reviewer; rejected and waived need a note; received and under review need a file.

## Stage gate
In Settings › Matters, tick **Needs documents** on a stage. A matter then can't move into that stage while any required request is not yet accepted or waived. The refusal names what is outstanding.

## My day
Shows client documents on matters you're on:
- overdue requests;
- documents waiting for your review, if you can approve documents;
- accepted documents expiring within 90 days.
