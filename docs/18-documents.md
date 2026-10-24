# Documents & Templates

The document workspace for each practice: drafting from branded templates, review and approval, final documents that are never overwritten, uploaded files with OCR, and AI drafting assistance. Code: `src/server/modules/documents`, pages under `/f/{practice}/documents`.

## Document types
Client letter, representation, consultation report, roadmap, engagement document, submission pack, precedent, other. A document belongs to a practice and may be linked to a client and a matter (linking a matter links its client). It is visible to people who can see that matter (or client); documents on restricted matters are also hidden by row-level security.

## Templates
- Each practice has its own templates (Documents & Templates → Document templates; `document_templates:manage`). Every save is kept as a version.
- **Merge fields** such as `{{client.fullName}}`, `{{matter.ref}}`, `{{firm.tradingName}}`, `{{user.name}}`, `{{today}}` are inserted from the editor toolbar. Unknown fields are refused when the template is saved. When a document is created, fields are filled from the linked client and matter; any without a value stay visible as `{{…}}` and are listed.
- Passages the author must write are marked `[[…]]`. Six **starter templates** per practice (client letter, consultation report, roadmap, engagement letter, representation, submission pack index) give structure only, labelled "Starter", and must be adapted before use.

## Editing
Rich-text editor (headings, bold, italic, underline, lists, quotes, links, dividers) with autosave about a second after typing stops. If someone else saved the document since you opened it, your save is refused rather than overwriting their work. Merge fields and `[[…]]` gaps are highlighted, and listed under "Still to complete".

## Review and approval
| Status | What can happen |
|---|---|
| Draft | Edit, save versions, restore an earlier version, draft with AI, send for review |
| In review | Text locked. A reviewer (`documents:approve`) approves or asks for changes; the author can take it back |
| Changes requested | Back with the author, with the reviewer's comment shown |
| Approved | Make final, or edit again (clears the approval) |
| Final | Locked. The PDF made at that moment is stored and served byte for byte. To revise, start a new document from it |

- The reviewer must be someone other than the person who wrote the version, unless they administer the practice.
- A document can't be approved or made final while any `[[…]]` or `{{…}}` remains.
- Versions are saved when you choose Save version, when it is sent for review, and when it is made final. Saved versions, the final document and its PDF are protected in the database (no updates or deletes for the app).
- Comments sit beside the document; requests for changes and approvals are recorded as comments and in the audit log.

## Export
PDF (A4) and Word (.docx), on the practice letterhead (name, legal name, registration number, contact line), with page numbers and the reference and version in the footer. Anything not final is marked DRAFT. Earlier versions can be downloaded as PDF from the version list.

## Uploaded files and OCR
- Upload to a client, matter or document (up to 4 MB). The original is stored unchanged with its SHA-256 and can't be modified by the app.
- Images (PNG, JPEG, WebP, TIFF, BMP, GIF) are read on the server with Tesseract and the bundled English model; nothing is sent elsewhere. PDFs with a text layer have that text extracted. Scanned PDFs without one are marked "upload pages as images".
- Extracted text is labelled machine-generated with the engine and confidence, and shown separately from the original.

## AI drafting assistance
- Off until `ANTHROPIC_API_KEY` is set in the hosting settings (optional `ANTHROPIC_MODEL`). The button says "not set up" until then.
- The draft is built only from the document's linked client and matter records the person may see: client details, matter details, people, facts **with their basis** (verified, client statement, staff assessment) and open key dates. Nothing from other matters, clients or practices is included.
- The model is told not to invent facts or citations and to write `[[GAP: …]]` wherever something is missing or law needs confirming. The current text is saved as a version first; the document is marked "AI-assisted" and must go through review.
- Using it sends those records to Anthropic's API; whether that is acceptable for each practice's clients (POPIA and client consent) is the practice's decision.

## Permissions
| Permission | Consultant | Case manager | Reviewer | Document officer | Practice admin |
|---|---|---|---|---|---|
| `documents:view` | yes | yes | yes | yes | yes |
| `documents:edit` (draft, upload, make final) | yes | yes | | yes | yes |
| `documents:approve` | yes | | yes | | yes |
| `document_templates:manage` | | | | | yes |
