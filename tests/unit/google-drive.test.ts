import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { driveFileName, parseDriveFolderId, resetDriveTokenCache, serviceAccount, signedAssertion, uploadToDrive } from "../../src/server/integrations/google-drive";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const sa = { client_email: "portal@gih-ops.iam.gserviceaccount.com", private_key: key };

describe("google drive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDriveTokenCache();
  });

  it("reads folder links and ids", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt?usp=sharing")).toBe("1AbCdEfGhIjKlMnOpQrSt");
    expect(parseDriveFolderId("https://drive.google.com/drive/u/0/folders/0ABcdEFghIJ-klmn_OP")).toBe("0ABcdEFghIJ-klmn_OP");
    expect(parseDriveFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrSt")).toBe("1AbCdEfGhIjKlMnOpQrSt");
    expect(parseDriveFolderId("1AbCdEfGhIjKlMnOpQrSt")).toBe("1AbCdEfGhIjKlMnOpQrSt");
    expect(parseDriveFolderId("not a folder")).toBeNull();
  });

  it("names files by date and checklist item", () => {
    expect(driveFileName("scan: final/v2.pdf", "Police clearance", new Date("2026-11-02T10:00:00Z"))).toBe("2026-11-02 Police clearance - scan final v2.pdf");
    expect(driveFileName("passport.jpg", null, new Date("2026-11-02T10:00:00Z"))).toBe("2026-11-02 passport.jpg");
  });

  it("parses the key file, including escaped newlines", () => {
    expect(serviceAccount(JSON.stringify({ ...sa, private_key: key.replace(/\n/g, "\\n") }))?.private_key).toBe(key);
    expect(serviceAccount("{}")).toBeNull();
    expect(serviceAccount("not json")).toBeNull();
  });

  it("signs a valid RS256 assertion for the Drive scope", () => {
    const jwt = signedAssertion(sa, 1_800_000_000);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive", iat: 1_800_000_000, exp: 1_800_003_600 });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("uploads into the folder and reports Drive errors plainly", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      if (calls.filter((x) => x.url.includes("upload")).length === 1) return new Response(JSON.stringify({ id: "file123", webViewLink: "https://drive/x" }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "File not found: 1Folder" } }), { status: 404 });
    }));
    const ok = await uploadToDrive({ folderId: "1FolderAbcdefghij", name: "2026-11-02 passport.pdf", contentType: "application/pdf", data: Buffer.from("%PDF") }, sa);
    expect(ok).toEqual({ status: "uploaded", fileId: "file123", webViewLink: "https://drive/x" });
    const upload = calls.find((x) => x.url.includes("upload"))!;
    expect(upload.url).toContain("supportsAllDrives=true");
    expect((upload.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(Buffer.from(upload.init.body as Buffer).toString()).toContain('"parents":["1FolderAbcdefghij"]');

    const bad = await uploadToDrive({ folderId: "1FolderAbcdefghij", name: "x.pdf", contentType: "application/pdf", data: Buffer.from("%PDF") }, sa);
    expect(bad).toMatchObject({ status: "failed" });
    expect((bad as { error: string }).error).toContain("shared with the service account");
  });
});

it("does nothing without a service account", async () => {
  expect(await uploadToDrive({ folderId: "1FolderAbcdefghij", name: "x", contentType: "application/pdf", data: Buffer.from("x") }, null)).toEqual({ status: "not_configured" });
});
