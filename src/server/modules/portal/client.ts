import "server-only";
import { randomInt, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { randomToken, sha256 } from "../../auth/crypto";
import { db } from "../../db/client";
import { env } from "../../env";
import { sendEmail } from "../../integrations/email";
import { driveFileName, uploadToDrive } from "../../integrations/google-drive";
import { alertTeam, type AlertTargets } from "./alerts";
import { clientEmail } from "./emails";

/**
 * The client's side of the portal. Nothing here uses an AccessContext: the
 * private link and the emailed code are the keys, and every read or write goes
 * through a portal_* database function that can only touch that one matter.
 */

export const tokenShape = /^[A-Za-z0-9_-]{40,64}$/;
const codeShape = /^\d{6}$/;

export const portalBase = () => env().PORTAL_URL || env().APP_URL;
export const portalLink = (token: string) => `${portalBase()}/portal/${token}`;

/** The code is bound to the link, so a code from one portal is useless on another. */
const codeHash = (token: string, code: string) => sha256(`${sha256(token)}:${code}`);

export type LinkInfo = { firstName: string; firm: string; emailHint: string };

export async function portalLinkInfo(token: string): Promise<LinkInfo | null> {
  if (!tokenShape.test(token)) return null;
  const res = await db().execute<{ v: LinkInfo | null }>(sql`select portal_link_info(${sha256(token)}) as v`);
  return res.rows[0]?.v ?? null;
}

export type CodeRequest = "sent" | "too_many" | "not_found" | "email_failed";

export async function requestSignInCode(token: string): Promise<CodeRequest> {
  if (!tokenShape.test(token)) return "not_found";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const res = await db().execute<{ v: { result: string; email?: string; orgId?: string; firmId?: string; firstName?: string } }>(
    sql`select portal_issue_code(${sha256(token)}, ${codeHash(token, code)}) as v`,
  );
  const v = res.rows[0]?.v;
  if (!v || v.result !== "sent") return (v?.result as CodeRequest) ?? "not_found";
  const mail = clientEmail({
    kicker: "Your sign-in code",
    heading: code.replace(/(\d{3})(\d{3})/, "$1 $2"),
    subline: "Global Immigration Hub client portal",
    greeting: `Dear ${v.firstName ?? "client"},`,
    body: ["Enter this code on the portal page to see your application. It works once and expires in 15 minutes."],
    actionLabel: "Open my portal",
    actionUrl: portalLink(token),
    footer: "If you didn't ask for a code, you can ignore this email. Nobody from our team will ever ask you for it.",
  });
  const sent = await sendEmail({ orgId: v.orgId!, firmId: v.firmId, to: v.email!, subject: `Your portal sign-in code: ${code}`, template: "portal_code", ...mail });
  return sent.status === "failed" ? "email_failed" : "sent";
}

export type VerifyResult = "ok" | "wrong" | "expired" | "locked" | "not_found";

export async function verifySignInCode(token: string, code: string): Promise<{ result: VerifyResult; session?: string }> {
  const c = code.replace(/\s+/g, "");
  if (!tokenShape.test(token) || !codeShape.test(c)) return { result: "wrong" };
  const session = randomToken();
  const res = await db().execute<{ r: VerifyResult }>(sql`select portal_verify_code(${sha256(token)}, ${codeHash(token, c)}, ${sha256(session)}) as r`);
  const result = res.rows[0]?.r ?? "not_found";
  return result === "ok" ? { result, session } : { result };
}

export async function endPortalSession(session: string) {
  if (!tokenShape.test(session)) return;
  await db().execute(sql`select portal_end_session(${sha256(session)})`);
}

export type PortalView = {
  client: { firstName: string; lastName: string | null; email: string; phone: string | null; nationality: string | null; since: string };
  matter: { ref: string; title: string; service: string | null; jurisdiction: string | null; openedAt: string; stageId: string; submittedOn: string | null; submissionChannel: string | null; outcome: string | null; closed: boolean };
  firm: { name: string; slug: string; email: string | null; phone: string | null; website: string | null };
  stages: { id: string; key: string; name: string; category: string }[];
  checklist: { id: string; label: string; group: string | null; status: "needed" | "uploaded" | "accepted" }[];
  messages: { id: string; from: "client" | "staff"; body: string; at: string; name: string }[];
  uploads: { id: string; filename: string; itemId: string | null; at: string }[];
  updatedAt: string;
};

export async function getPortalView(session: string): Promise<PortalView | null> {
  if (!tokenShape.test(session)) return null;
  const res = await db().execute<{ v: PortalView | null }>(sql`select portal_view(${sha256(session)}) as v`);
  return res.rows[0]?.v ?? null;
}

export type ClientWrite = "ok" | "signed_out" | "invalid" | "too_many";

export async function postClientMessage(session: string, body: string): Promise<ClientWrite> {
  if (!tokenShape.test(session)) return "signed_out";
  const res = await db().execute<{ v: { result: ClientWrite } & Partial<AlertTargets> }>(sql`select portal_post_message(${sha256(session)}, ${body}) as v`);
  const v = res.rows[0]?.v;
  if (!v || v.result !== "ok") return v?.result ?? "signed_out";
  await alertTeam(v as AlertTargets, { heading: "New message from a client", lines: ["The client wrote in the portal. Reply from the matter's Client portal panel."], quote: body.trim().slice(0, 1200) });
  return "ok";
}

export const UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/heic": "HEIC image",
  "image/heif": "HEIF image",
  "image/webp": "WebP image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/msword": "Word document",
};
export const MAX_UPLOAD = 15 * 1024 * 1024;

export type UploadResult = ClientWrite | "too_large" | "wrong_type";

export async function uploadClientFile(session: string, input: { itemId: string | null; filename: string; contentType: string; data: Buffer }): Promise<{ result: UploadResult; drive?: string }> {
  if (!tokenShape.test(session)) return { result: "signed_out" };
  if (input.data.length === 0) return { result: "invalid" };
  if (input.data.length > MAX_UPLOAD) return { result: "too_large" };
  if (!UPLOAD_TYPES[input.contentType]) return { result: "wrong_type" };
  const itemId = input.itemId && /^[0-9a-f-]{36}$/i.test(input.itemId) ? input.itemId : null;
  const digest = createHash("sha256").update(input.data).digest("hex");
  const filename = input.filename.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "document";

  const res = await db().execute<{ v: { result: ClientWrite; uploadId?: string; item?: string | null; driveFolderId?: string | null } & Partial<AlertTargets> }>(
    sql`select portal_add_upload(${sha256(session)}, ${itemId}::uuid, ${filename}, ${input.contentType}, ${input.data.length}, ${digest}, ${input.data}) as v`,
  );
  const v = res.rows[0]?.v;
  if (!v || v.result !== "ok") return { result: v?.result ?? "signed_out" };

  let drive = "no_folder";
  if (v.driveFolderId) {
    const up = await uploadToDrive({ folderId: v.driveFolderId, name: driveFileName(filename, v.item ?? null), contentType: input.contentType, data: input.data });
    drive = up.status;
    await db().execute(
      sql`select portal_set_drive_result(${v.uploadId}::uuid, ${up.status}, ${up.status === "uploaded" ? up.fileId : null}, ${up.status === "failed" ? up.error : null})`,
    );
  }
  const where = drive === "uploaded" ? "Saved to the client's Google Drive folder and the matter's files." : drive === "failed" ? "Saved to the matter's files. Google Drive upload failed; see the portal panel." : "Saved to the matter's files.";
  await alertTeam(v as AlertTargets, { heading: "Client uploaded a document", lines: [`${filename}${v.item ? ` for "${v.item}"` : ""}`, where] });
  return { result: "ok", drive };
}
