import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../src/server/db/client";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../src/server/errors";
import { __setDrafterTestDouble } from "../../src/server/integrations/anthropic";
import { __setOcrTestDouble } from "../../src/server/integrations/ocr";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import { fillMergeFields, gapsIn, mergeFieldsIn, plainText, sanitizeContent } from "../../src/server/modules/documents/content";
import {
  addComment, approveDocument, autosaveDocument, createDocument, draftWithAi, duplicateDocument, exportSource, finaliseDocument, getDocument, getFile, listDocuments, listFiles,
  listTemplates, reopenDocument, requestChanges, saveTemplate, saveVersion, submitForReview, uploadFile,
} from "../../src/server/modules/documents/documents";
import { renderDocumentDocx } from "../../src/server/modules/documents/render";
import { addFact, createMatter } from "../../src/server/modules/matters/matters";
import { firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...texts: string[]) => ({ type: "doc", content: texts.map(para) });

async function setup() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ name: "Vera Admin", firms: { veritas: "firm_admin" } });
  const consultant = await makeUser({ name: "Con Sultant", firms: { veritas: "immigration_consultant" } });
  const reviewer = await makeUser({ name: "Rev Iewer", firms: { veritas: "reviewer" } });
  const caseManager = await makeUser({ name: "Casey Manager", firms: { veritas: "case_manager" } });
  const { lead: l } = await createLead(consultant, veritas, lead({ firstName: "Thandi", lastName: "Mokoena" }));
  const { client } = await convertLead(consultant, veritas, l.id);
  const matter = await createMatter(consultant, veritas, { clientId: client.id, title: "Spouse visa" });
  return { veritas, admin, consultant, reviewer, caseManager, client, matter };
}

describe("document content", () => {
  it("keeps only known nodes, marks and safe links", () => {
    const clean = sanitizeContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi", marks: [{ type: "bold" }, { type: "evil" }] }, { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
        { type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "Title" }] },
      ],
    });
    expect(clean.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Hi", marks: [{ type: "bold" }] }, { type: "text", text: "x" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Title" }] },
    ]);
    expect(() => sanitizeContent({ type: "nope" })).toThrow();
  });

  it("fills merge fields, reports missing ones and finds gaps", () => {
    const d = sanitizeContent(doc("Dear {{client.firstName}},", "Ref {{matter.ref}} [[Write the body]]", "{{client.shoeSize}}"));
    expect(mergeFieldsIn(d)).toEqual({ known: ["client.firstName", "matter.ref"], unknown: ["client.shoeSize"] });
    const { content, missing } = fillMergeFields(d, { "client.firstName": "Thandi" });
    expect(plainText(content)).toContain("Dear Thandi,");
    expect(missing.sort()).toEqual(["client.shoeSize", "matter.ref"]);
    expect(gapsIn(content)).toEqual({ prompts: ["Write the body"], fields: ["matter.ref", "client.shoeSize"] });
  });
});

describe("documents", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    __setDrafterTestDouble(null);
    __setOcrTestDouble(null);
  });

  it("refuses unknown merge fields in templates and keeps every template version", async () => {
    const { veritas, admin, consultant } = await setup();
    const starters = await listTemplates(consultant, veritas);
    expect(starters.map((t) => t.name)).toContain("Consultation report");
    expect(starters.every((t) => t.isStarter)).toBe(true);
    await expect(saveTemplate(consultant, veritas, null, { name: "Mine", kind: "letter" }, doc("x"))).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(saveTemplate(admin, veritas, null, { name: "Bad", kind: "letter" }, doc("{{client.passport}}"))).rejects.toBeInstanceOf(ValidationError);
    const t = await saveTemplate(admin, veritas, null, { name: "Short letter", kind: "letter", letterhead: true }, doc("Dear {{client.firstName}}", "[[Body]]"));
    const t2 = await saveTemplate(admin, veritas, t.id, { name: "Short letter", kind: "letter", letterhead: true }, doc("Dear {{client.fullName}}", "[[Body]]"));
    expect(t2.version).toBe(2);
    const history = await owner.select().from(s.documentTemplateVersions).where(eq(s.documentTemplateVersions.templateId, t.id));
    expect(history.map((h) => h.version).sort()).toEqual([1, 2]);
  });

  it("drafts from a template, autosaves, reviews by a second person, and makes a final that can't be overwritten", async () => {
    const { veritas, consultant, reviewer, client, matter } = await setup();
    const [tpl] = (await listTemplates(consultant, veritas)).filter((t) => t.name === "Client letter");
    const { document: d, missing } = await createDocument(consultant, veritas, { title: "Update on your application", kind: "letter", templateId: tpl.id, matterId: matter.id });
    expect(d.ref).toMatch(/^VE-D-000001$/);
    expect(d.clientId).toBe(client.id);
    expect(plainText(d.content)).toContain("Dear Thandi,");
    expect(plainText(d.content)).toContain(matter.ref);
    expect(missing).toEqual([]);

    const view = await getDocument(consultant, veritas, d.id);
    expect(view.gaps.prompts.length).toBeGreaterThan(0);

    // Autosave, with protection against overwriting someone else's edit.
    const saved = await autosaveDocument(consultant, veritas, d.id, { content: doc("Dear Thandi,", "Your application was lodged."), baseUpdatedAt: d.contentUpdatedAt.toISOString() });
    await expect(autosaveDocument(consultant, veritas, d.id, { content: doc("x"), baseUpdatedAt: "2000-01-01T00:00:00Z" })).resolves.toBeTruthy(); // same editor: no conflict
    const other = await makeUser({ name: "Other Drafter", firms: { veritas: "immigration_consultant" } });
    await expect(autosaveDocument(other, veritas, d.id, { content: doc("theirs"), baseUpdatedAt: saved.savedAt })).rejects.toBeInstanceOf(ConflictError);
    await autosaveDocument(consultant, veritas, d.id, { content: doc("Dear Thandi,", "Your application was lodged. [[Add the lodging date]]") });

    expect(await saveVersion(consultant, veritas, d.id, "First pass")).toBe(1);
    await expect(saveVersion(consultant, veritas, d.id)).rejects.toBeInstanceOf(ConflictError);

    await submitForReview(consultant, veritas, d.id, reviewer.user.id);
    await expect(autosaveDocument(consultant, veritas, d.id, { content: doc("sneaky") })).rejects.toBeInstanceOf(ConflictError);
    // The author can't approve their own work.
    await expect(approveDocument(consultant, veritas, d.id)).rejects.toBeInstanceOf(AccessDeniedError);
    // Gaps block approval.
    await expect(approveDocument(reviewer, veritas, d.id)).rejects.toBeInstanceOf(ValidationError);
    await requestChanges(reviewer, veritas, d.id, "Add the lodging date.");
    await autosaveDocument(consultant, veritas, d.id, { content: doc("Dear Thandi,", "Your application was lodged on 3 October 2026.") });
    await submitForReview(consultant, veritas, d.id, reviewer.user.id);
    await approveDocument(reviewer, veritas, d.id, "Good to go.");
    const final = await finaliseDocument(consultant, veritas, d.id);
    expect(final).toBe(4);

    const after = await getDocument(consultant, veritas, d.id);
    expect(after.document.status).toBe("final");
    expect(after.comments.map((c) => c.kind)).toEqual(["comment", "changes_requested", "comment", "approved"]);
    const src = await exportSource(consultant, veritas, d.id);
    expect(src.storedPdf?.subarray(0, 5).toString()).toBe("%PDF-");

    // Final is final: in the service and in the database.
    await expect(autosaveDocument(consultant, veritas, d.id, { content: doc("changed") })).rejects.toBeInstanceOf(ConflictError);
    await expect(reopenDocument(consultant, veritas, d.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(owner.update(s.documents).set({ content: sanitizeContent(doc("tamper")) }).where(eq(s.documents.id, d.id))).rejects.toThrow();
    await expect(db().execute(sql`update document_versions set title = 'x' where document_id = ${d.id}`)).rejects.toThrow();

    const copy = await duplicateDocument(consultant, veritas, d.id);
    expect(copy.status).toBe("draft");
    expect(plainText(copy.content)).toContain("3 October 2026");

    const docx = await renderDocumentDocx({ ...src.input });
    expect(docx.subarray(0, 2).toString()).toBe("PK");
  });

  it("hides documents on restricted matters and other practices' documents", async () => {
    const { veritas, admin, consultant, caseManager, client } = await setup();
    const secret = await createMatter(admin, veritas, { clientId: client.id, title: "Sensitive", restricted: "on", caseManagerId: caseManager.user.id });
    const { document: d } = await createDocument(caseManager, veritas, { title: "Private memo", kind: "other", matterId: secret.id });
    expect((await listDocuments(caseManager, veritas)).rows.map((r) => r.id)).toContain(d.id);
    expect((await listDocuments(consultant, veritas)).rows.map((r) => r.id)).toContain(d.id); // the client's consultant is on the matter team
    const colleague = await makeUser({ name: "Col League", firms: { veritas: "immigration_consultant" } });
    expect((await listDocuments(colleague, veritas)).rows.map((r) => r.id)).not.toContain(d.id);
    await expect(getDocument(colleague, veritas, d.id)).rejects.toBeInstanceOf(NotFoundError);
    const mimshac = await firmId("mimshac");
    const outsider = await makeUser({ firms: { mimshac: "firm_admin" } });
    await expect(getDocument(outsider, mimshac, d.id)).rejects.toBeInstanceOf(NotFoundError);
    const rows = await db().execute(sql`select count(*)::int as n from documents`);
    expect(Number(rows.rows[0].n)).toBe(0); // no scope set: row-level security shows nothing
  });

  it("keeps uploaded originals unchanged and stores OCR text as machine-generated", async () => {
    const { veritas, consultant, matter } = await setup();
    const png = readFileSync("tests/fixtures/ocr-sample.png");
    const f = await uploadFile(consultant, veritas, { matterId: matter.id, description: "Scan" }, { name: "scan.png", type: "image/png", data: png });
    const stored = await getFile(consultant, veritas, f.id);
    expect(Buffer.compare(stored.data, png)).toBe(0);
    expect(stored.ocrStatus).toBe("done");
    expect(stored.ocrEngine).toMatch(/Tesseract/);
    expect(stored.ocrText).toMatch(/Passport number TEST 12345/);
    expect((await listFiles(consultant, veritas, { matterId: matter.id })).map((x) => x.id)).toEqual([f.id]);
    await expect(db().execute(sql`update document_files set data = '\\x00' where id = ${f.id}`)).rejects.toThrow();
    await expect(uploadFile(consultant, veritas, { matterId: matter.id }, { name: "big.bin", type: "application/octet-stream", data: Buffer.alloc(5 * 1024 * 1024) })).rejects.toBeInstanceOf(ValidationError);

    __setOcrTestDouble(async () => ({ status: "unsupported", reason: "Scanned PDF" }));
    const pdf = await uploadFile(consultant, veritas, { matterId: matter.id }, { name: "scan.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 test") });
    expect((await getFile(consultant, veritas, pdf.id)).ocrStatus).toBe("unsupported");
  });

  it("drafts with AI only from the linked matter's records and flags gaps", async () => {
    const { veritas, consultant, client, matter } = await setup();
    const other = await createMatter(consultant, veritas, { clientId: client.id, title: "Other matter" });
    await addFact(consultant, veritas, matter.id, { label: "Married since", value: "2019", basis: "client_statement" });
    await addFact(consultant, veritas, other.id, { label: "Unrelated secret", value: "do-not-leak", basis: "client_statement" });
    const { document: d } = await createDocument(consultant, veritas, { title: "Consultation report", kind: "consultation_report", matterId: matter.id });
    await expect(draftWithAi(consultant, veritas, d.id, "Draft the consultation report.")).rejects.toBeInstanceOf(ValidationError); // not switched on

    let seen = "";
    __setDrafterTestDouble(async ({ prompt, system }) => {
      seen = `${system}\n${prompt}`;
      return "# Consultation report\n## Background\nThe client says they married in 2019.\n- Marriage certificate: [[GAP: certificate not on file]]";
    });
    await autosaveDocument(consultant, veritas, d.id, { content: doc("My notes") });
    const r = await draftWithAi(consultant, veritas, d.id, "Draft the consultation report from the record.");
    expect(seen).toContain("CLIENT STATEMENT (not verified)] Married since: 2019");
    expect(seen).not.toContain("do-not-leak");
    expect(r.gaps.prompts).toEqual(["GAP: certificate not on file"]);
    const view = await getDocument(consultant, veritas, d.id);
    expect(view.document.aiAssisted).toBe(true);
    expect(view.versions.map((v) => v.note)).toEqual(["Before AI-assisted draft"]);
    expect(view.comments.at(-1)?.body).toMatch(/AI-assisted draft .* Needs professional review/);
    await addComment(consultant, veritas, d.id, "Will check the certificate.");
    const [row] = await owner.select().from(s.documents).where(and(eq(s.documents.id, d.id)));
    expect(row.aiAssisted).toBe(true);
  });
});
