# Proposals & Finance

Operational invoicing and payment reconciliation for each practice. **This is not an accounting or trust-accounting system.** The practice's books stay in its accounting package; the reports here are billed, received and outstanding amounts for running the practice.

## Entities and numbering
- Each practice invoices as its own legal entity. Invoices, payments and credit notes carry `firm_id`, are isolated by row-level security, and can't reference another practice's records (composite foreign keys).
- Numbers come from `firm_sequences` (keys `invoice` and `credit_note`) and are assigned only when an invoice is **issued**, so drafts never consume numbers and the sequence has no gaps. Format: `{prefix}-000001`. The prefix is set in Billing settings (default `{practice prefix}-INV`, e.g. `VE-INV`).
- Amounts are integers in minor units, per currency. Currencies are never converted or added together.

## Invoice states
| State | Meaning |
|---|---|
| Draft | Editable. No number. Can be discarded (kept, marked void). |
| Issued | Numbered, dated and locked. A database trigger refuses changes to its lines and amounts. |
| Partly paid | Verified payments cover part of the total. |
| Paid | Verified payments plus credits cover the total. |
| Credited | Credit notes cover the total. |
| Void | Issued in error and unpaid, or a discarded draft. The number stays used. |
| Overdue | Shown (not stored) for issued or partly paid invoices past their due date. |

Corrections after issue are made with **credit notes** (own numbering), never by editing. Nothing in finance can be deleted (DELETE is revoked for the app role).

When an invoice is issued, the practice details printed on it (names, address, registration and tax numbers, bank details, footer) are copied onto the invoice, so later changes to billing settings don't alter it.

## Payments and reconciliation
- **Stripe** (card): "Create payment link" makes a Checkout Session for the balance. The invoice changes only when Stripe's **signed** webhook (`/api/payments/stripe`) confirms payment. Signatures are checked (HMAC-SHA256, 5-minute tolerance), each event is processed once (`payment_events`), and a payment that doesn't match the invoice's current link is held as unallocated for a person to allocate. Full refunds mark the payment refunded and reopen the invoice; partial refunds are flagged for review.
- **Bank transfer, cash, card machine**: recorded by someone with `payments:verify`. They start **awaiting verification** and count towards nothing until a **second person** checks them against the bank statement and records the statement reference. A practice administrator may verify their own entry. Payments can be rejected (kept, marked rejected).
- The Payments page lists everything awaiting verification and verified money not yet allocated.

## Proposals
Proposal states: draft, in review, changes requested, approved, sent, accepted, declined, withdrawn, and **expired** (shown for sent proposals whose client link has passed its validity date; the client can no longer accept). An accepted proposal can be invoiced as deposit then balance, or in full, at the accepted amounts, once the lead has been converted to a client.

## Permissions
| Permission | Consultant | Case manager | Finance officer | Practice admin |
|---|---|---|---|---|
| `invoices:view` | yes | yes | yes | yes |
| `invoices:edit` (drafts) | yes | | yes | yes |
| `invoices:issue` (issue, void, credit, payment links, billing settings) | | | yes | yes |
| `payments:verify` (record, verify, reject, allocate) | | | yes | yes |

## Configuration
- `STRIPE_SECRET_KEY`: use a **test** key (`sk_test_…`) until the practice decides to take live payments. The app says when Stripe is in test mode.
- `STRIPE_WEBHOOK_SECRET`: from the Stripe webhook endpoint pointing at `https://<app>/api/payments/stripe`, listening for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`.
- Tax: whether a practice charges VAT, and at what rate, is the practice's decision. Set it in Billing settings; a tax number is required before a taxed invoice can be issued.

## Reports
Overview per practice and currency: billed in a period (issued invoices by issue date), received (verified payments by date received), outstanding and overdue as of today, and ageing (not yet due, 1–30, 31–60, over 60 days). `/finance` shows the same for every practice the person belongs to, side by side.
