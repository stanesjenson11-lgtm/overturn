import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from "pdf-lib";
import { Type, type Schema } from "@google/genai";
import { extractText } from "unpdf";
import { badRequest } from "../http";
import { genAI, SCAN_MODEL, withRetry, type Usage } from "../llm";

export type Page = { number: number; text: string };

// Vercel rejects a body over 4.5 MB before any handler runs, with an opaque
// FUNCTION_PAYLOAD_TOO_LARGE. Capping under it there means the message below is
// the one users actually see.
export const MAX_BYTES = (process.env.VERCEL ? 4 : 8) * 1024 * 1024;
export const MAX_PAGES = 60;
// Three documents a case at most (one per kind), so this is about five cases.
export const MAX_DOCS_PER_USER = 15;

/**
 * A scan is transcribed in one model call, so it has to fit in one response
 * and finish inside the same invocation as everything else. 15 pages is about
 * 12k output tokens and well under a minute.
 * ponytail: page-window the transcription if longer scans ever matter.
 */
export const MAX_SCANNED_PAGES = 15;

/** Below this, the "text layer" is page furniture and nothing else. */
const MIN_CHARS_PER_PAGE = 120;

const SCAN_ERROR =
  "This PDF has no selectable text and the scan couldn't be read. Try a clearer scan.";

/** Photos of one document, taken page by page: one upload, one PDF. Within
 *  MAX_SCANNED_PAGES, since every photo is a page the model transcribes. */
export const MAX_PHOTOS = 10;

/**
 * An upload as a PDF: one PDF passes through, and photos of a letter (JPEG or
 * PNG, one per page) become a PDF with no text layer, which ingest then reads
 * as the scan it effectively is. One pipeline for both, not a second one for
 * images.
 *
 * Decided by magic bytes, never by the filename or the declared type: both
 * are whatever the client says. The browser re-encodes photos to JPEG before
 * upload (iPhone HEIC included), so these two formats are all that arrives.
 * The size cap is on the whole upload, because that's what Vercel caps.
 * ponytail: raise MAX_PAGES only alongside a queue.
 */
export async function toPdf(files: Uint8Array[]): Promise<Uint8Array> {
  if (!files.length) throw badRequest("No file was uploaded.");
  const total = files.reduce((n, f) => n + f.byteLength, 0);
  if (total > MAX_BYTES)
    throw badRequest(`That upload is over ${MAX_BYTES / 1024 / 1024} MB. Try fewer or smaller photos.`);

  const pdf = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5)) === "%PDF-";
  if (files.some(pdf)) {
    if (files.length > 1) throw badRequest("Upload one PDF at a time, or several photos together.");
    await assertSafePdf(files[0]);
    return files[0];
  }
  if (files.length > MAX_PHOTOS)
    throw badRequest(`Up to ${MAX_PHOTOS} photos at a time: one per page of the document.`);

  const doc = await PDFDocument.create();
  for (const bytes of files) {
    const [a, b, c, d] = bytes;
    const jpeg = a === 0xff && b === 0xd8 && c === 0xff;
    const png = a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47;
    if (!jpeg && !png) throw badRequest("Upload a PDF, or photos of the document (JPG or PNG).");

    // embedPng decodes every pixel, so a few-KB PNG declaring 50000×50000
    // would allocate gigabytes. The header says the size before anything is
    // decoded. (embedJpg passes the JPEG through without decoding it.)
    if (png) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (bytes.byteLength < 24 || view.getUint32(16) * view.getUint32(20) > MAX_PIXELS)
        throw badRequest("That image is too large. Try a smaller photo.");
    }

    try {
      const img = jpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      // A4's width at the photo's own proportions, so the scan reader sees
      // pages, as if they had come off a scanner.
      const width = 595;
      const height = Math.round((width * img.height) / img.width);
      doc.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
    } catch {
      throw badRequest("A photo couldn't be read. Try a clearer JPG or PNG.");
    }
  }
  return doc.save();
}

/** About a 7000×5700 photo: far beyond what a page needs to be legible. */
const MAX_PIXELS = 40_000_000;

/** Keys and action types that make a PDF do something rather than show something. */
const ACTIVE_KEYS = new Set(["JS", "JavaScript", "Launch", "EmbeddedFile", "EmbeddedFiles", "EF", "RichMedia", "XFA"]);
const ACTIVE_ACTIONS = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToE"]);

const UNSAFE =
  "This PDF contains scripts or attached files, which Overturn doesn't accept. " +
  "Open it and use Print → Save as PDF, then upload that copy.";

/**
 * Refuses a PDF that carries active content: scripts, launch actions,
 * attached files, form submission, or encryption that hides its insides.
 *
 * Nothing here ever runs a PDF's script: the upload is parsed for text and
 * thrown away, never stored or served back. So this isn't protecting a
 * viewer; it's refusing files that are built to do something, because an
 * insurer's letter has no reason to, and it narrows what reaches the parsers.
 *
 * pdf-lib parses the whole object graph, object streams included, and names
 * come back decoded, so `/J#61vaScript` is still JavaScript. No antivirus
 * service on purpose: that would send people's health documents to a third
 * party.
 */
export async function assertSafePdf(bytes: Uint8Array): Promise<void> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw badRequest("That PDF could not be read. It may be damaged. Try Print → Save as PDF.");
  }
  // Encrypted streams can't be inspected, so they can't be vouched for.
  if (doc.isEncrypted)
    throw badRequest(
      "That PDF is password-protected or encrypted. Open it, use Print → Save as PDF, and upload that copy.",
    );

  const active = (o: PDFObject): boolean => {
    if (o instanceof PDFStream) return active(o.dict);
    if (o instanceof PDFArray) return o.asArray().some(active);
    if (!(o instanceof PDFDict)) return false;
    for (const [k, v] of o.entries()) {
      if (ACTIVE_KEYS.has(k.decodeText())) return true;
      if (k.decodeText() === "S" && v instanceof PDFName && ACTIVE_ACTIONS.has(v.decodeText())) return true;
      // References are skipped here: every indirect object is visited below anyway.
      if (active(v)) return true;
    }
    return false;
  };

  if (doc.context.enumerateIndirectObjects().some(([, o]) => active(o))) throw badRequest(UNSAFE);
}

const tooThin = (pages: Page[]) =>
  pages.reduce((n, p) => n + p.text.trim().length, 0) / Math.max(pages.length, 1) <
  MIN_CHARS_PER_PAGE;

export async function extractPages(
  bytes: Uint8Array,
  onUsage: (u: Usage) => void = () => {},
  scanModel: string = SCAN_MODEL,
): Promise<Page[]> {
  let totalPages: number;
  let text: string[];
  try {
    // A copy, deliberately: pdf.js detaches the ArrayBuffer it is handed, so
    // the caller's `bytes` would be a zero-length view afterwards and any
    // second read of the same upload would fail as "damaged".
    // The bundled pdf.js (unpdf 1.8) has no eval path left at all, so the
    // CVE-2024-4367 class (code compiled from a font program) can't recur.
    ({ totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: false }));
  } catch {
    throw badRequest("That PDF could not be read. It may be encrypted or damaged.");
  }

  if (totalPages > MAX_PAGES)
    throw badRequest(`That document is ${totalPages} pages; the limit is ${MAX_PAGES}.`);

  const pages = text.map((t, i) => ({ number: i + 1, text: t ?? "" }));
  if (!tooThin(pages)) return pages;

  // A scanned lease has pages and no text layer. Gemini reads the PDF itself,
  // so transcribe it rather than embedding empty strings and shipping an index
  // that silently retrieves nothing.
  if (totalPages > MAX_SCANNED_PAGES)
    throw badRequest(
      `That looks like a ${totalPages}-page scan; scans are limited to ${MAX_SCANNED_PAGES} pages. ` +
        "Split it, or upload a PDF with selectable text.",
    );
  const scanned = await transcribePages(bytes, totalPages, onUsage, scanModel);
  if (tooThin(scanned)) throw badRequest(SCAN_ERROR);
  return scanned;
}

const TRANSCRIPT_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      page: { type: Type.INTEGER, description: "1-based page number" },
      text: { type: Type.STRING, description: "every word on the page, verbatim" },
    },
    required: ["page", "text"],
  },
};

const TRANSCRIBE_SYSTEM = `You transcribe scanned documents. Return every word on every page exactly as written, in reading order, one entry per page.
Keep clause numbers, headings and line breaks. Do not summarise, correct, translate or add anything. A blank page gets empty text.`;

/**
 * The model's output is parsed defensively: it is valid JSON by contract, not
 * by guarantee of sense, so anything off-shape or out of range is dropped and
 * the caller's text-density check decides whether what survived is a lease.
 */
async function transcribePages(
  bytes: Uint8Array,
  totalPages: number,
  onUsage: (u: Usage) => void,
  model: string,
): Promise<Page[]> {
  let res;
  try {
    res = await withRetry(() =>
      genAI().models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
              { text: `Transcribe all ${totalPages} pages.` },
            ],
          },
        ],
        config: {
          systemInstruction: TRANSCRIBE_SYSTEM,
          responseMimeType: "application/json",
          responseSchema: TRANSCRIPT_SCHEMA,
          temperature: 0, // repetition loops at default temperature are a known failure on long extractions
          maxOutputTokens: 65536,
        },
      }),
    );
  } catch (e) {
    console.error("transcription failed:", e);
    // The raw API error is a JSON blob; the user reads documents.error.
    throw new Error("Couldn't reach the model to read this scan. Try uploading it again.", { cause: e });
  }

  onUsage({
    in: res.usageMetadata?.promptTokenCount ?? 0,
    out: res.usageMetadata?.candidatesTokenCount ?? 0,
  });

  const finish = res.candidates?.[0]?.finishReason;
  if (finish === "MAX_TOKENS")
    throw badRequest("That scan has more text than fits in one pass. Split it into smaller PDFs.");
  if (finish && finish !== "STOP") throw badRequest(SCAN_ERROR);

  let raw: unknown;
  try {
    raw = JSON.parse(res.text ?? "");
  } catch {
    throw badRequest(SCAN_ERROR);
  }

  const byPage = new Map<number, string>();
  for (const p of Array.isArray(raw) ? raw : []) {
    const { page, text } = (p ?? {}) as { page?: unknown; text?: unknown };
    if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > totalPages) continue;
    if (typeof text !== "string") continue;
    // Merge, not overwrite: a page split across two entries is still one page.
    byPage.set(page as number, [byPage.get(page as number), text].filter(Boolean).join("\n"));
  }
  return Array.from({ length: totalPages }, (_, i) => ({
    number: i + 1,
    text: byPage.get(i + 1) ?? "",
  }));
}
