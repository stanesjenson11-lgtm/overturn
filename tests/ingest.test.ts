import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { chunkPages } from "@/lib/ingest/chunk";
import { MAX_PHOTOS, MAX_SCANNED_PAGES, extractPages, toPdf } from "@/lib/ingest/pdf";
import { setGenAI } from "@/lib/llm";
import { MAPLE_COURT, renderPdf } from "@/scripts/fixtures";

/**
 * The chunker tests work on strings. This one goes through a real PDF, because
 * everything interesting about page attribution happens in the gap between
 * "text" and "text that came out of a PDF at a particular page".
 */
let pdf: Uint8Array;
beforeAll(async () => {
  pdf = await renderPdf(MAPLE_COURT);
});

describe("what an upload may be", () => {
  /** A photo of a letter, as a phone would send it after the browser shrinks it. */
  const photo = async (type: "image/jpeg" | "image/png") => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(800, 1100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 800, 1100);
    return new Uint8Array(type === "image/jpeg" ? canvas.toBuffer("image/jpeg", 80) : canvas.toBuffer("image/png"));
  };

  it("passes a real PDF through untouched", async () => {
    expect(await toPdf([pdf])).toBe(pdf);
  });

  it("turns a JPEG or PNG photo into a one-page PDF with no text layer", async () => {
    for (const type of ["image/jpeg", "image/png"] as const) {
      const wrapped = await toPdf([await photo(type)]);
      expect(new TextDecoder().decode(wrapped.slice(0, 5))).toBe("%PDF-");
      const doc = await PDFDocument.load(wrapped);
      expect(doc.getPageCount()).toBe(1);
      // Its proportions survive: 800x1100 at A4's width is 595x818.
      expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 818 });
    }
  });

  it("decides by the bytes, not by what the file claims to be", async () => {
    const gif = new TextEncoder().encode("GIF89a and some bytes");
    await expect(toPdf([gif])).rejects.toThrow(/PDF, or photos/);
    // Claims to be a JPEG (right magic bytes), isn't one.
    await expect(toPdf([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 1, 2, 3])])).rejects.toThrow(/couldn't be read/);
  });

  it("joins several photos into one PDF, a page each, in the order given", async () => {
    const pages = [await photo("image/jpeg"), await photo("image/png"), await photo("image/jpeg")];
    const doc = await PDFDocument.load(await toPdf(pages));
    expect(doc.getPageCount()).toBe(3);
  });

  it("refuses a PDF mixed with photos, two PDFs, or too many photos", async () => {
    const jpg = await photo("image/jpeg");
    await expect(toPdf([pdf, jpg])).rejects.toThrow(/one PDF at a time/);
    await expect(toPdf([pdf, pdf])).rejects.toThrow(/one PDF at a time/);
    await expect(toPdf(Array(MAX_PHOTOS + 1).fill(jpg))).rejects.toThrow(/Up to 10 photos/);
  });
});

describe("a real lease PDF, end to end", () => {
  it("extracts pages with text", async () => {
    const pages = await extractPages(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].number).toBe(1);
    expect(pages[0].text).toContain("MAPLE COURT");
  });

  it("chunks it on clause boundaries with usable heading paths", async () => {
    const chunks = chunkPages(await extractPages(pdf));

    const deposit = chunks.find((c) => c.content.includes("$2,400"));
    expect(deposit?.headingPath).toContain("5. SECURITY DEPOSIT");

    const pets = chunks.find((c) => c.content.includes("two (2) cats or dogs"))!;
    expect(pets.headingPath).toBe("8. PETS");
    // Whole clause, subclauses included: asking "can I keep a python?" has to
    // retrieve 8.4 (service animals) alongside 8.1, or the answer is confident
    // and incomplete.
    expect(pets.content).toContain("8.4");

    // And nothing from a neighbouring clause bled in under the PETS heading.
    expect(pets.content).not.toContain("ALTERATIONS");
    expect(pets.content).not.toContain("QUIET ENJOYMENT");
  });

  it("gives every clause its own chunk, correctly labelled", async () => {
    const chunks = chunkPages(await extractPages(pdf));
    const paths = chunks.map((c) => c.headingPath);

    for (const heading of [
      "3. RENT",
      "5. SECURITY DEPOSIT",
      "8. PETS",
      "11. ENTRY BY LANDLORD",
      "13. EARLY TERMINATION",
    ])
      expect(paths).toContain(heading);

    // "…gives notice under / Section 12." is a wrapped sentence, not a heading.
    expect(paths).not.toContain("Section 12.");
  });

  it("produces chunks of a size worth embedding", async () => {
    const chunks = chunkPages(await extractPages(pdf));
    expect(chunks.length).toBeGreaterThan(8);
    // Nothing so small it retrieves on noise, nothing so large it dilutes.
    expect(chunks.every((c) => c.content.length >= 40)).toBe(true);
    expect(chunks.every((c) => c.content.length <= 2400)).toBe(true);
  });

  it("keeps every page reachable, so a citation can name any of them", async () => {
    const pages = await extractPages(pdf);
    const chunks = chunkPages(pages);
    const covered = new Set(chunks.map((c) => c.pageStart));
    for (const page of pages) expect(covered.has(page.number)).toBe(true);
  });
});

describe("a scanned lease — pages with no text layer", () => {
  // Blank pages are what a scan looks like to a text extractor.
  const scan = async (pages: number) => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
    return doc.save();
  };

  let calls = 0;
  const transcriber = (text: string, finishReason = "STOP") =>
    setGenAI({
      models: {
        generateContent: async () => {
          calls++;
          return {
            text,
            candidates: [{ finishReason }],
            usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 300 },
          };
        },
      },
    } as any);

  afterEach(() => {
    setGenAI(undefined);
    calls = 0;
  });

  it("is transcribed by the model, keeping real page numbers, and chunks like any lease", async () => {
    const [first, second] = [MAPLE_COURT.slice(0, 1500), MAPLE_COURT.slice(1500, 3000)];
    // Out of order, one page split across two entries, one out of range:
    // all things the parser has to survive, not trust.
    transcriber(
      JSON.stringify([
        { page: 2, text: second },
        { page: 1, text: first.slice(0, 700) },
        { page: 1, text: first.slice(700) },
        { page: 9, text: "hallucinated page" },
      ]),
    );
    let usage = { in: 0, out: 0 };
    const pages = await extractPages(await scan(2), (u) => (usage = u));

    expect(pages.map((p) => p.number)).toEqual([1, 2]);
    expect(pages[0].text).toContain("MAPLE COURT");
    expect(pages.some((p) => p.text.includes("hallucinated"))).toBe(false);
    expect(usage).toEqual({ in: 900, out: 300 });
    expect(chunkPages(pages).length).toBeGreaterThan(2);
  });

  it("says to split it when the transcript is cut off", async () => {
    transcriber('[{"page": 1, "text": "MAPLE COURT', "MAX_TOKENS");
    await expect(extractPages(await scan(2))).rejects.toThrow(/split/i);
  });

  it("still rejects a scan the model can't read", async () => {
    transcriber(JSON.stringify([{ page: 1, text: "" }, { page: 2, text: "Page 2" }]));
    await expect(extractPages(await scan(2))).rejects.toThrow(/scan/i);
  });

  it("rejects an over-long scan before spending a model call on it", async () => {
    transcriber("[]");
    await expect(extractPages(await scan(MAX_SCANNED_PAGES + 1))).rejects.toThrow(/limited/);
    expect(calls).toBe(0);
  });
});
