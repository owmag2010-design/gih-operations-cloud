import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeKey } from "../../src/server/env";

describe("decodeKey", () => {
  const raw = randomBytes(32);
  it("accepts the output of openssl rand -base64 32", () => {
    expect(decodeKey(raw.toString("base64"))?.equals(raw)).toBe(true);
    expect(decodeKey(` ${raw.toString("base64")}\n`)?.equals(raw)).toBe(true);
  });
  it("accepts the output of openssl rand -hex 32", () => {
    expect(decodeKey(raw.toString("hex"))?.equals(raw)).toBe(true);
  });
  it("accepts base64url", () => {
    expect(decodeKey(raw.toString("base64url"))?.equals(raw)).toBe(true);
  });
  it("rejects commands, passwords and short keys", () => {
    for (const bad of ["openssl rand -base64 32", "c8sQtXIOYk4NRL2zc8sQtXIOYk4NRL2z", randomBytes(16).toString("base64"), randomBytes(31).toString("hex"), ""]) {
      expect(decodeKey(bad)).toBeNull();
    }
  });
});
