import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../../src/server/integrations/resend";
import { parseAddress, parseRecipient, threadReplyAddress } from "../../src/server/modules/email/mail";
import { brandFor, merge, renderEmail, unknownFields } from "../../src/server/modules/email/render";

describe("email rendering", () => {
  const hub = brandFor(null, "https://ops.example");
  it("merges fields and leaves unknown ones visible", () => {
    expect(merge("Hi {{first_name}}, ref {{ reference }} {{nope}}", { first_name: "Thandi", reference: "VE-L-1" })).toBe("Hi Thandi, ref VE-L-1 {{nope}}");
    expect(unknownFields("{{first_name}} {{nope}}")).toEqual(["nope"]);
  });
  it("escapes content and drops unsafe links", () => {
    const { html, text, subject } = renderEmail({
      brand: hub, subject: "Hello {{first_name}}\r\nBcc: x", values: { first_name: "<b>T</b>" },
      blocks: [{ type: "paragraph", text: "<script>alert(1)</script> **bold**" }, { type: "button", label: "Go", url: "javascript:alert(1)" }, { type: "button", label: "Site", url: "https://thegih.com" }],
    });
    expect(subject).toBe("Hello <b>T</b> Bcc: x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("https://thegih.com/");
    expect(html).toContain("gih-logo-horizontal-white.png");
    expect(text).toContain("Site: https://thegih.com");
  });
  it("uses each firm's brand", () => {
    expect(brandFor({ slug: "veritas", tradingName: "Veritas Emigrate", brandColor: "#000" }, "x").accent).toBe("#9e1f63");
    expect(brandFor({ slug: "mimshac", tradingName: "Mimshac Group", brandColor: "#000" }, "x").rule).toBe("#e6a930");
    expect(brandFor({ slug: "nextmove", tradingName: "Nextmove Advisory", brandColor: "#123456" }, "x").accent).toBe("#123456");
  });
});

describe("addresses", () => {
  it("tags reply addresses with the thread and reads them back", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const addr = threadReplyAddress("veritas@in.thegih.com", id);
    expect(addr).toBe("veritas+t0f8fad5bd9cb469fa16570867728950e@in.thegih.com");
    expect(parseRecipient(addr)).toEqual({ base: "veritas@in.thegih.com", threadId: id });
    expect(parseRecipient("Hello@In.TheGIH.com")).toEqual({ base: "hello@in.thegih.com", threadId: null });
    expect(parseAddress('"Thandi N" <Thandi@Example.com>')).toEqual({ email: "thandi@example.com", name: "Thandi N" });
  });
});

describe("Resend webhook signatures", () => {
  const secret = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const sign = (id: string, ts: string, body: string) => "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  it("accepts a valid signature and rejects tampering, replay and missing headers", () => {
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const body = '{"type":"email.received"}';
    const sig = sign("msg_1", ts, body);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,bogus ${sig}` }, secret, now)).toBe(true);
    expect(verifyWebhook(body + " ", { id: "msg_1", timestamp: ts, signature: sig }, secret, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, secret, now + 10 * 60_000)).toBe(false);
    expect(verifyWebhook(body, { id: null, timestamp: ts, signature: sig }, secret, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, "", now)).toBe(false);
  });
});
