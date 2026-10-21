# Administrator Guide

## First day
1. Run `npm run admin:create -- --email … --name "…" --firm-admin-all` once (see deployment guide). Open the link, set a password.
2. Sign in. Group administrators must set up two-step sign-in before anything else. Store the recovery codes safely.
3. Check each firm's **Settings**: legal name, brand colour, contact details, and the three policies.
4. Invite people from **People** (Hub) or a firm's **Team** page. Until email is connected, copy the invitation link shown and send it yourself.

## Everyday Hub work
- **Hub intake** lists enquiries waiting. Open one, check the suggested firm and press **Route enquiry**. Use **Hold for review** when you need more information, **Close** for spam or out-of-scope requests, **Mark duplicate** for repeats.
- Flags explain why something was held: asylum (offer a consultation on other routes), Australia (authorised consultation process), not enough information, possible duplicate.
- **Routing rules** decide the suggestion. Use **Try the rules** to test a sentence before saving a change. Rules are checked top to bottom.

## Firm work
- **Leads**: filter, save views, switch to the board to drag between stages, or the calendar to see follow-ups. Select rows for bulk assignment or stage changes.
- **Convert to client** on a lead creates the client once; pressing it again opens the same client.
- **Consent**: record how a person agreed to be contacted before using their details for anything beyond their enquiry.

## Access
- Group roles (Hub) never show a firm's client records. To work in a firm, a person needs a membership of that firm.
- A Hub super administrator can join a firm only if that firm has switched on "Let Hub super administrators add themselves". It is logged.
- To remove access: remove the person from the firm (Team page) or deactivate their account (People). Both take effect on their next click.
- Nobody can change their own role. A firm always keeps at least one Firm Administrator.

## When something goes wrong
- Someone lost their phone: they use a recovery code; an administrator cannot see or reset their codes. If they have no codes, deactivate and re-invite them (new account), or restore their access through a database operation recorded in the audit log.
- Suspicious activity: open **Audit log**, then **Sign out everywhere** or **Deactivate** for the person concerned.
