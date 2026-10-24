import "server-only";

/**
 * Text extraction for uploaded files. Images are read with Tesseract (English
 * model bundled with the app, so nothing leaves the server). PDFs with a text
 * layer have that text extracted; scanned PDFs without one are reported as
 * unsupported (upload the pages as images instead). The result is always
 * machine-generated and labelled as such.
 */
export type OcrResult =
  | { status: "done"; text: string; engine: string; confidence: number | null }
  | { status: "not_needed" | "unsupported"; reason: string }
  | { status: "failed"; reason: string };

export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp", "image/tiff", "image/gif"]);

type Ocr = (data: Buffer, contentType: string) => Promise<OcrResult>;
let double: Ocr | null = null;
/** Tests replace the engine; pass null to restore it. */
export function __setOcrTestDouble(fn: Ocr | null) {
  double = fn;
}

export async function extractText(data: Buffer, contentType: string): Promise<OcrResult> {
  if (double) return double(data, contentType);
  try {
    if (IMAGE_TYPES.has(contentType)) return await ocrImage(data);
    if (contentType === "application/pdf") return await pdfText(data);
    return { status: "not_needed", reason: "Not a scan or image." };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : "Text extraction failed." };
  }
}

async function ocrImage(data: Buffer): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const lang = (await import("@tesseract.js-data/eng")).default as { langPath: string; gzip: boolean };
  const worker = await createWorker("eng", 1, { langPath: lang.langPath, gzip: lang.gzip, cachePath: "/tmp/tesseract-cache" });
  try {
    const r = await worker.recognize(data);
    const text = r.data.text.trim();
    if (!text) return { status: "done", text: "", engine: "Tesseract 5 (English)", confidence: 0 };
    return { status: "done", text, engine: "Tesseract 5 (English)", confidence: Math.round(r.data.confidence) };
  } finally {
    await worker.terminate();
  }
}

async function pdfText(data: Buffer): Promise<OcrResult> {
  const { extractText: extract, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extract(pdf, { mergePages: true });
  const clean = String(text).trim();
  if (clean.replace(/\s/g, "").length < 20 * Math.max(1, totalPages)) {
    return { status: "unsupported", reason: "This PDF looks scanned (no text layer). Upload the pages as images to read them." };
  }
  return { status: "done", text: clean.slice(0, 500_000), engine: "PDF text layer", confidence: null };
}
