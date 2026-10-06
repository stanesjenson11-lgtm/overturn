import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { chunkPages } from "@/lib/ingest/chunk";
import { extractPages } from "@/lib/ingest/pdf";
import { extractKeyTerms } from "@/lib/ingest/terms";
import { setFallback, type Usage } from "@/lib/llm";
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
 *   - latency and output tokens, and why any read failed.
 *
 *   npm run scan-bench
 */
required("GOOGLE_API_KEY");
process.env.RETRY_429_MAX_S ??= "65";
setFallback(false); // each row has to be the model it names

// Not gemini-3.7-flash: its free tier allows 20 requests a day per project,
// which disqualifies it as the scan reader for a public app before quality is
// even measured (the first run of this benchmark exhausted it). Each model has
// its own daily quota, so these four don't compete.
const MODELS = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemma-4-31b-it", "gemma-4-26b-a4b-it"];
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

type Row = { model: string; cer: number[]; facts: string; secs: number[]; out: number; failed: string[] };
const rows: Row[] = [];

/** Why a read failed, in a word, from the API error transcribePages kept as its cause. */
const reason = (e: unknown) => {
  const cause = (e as { cause?: { status?: number; cause?: { code?: string } } }).cause;
  if (cause?.status === 429) return "quota";
  if (cause?.status && cause.status >= 500) return `server ${cause.status}`;
  if (cause?.cause?.code === "UND_ERR_HEADERS_TIMEOUT") return "no answer in 5 min";
  return (e as Error).message.slice(0, 40);
};

for (const model of MODELS) {
  const row: Row = { model, cer: [], facts: "n/a", secs: [], out: 0, failed: [] };
  for (const d of docs) {
    // Two attempts: one failure on a free tier is weather, two is climate.
    for (let attempt = 1; attempt <= 2; attempt++) {
      let usage: Usage = { in: 0, out: 0 };
      const t = Date.now();
      try {
        const pages = await extractPages(d.scan, (u) => (usage = u), model);
        row.secs.push((Date.now() - t) / 1000);
        row.out += usage.out;
        row.cer.push(cer(d.truth, pages.map((p) => p.text).join("\n")));

        if (d.name === "shield-rejection") {
          const { terms } = await extractKeyTerms("rejection", chunkPages(pages));
          const hits = Object.entries(expectedFacts).filter(([field, want]) =>
            terms.find((x) => x.field === field)?.value.toLowerCase().includes(want.toLowerCase()),
          ).length;
          row.facts = `${hits}/${Object.keys(expectedFacts).length}`;
        }
        console.log(`${model} ${d.name}: CER ${(row.cer.at(-1)! * 100).toFixed(2)}% in ${row.secs.at(-1)}s`);
        break;
      } catch (e) {
        console.error(`${model} ${d.name} (attempt ${attempt}): ${reason(e)}`);
        if (attempt === 2) row.failed.push(`${d.name} (${reason(e)})`);
        else await new Promise((r) => setTimeout(r, 20_000));
      }
    }
  }
  rows.push(row);
}

const pct = (xs: number[]) =>
  xs.length ? `${((xs.reduce((a, b) => a + b, 0) / xs.length) * 100).toFixed(2)}%` : "n/a";

const report = `# Scan benchmark

Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · \`npm run scan-bench\`
${docs.length} synthetic documents rendered as seeded scans; the clean PDF's text layer is the truth.

| Model | Mean CER | Letter facts after | Median per document | Output tokens | Failed |
| --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (r) =>
      `| \`${r.model}\` | ${pct(r.cer)} | ${r.facts} | ${r.secs.length ? `${[...r.secs].sort((a, b) => a - b)[Math.floor(r.secs.length / 2)].toFixed(1)}s` : "n/a"} | ${r.out} | ${r.failed.join(", ") || "none"} |`,
  )
  .join("\n")}
`;

writeFileSync(path.join(process.cwd(), "eval/scan-results.md"), report);
console.log(`\n${report}`);
