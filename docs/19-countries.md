# Countries and jurisdictions

Added 21 Nov 2026. Australia, New Zealand and South Africa are native jurisdictions; further countries are added as configuration, not code.

## Three kinds of country, never mixed
| | Where it lives | Example |
|---|---|---|
| Operating country | The office a matter is handled from (`matters.operating_office_id`, `operating_country`), and each practice's `registered_country` | Pretoria Centre, ZA |
| Client's countries | `clients.nationality`, `other_nationalities`, `country_of_residence` | ZW (also GB), lives in ZA |
| Destination | `matters.jurisdiction` and each service's `jurisdiction`; a lead's `destination_country` | AU |

A client can have matters for several destinations; each matter keeps its own country, deadlines and history.

## Country profiles (Hub › Settings › Countries)
Each profile holds currency (AUD, NZD, ZAR, USD, GBP, EUR), date format, phone prefix, time zones, address format and authorities, with a version history (`country_profile_versions`, append-only).

Status: **draft → in review → verified → operational**, or retired.
- *Send for review* needs currency, time zone, address format, at least one authority and one source.
- *Verify* needs `countries:review`. Reviewing your own submission is allowed and shown as "self-reviewed".
- *Make operational* needs a verified holiday calendar and a verified source.
- Editing a verified or operational profile returns it to draft (the form warns first).

**Client-facing gate:** sending a proposal (`releaseProposal`) checks every destination in it (each service's country and the lead's destination). Any country that isn't operational blocks the send with the reason.

## Holiday calendars
National or regional (`business_calendars`, `calendar_holidays`). A deadline rule may name a calendar. Business days then skip its dates, but only once it is verified; a draft calendar stops the rule calculating rather than silently ignoring holidays. Verified dates are locked by a database trigger; correcting them means returning the calendar to draft with a reason.

Starting data (`data/config/countries.json`, all draft, from official pages on 21 Nov 2026): ZA national, NZ national, AU New South Wales, AU Australian Capital Territory, 2026–2027. Notes on each calendar record the judgement calls (Mondayised dates, the August bank holiday, the 2026 ACT Anzac Day declaration).

## Sources
`jurisdiction_sources`: legislation, official fees, requirements, checklists, holidays and guidance, with publisher, version, effective dates, a responsible reviewer and next review date. Editing a verified source returns it to draft; a newer source can supersede an older one.

## Practice-by-country checks
`entity_country_capabilities`: for each practice × country × area (payments, accounting, WhatsApp/SMS, email, e-signature, privacy law, professional regulation, data residency): not assessed, pending, verified, unavailable or not needed. *Verified* needs `countries:review` and evidence (a link or a note of the test transaction). Nothing is assumed from one country or practice to another.

## Permissions
`countries:manage` (edit profiles, calendars, sources, checks) and `countries:review` (verify, make operational, retire): both are Hub (group) permissions held by Group Super Administrators. Any staff member can read country data.

## Adding a country
Hub › Settings › Countries › Add a country. Fill in the profile, add a holiday calendar and at least one source, send for review. No deployment needed.
