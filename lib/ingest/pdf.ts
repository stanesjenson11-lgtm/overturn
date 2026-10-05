import { Type, type Schema } from "@google/genai";
import { extractText } from "unpdf";
import { badRequest } from "../http";
import { ANSWER_MODEL, genAI, withRetry, type Usage } from "../llm";

export type Page = { number: number; text: string };

// Vercel rejects a body over 4.5 MB before any handler runs, with an opaque
// FUNCTION_PAYLOAD_TOO_LARGE. Capping under it there means the message below is
// the one users actually see.
export const MAX_BYTES = (process.env.VERCEL ? 4 : 8) * 1024 * 1024;
export const MAX_PAGES = 60;
export const MAX_DOCS_PER_USER = 5;

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

/**
 * Everything here runs before a single byte is parsed. The page cap exists
 * because ingestion has to finish inside one Vercel function invocation.
 * ponytail: raise MAX_PAGES only alongside a queue — a bigger cap on the same
 * synchronous path just moves the failure from "rejected" to "timed out".
 */
export function validateUpload(bytes: Uint8Array, filename: string): void {
  if (!/\.pdf$/i.test(filename)) throw badRequest("Only PDF files are accepted.");
  if (bytes.byteLength > MAX_BYTES)
    throw badRequest(`That file is over ${MAX_BYTES / 1024 / 1024} MB.`);
  // Magic bytes, not the extension: the extension is whatever the client says.
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (magic !== "%PDF-") throw badRequest("That file isn't a PDF.");
}

const tooThin = (pages: Page[]) =>
  pages.reduce((n, p) => n + p.text.trim().length, 0) / Math.max(pages.length, 1) <
  MIN_CHARS_PER_PAGE;

export async function extractPages(
  bytes: Uint8Array,
  onUsage: (u: Usage) => void = () => {},
): Promise<Page[]> {
  let totalPages: number;
  let text: string[];
  try {
    // A copy, deliberately: pdf.js detaches the ArrayBuffer it is handed, so
    // the caller's `bytes` would be a zero-length view afterwards and any
    // second read of the same upload would fail as "damaged".
    ({ totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: false }));
  } catch {
    throw badRequest("That PDF could not be read. It may be encrypted or damaged.");
  }

  if (totalPages > MAX_PAGES)
    throw badRequest(`That lease is ${totalPages} pages; the limit is ${MAX_PAGES}.`);

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
  const scanned = await transcribePages(bytes, totalPages, onUsage);
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
  onUsage: (u: Usage) => void = () => {},
): Promise<Page[]> {
  let res;
  try {
    res = await withRetry(() =>
      genAI().models.generateContent({
        model: ANSWER_MODEL,
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
    throw new Error("Couldn't reach the model to read this scan. Try uploading it again.");
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
