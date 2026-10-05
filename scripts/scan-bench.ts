import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { chunkPages } from "@/lib/ingest/chunk";
import { extractPages } from "@/lib/ingest/pdf";
import { extractKeyTerms } from "@/lib/ingest/terms";
import type { Usage } from "@/lib/llm";
import { cer } from "./cer";
import { GARDEN_FLAT, MAPLE_COURT, renderPdf, renderScan, SHIELD_POLICY, SHIELD_REJECTION } from "./fixtures";

/**
 * Gemma 4 against Gemini on scanned documents, measured rather than assumed.
 *
 * Each document is rendered twice, as a clean PDF (whose text layer is the
 * truth) and as a seeded scan: rasterised, tilted, speckled, JPEG. Every
 * candidate model reads the scan through the production path, extractPages().
 * Scored by:
 *   - character error rate against the truth,
 *   - whether the rejection letter's facts still come out right afterwards,
 *     extracted by the same fixed model, so only the transcription varies,
 *   - latency and output tokens.
 *
 *   npm run scan-bench
 */
required("GOOGLE_API_KEY");
process.env.RETRY_429_MAX_S ??= "65";

const MODELS = ["gemini-3.7-flash", "gemma-4-31b-it", "gemma-4-26b-a4b-it"];
const DOCS = {
  "shield-policy": SHIELD_POLICY,
  "shield-rejection": SHIELD_REJECTION,
  "maple-court": MAPLE_COURT,
  "garden-flat": GARDEN_FLAT,
};

const expectedFacts: Record<string, string> = JSON.parse(
  readFileSync(path.join(process.cwd(), "eval/key-terms.json"), "utf8"),
)["shield-rejection"];

const docs = await Promise.all(
  Object.entries(DOCS).map(async ([name, text], i) => ({
    name,
    truth: (await extractPages(await renderPdf(text))).map((p) => p.text).join("\n"),
    scan: await renderScan(text, i + 1),
  })),
);

type Row = { model: string; cer: number[]; facts: string; ms: number; out: number; failed: string[] };
const rows: Row[] = [];

for (const model of MODELS) {
  const row: Row = { model, cer: [], facts: "n/a", ms: 0, out: 0, failed: [] };
  for (const d of docs) {
    let usage: Usage = { in: 0, out: 0 };
    const t = Date.now();
    try {
      const pages = await extractPages(d.scan, (u) => (usage = u), model);
      row.ms += Date.now() - t;
      row.out += usage.out;
      row.cer.push(cer(d.truth, pages.map((p) => p.text).join("\n")));

      if (d.name === "shield-rejection") {
        const { terms } = await extractKeyTerms("rejection", chunkPages(pages));
        const hits = Object.entries(expectedFacts).filter(([field, want]) =>
          terms.find((x) => x.field === field)?.value.toLowerCase().includes(want.toLowerCase()),
        ).length;
        row.facts = `${hits}/${Object.keys(expectedFacts).length}`;
      }
      console.log(`${model} ${d.name}: CER ${(row.cer.at(-1)! * 100).toFixed(2)}% in ${Date.now() - t}ms`);
    } catch (e) {
      row.failed.push(d.name);
      console.error(`${model} ${d.name}: FAILED ${(e as Error).message.slice(0, 120)}`);
    }
  }
  rows.push(row);
}

const pct = (xs: number[]) =>
  xs.length ? `${((xs.reduce((a, b) => a + b, 0) / xs.length) * 100).toFixed(2)}%` : "n/a";

const report = `# Scan benchmark

Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · \`npm run scan-bench\`
${docs.length} synthetic documents rendered as seeded scans; the clean PDF's text layer is the truth.

| Model | Mean CER | Letter facts after | Total time | Output tokens | Failed |
| --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (r) =>
      `| \`${r.model}\` | ${pct(r.cer)} | ${r.facts} | ${(r.ms / 1000).toFixed(1)}s | ${r.out} | ${r.failed.join(", ") || "none"} |`,
  )
  .join("\n")}
`;

writeFileSync(path.join(process.cwd(), "eval/scan-results.md"), report);
console.log(`\n${report}`);
