import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rejectionLetter, renderPdf, renderScan, SHIELD_POLICY, type LetterFields } from "./fixtures";

/**
 * PDFs for trying Overturn by hand: the synthetic policy wording, rejection
 * letters taken from the eval cases (so each has a known expected verdict),
 * and one letter as an image-only scan. samples/README.md says what to
 * answer when the agent asks.
 *
 *   npm run samples
 */
const LETTERS: [file: string, caseId: string, scan?: boolean][] = [
  ["letter-1-heart-nondisclosure.pdf", "ped-moratorium"],
  ["letter-2-hernia-waiting-period.pdf", "hernia-after-specific"],
  ["letter-3-cataract-waiting-period.pdf", "cataract-inside-specific"],
  ["letter-4-no-reason-given.pdf", "no-clause-cited"],
  ["letter-5-missing-documents.pdf", "missing-documents"],
  ["letter-6-cosmetic-surgery.pdf", "cosmetic"],
  ["letter-7-hidden-instruction.pdf", "injection-spectacles"],
  ["letter-8-heart-nondisclosure-SCANNED.pdf", "ped-moratorium", true],
];

const cases = new Map<string, { letter: LetterFields }>(
  readFileSync(path.join(process.cwd(), "eval/cases.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .map((c) => [c.id, c]),
);

const dir = path.join(process.cwd(), "samples");
mkdirSync(dir, { recursive: true });

writeFileSync(path.join(dir, "shield-health-policy-wording.pdf"), await renderPdf(SHIELD_POLICY));
for (const [file, id, scan] of LETTERS) {
  const text = rejectionLetter(cases.get(id)!.letter);
  writeFileSync(path.join(dir, file), scan ? await renderScan(text, 1) : await renderPdf(text));
}
console.log(`samples/: policy + ${LETTERS.length} letters`);
