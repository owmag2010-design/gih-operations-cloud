import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../../src/server/modules/intake/webhook";

describe("intake webhook signatures", () => {
  const secret = "s".repeat(40);
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const body = '{"firstName":"A"}';

  it("accepts a fresh, correct signature (with or without the sha256= prefix)", () => {
    const sig = signPayload(secret, ts, body);
    expect(verifySignature(secret, { signature: sig, timestamp: ts }, body, now)).toEqual({ ok: true });
    expect(verifySignature(secret, { signature: `sha256=${sig}`, timestamp: ts }, body, now)).toEqual({ ok: true });
  });

  it("rejects tampered bodies, wrong secrets, stale timestamps and missing headers", () => {
    const sig = signPayload(secret, ts, body);
    expect(verifySignature(secret, { signature: sig, timestamp: ts }, body + " ", now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature("x".repeat(40), { signature: sig, timestamp: ts }, body, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature(secret, { signature: sig, timestamp: ts }, body, now + 10 * 60_000)).toMatchObject({ ok: false, reason: "stale" });
    expect(verifySignature(secret, { signature: null, timestamp: ts }, body, now)).toMatchObject({ ok: false, reason: "missing" });
  });
});
