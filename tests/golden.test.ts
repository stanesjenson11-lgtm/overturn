import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPages } from "@/lib/ingest/pdf";
import { termFields } from "@/lib/ingest/terms";
import { RULES } from "@/lib/rules";
import {
  rejectionLetter,
  renderPdf,
  SHIELD_POLICY,
  SHIELD_REJECTION,
  type LetterFields,
} from "@/scripts/fixtures";

/**
 * The eval needs live API keys, so CI never runs it — which makes a mistake in
 * its ground truth a permanent, invisible error: a mislabelled case scores the
 * agent wrong forever. This test needs no keys. It checks the cases themselves:
 * well formed, renderable, and, wherever a rule check decides the outcome,
 * labelled the way the rules engine says.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Case = {
  id: string;
  expected: "challengeable" | "valid" | "needs_info";
  letter: LetterFields;
  user: string;
  rule?: { name: keyof typeof RULES; facts: Record<string, unknown>; holds: boolean | null };
};

const cases: Case[] = readFileSync(path.join(root, "eval/cases.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

describe("the eval cases", () => {
  it("are well formed, with enough of each verdict to measure", () => {
    expect(cases.length).toBeGreaterThanOrEqual(16);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    // The false-hope rate is a fraction of the valid rejections: three cases
    // would make it noise, not a number.
    expect(cases.filter((c) => c.expected === "valid").length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.expected === "challengeable").length).toBeGreaterThanOrEqual(5);
    for (const c of cases) {
      expect(["challengeable", "valid", "needs_info"]).toContain(c.expected);
      expect(c.letter.admission, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.letter.date, c.id).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
  });

  it("render to PDFs that read back, so ingest sees what the case means", async () => {
    for (const c of cases) {
      const pages = await extractPages(await renderPdf(rejectionLetter(c.letter)));
      expect(pages.map((p) => p.text).join(" "), c.id).toContain(c.letter.claim);
    }
  });

  it("agree with the rules engine wherever a rule decides them", () => {
    for (const c of cases.filter((x) => x.rule)) {
      const result = (RULES[c.rule!.name] as (f: object) => { holds: boolean | null })(c.rule!.facts);
      expect(result.holds, c.id).toBe(c.rule!.holds);
    }
  });

  it("start with the demo letter, so the demo is a scored case", () => {
    expect(rejectionLetter(cases[0].letter)).toBe(SHIELD_REJECTION);
  });
});

describe("the key-terms expectations", () => {
  // Same reasoning: a typo here is a permanent false miss that no CI run would
  // ever surface.
  const expected: Record<string, Record<string, string | null>> = JSON.parse(
    readFileSync(path.join(root, "eval/key-terms.json"), "utf8"),
  );
  const docs = {
    "shield-policy": { kind: "policy", text: SHIELD_POLICY },
    "shield-rejection": { kind: "rejection", text: SHIELD_REJECTION },
  } as const;

  it("name real fields and quote text the document contains", () => {
    for (const [name, fields] of Object.entries(expected)) {
      const doc = docs[name as keyof typeof docs];
      expect(doc, name).toBeDefined();
      for (const [field, want] of Object.entries(fields)) {
        expect(termFields(doc.kind), field).toContain(field);
        if (want !== null) expect(doc.text.toLowerCase(), `${name}.${field}`).toContain(want.toLowerCase());
      }
    }
  });
});
