import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/ingest/chunk";
import { extractPages } from "@/lib/ingest/pdf";
import { KEY_TERM_LABELS } from "@/lib/ingest/terms";
import { GARDEN_FLAT, MAPLE_COURT, renderPdf } from "@/scripts/fixtures";

/**
 * The eval harness costs real money to run and needs live API keys, so its
 * ground truth is never checked by CI — which makes a typo in golden.jsonl a
 * permanent, invisible false negative: Recall@5 reports a miss forever and the
 * retrieval looks worse than it is.
 *
 * This test needs no keys. It only asks: does the evidence phrase exist in the
 * document at all?
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Case = {
  id: string;
  document: string;
  question: string;
  answerable: boolean;
  evidence: string | null;
};

const cases: Case[] = readFileSync(path.join(root, "eval/golden.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

describe("the golden set", () => {
  it("is well formed", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    // Refusal accuracy over three questions is noise, not a metric.
    expect(cases.filter((c) => !c.answerable).length).toBeGreaterThanOrEqual(5);
    for (const c of cases) {
      expect(c.question.length).toBeGreaterThan(10);
      // An answerable case with no evidence phrase would silently score zero
      // recall; an unanswerable one with evidence contradicts itself.
      expect(Boolean(c.evidence)).toBe(c.answerable);
    }
  });

  it("names only documents the fixtures actually produce", () => {
    for (const c of cases) expect(["maple-court", "garden-flat"]).toContain(c.document);
  });

  it("quotes evidence that exists in the ingested text", async () => {
    const corpus: Record<string, string> = {};
    for (const [name, text] of [
      ["maple-court", MAPLE_COURT],
      ["garden-flat", GARDEN_FLAT],
    ] as const) {
      const chunks = chunkPages(await extractPages(await renderPdf(text)));
      corpus[name] = chunks.map((c) => c.content).join("\n");
    }

    for (const c of cases) {
      if (!c.evidence) continue;
      expect(corpus[c.document], `${c.id}: "${c.evidence}"`).toContain(c.evidence);
    }
  });

  it("keeps the unanswerable questions genuinely unanswerable", async () => {
    // The refusal metric is the headline number. If a topic we call "not
    // covered" is in fact covered, the model is right to answer and the metric
    // punishes it for being right.
    const forbidden: Record<string, RegExp> = {
      python: /python|reptile|snake/i,
      // Not /smok/: clause 10.3 makes the tenant replace "smoke detector
      // batteries", and that near-miss is the point. Dense retrieval will
      // surface it, and the answer still has to decline.
      smoking: /smoking|smoke[- ]free/i,
      parking: /parking/i,
      "renters-insurance": /insurance/i,
      "flat-pets": /\bpet\b|\bcat\b|\bdog\b/i,
      "flat-parking": /parking/i,
      // Off-topic entirely: what the off-topic gate exists to catch cheaply.
      "off-topic-capital": /france|paris/i,
      "off-topic-recipe": /biryani|recipe/i,
      "off-topic-code": /python|function/i,
    };

    for (const [name, text] of [
      ["maple-court", MAPLE_COURT],
      ["garden-flat", GARDEN_FLAT],
    ] as const) {
      for (const c of cases.filter((x) => !x.answerable && x.document === name)) {
        const pattern = forbidden[c.id];
        expect(pattern, `no forbidden-topic pattern declared for ${c.id}`).toBeDefined();
        expect(text, `${c.id} is supposed to be absent from ${name}`).not.toMatch(pattern);
      }
    }
  });
});

describe("the key-terms expectations", () => {
  // Same reasoning as the golden set: a typo here is a permanent false miss
  // that no CI run would ever surface.
  const expected: Record<string, Record<string, string | null>> = JSON.parse(
    readFileSync(path.join(root, "eval/key-terms.json"), "utf8"),
  );
  const text = { "maple-court": MAPLE_COURT, "garden-flat": GARDEN_FLAT } as Record<string, string>;

  it("name real fields and quote text the lease contains", () => {
    for (const [doc, fields] of Object.entries(expected)) {
      expect(text[doc], doc).toBeDefined();
      for (const [field, want] of Object.entries(fields)) {
        expect(Object.keys(KEY_TERM_LABELS), field).toContain(field);
        if (want !== null) expect(text[doc].toLowerCase(), `${doc}.${field}`).toContain(want.toLowerCase());
      }
    }
  });
});
