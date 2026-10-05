import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@google/genai";
import { z } from "zod";
import "./env";
import { required } from "./env";
import { reviewCase, type AgentEvent, type Verdict } from "@/lib/agent";
import { hashPassword } from "@/lib/auth/password";
import { applySchema } from "@/lib/db/migrate";
import {
  createCase,
  createDocument,
  createUser,
  findUserByEmail,
  listChunks,
  listDocuments,
  type Doc,
} from "@/lib/db/queries";
import { ingest } from "@/lib/ingest";
import { extractKeyTerms } from "@/lib/ingest/terms";
import { ANSWER_MODEL, genAI, withRetry } from "@/lib/llm";
import type { Citation } from "@/lib/rag/types";
import { rejectionLetter, renderPdf, SHIELD_POLICY, type LetterFields } from "./fixtures";

/**
 * Turns "it seems to work" into numbers: every case in eval/cases.jsonl is a
 * rejection letter reviewed against the same synthetic policy, with the
 * verdict it should reach. The number that matters most is the false-hope
 * rate: a tool that tells people a valid rejection is worth fighting costs
 * them time and money and is worse than no tool.
 *
 * Runs in its own account (eval@overturn.app), so the demo is never touched.
 * Letters are cached by content hash: rerunning only re-runs the agent. The
 * free tier makes a full run take several minutes, not money. Nightly, not
 * per-push.
 *
 *   npm run eval
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

// A chat request can't wait out a per-minute quota window; this script can,
// and a 429 scored as a wrong answer would corrupt every number below.
process.env.RETRY_429_MAX_S ??= "65";
const UPSTREAM_TRIES = 3;
const EMAIL = process.argv[2] ?? "eval@overturn.app";
const REVIEW = "Review this rejection: does the reason the insurer gave hold up?";

type Case = {
  id: string;
  expected: Verdict["verdict"];
  letter: LetterFields;
  user: string;
};

const cases: Case[] = readFileSync(path.join(process.cwd(), "eval/cases.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

// ------------------------------------------------------------------ setup

await applySchema();
const user =
  (await findUserByEmail(EMAIL)) ??
  (await createUser(EMAIL, await hashPassword(createHash("sha256").update(EMAIL).digest("hex"))));

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** Ingests once per content: an unchanged letter is reused, an edited one re-read. */
async function ensure(kind: "policy" | "rejection", name: string, text: string): Promise<Doc> {
  const filename = `${name}-${hash(text)}.pdf`;
  const existing = (await listDocuments(user.id)).find((d) => d.filename === filename && d.status === "ready");
  if (existing) return existing;
  const holder = await createCase(user.id, `eval: ${name}`);
  const doc = await createDocument(user.id, holder.id, kind, filename);
  await ingest(user.id, doc.id, kind, await renderPdf(text));
  return (await listDocuments(user.id)).find((d) => d.id === doc.id)!;
}

const policy = await ensure("policy", "shield-policy", SHIELD_POLICY);

// ------------------------------------------------------------------ judge

const Judgement = z.object({ grounded: z.boolean(), reason: z.string() });

async function judge(answer: string, citations: Citation[]) {
  const passages = citations
    .map((c) => `[${c.id}] ${c.document ?? "policyholder's documents"}, ${c.heading ?? "clause"}:\n${c.text}`)
    .join("\n\n");
  const res = await withRetry(() =>
    genAI().models.generateContent({
      model: ANSWER_MODEL,
      contents: `Passages:\n${passages}\n\nAnswer:\n${answer}`,
      config: {
        systemInstruction:
          "You audit an answer about a rejected health insurance claim against the passages it cites. Grounded means every factual claim is supported by the text of a passage it cites, or by facts the policyholder stated (dates, what they declared). An answer that adds general knowledge about insurance or law, however true, is NOT grounded.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            grounded: { type: Type.BOOLEAN },
            reason: { type: Type.STRING, description: "one sentence" },
          },
          required: ["grounded", "reason"],
        },
      },
    }),
  );
  return Judgement.parse(JSON.parse(res.text ?? "")).grounded;
}

// ------------------------------------------------------------------ run

type Result = Case & {
  got: Verdict["verdict"] | "asked" | "none";
  content: string;
  citations: Citation[];
  citesValid: boolean;
  citesRegulation: boolean;
  grounded: boolean | null;
  steps: number;
  ms: number;
};

const results: Result[] = [];
// An outage scored as a wrong answer is a fake number. Any call that never
// reached the model voids the run, and the last good results.md stays.
let unreached = 0;

for (const c of cases) {
  const letter = await ensure("rejection", c.id, rejectionLetter(c.letter));
  const started = Date.now();
  let done: Extract<AgentEvent, { type: "done" }> | undefined;

  for (let attempt = 1; attempt <= UPSTREAM_TRIES && !done; attempt++) {
    for await (const event of reviewCase({
      userId: user.id,
      documentIds: [policy.id, letter.id],
      question: c.user ? `${REVIEW} ${c.user}` : REVIEW,
      history: [],
      facts: { letter: letter.key_terms ?? [], policy: policy.key_terms ?? [] },
    }))
      if (event.type === "done") done = event;
    if (!done && attempt < UPSTREAM_TRIES) {
      console.log(`  upstream error on ${c.id}, retrying in 30s`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  if (!done) {
    unreached++;
    console.error(`  ${c.id}: never reached the model`);
    continue;
  }

  const ids = new Set(done.citations.map((x) => x.id));
  const written = [...done.content.matchAll(/\[([PR]\d+)\]/g)].map((m) => m[1]);
  const got = done.verdict?.verdict ?? (done.questionnaire ? "asked" : "none");

  const result: Result = {
    ...c,
    got,
    content: done.content,
    citations: done.citations,
    // Every [P3]/[R2] in the prose opens onto a passage, and a decided
    // verdict cites something at all.
    citesValid: written.every((id) => ids.has(id)) && (!done.verdict || written.length > 0),
    citesRegulation: done.citations.some((x) => x.source === "regulation"),
    grounded: null,
    steps: done.spans.length,
    ms: Date.now() - started,
  };
  result.grounded = await judge(done.content, done.citations).catch((e) => {
    console.error(`  judge unreachable for ${c.id}:`, (e as Error).message.slice(0, 120));
    unreached++;
    return null;
  });
  results.push(result);

  const ok = got === c.expected || (c.expected === "needs_info" && got === "asked");
  console.log(`${ok ? "." : "X"} ${c.id}: expected ${c.expected}, got ${got}`);
}

if (unreached) {
  console.error(`\n${unreached} call(s) never reached the model; eval/results.md left untouched.`);
  process.exit(1);
}

// ------------------------------------------------------------------ key terms
// Extracted fresh from stored chunks: this measures the current prompt and
// grounding guard, not whatever was saved at upload time.

const expectedTerms: Record<string, Record<string, string | null>> = JSON.parse(
  readFileSync(path.join(process.cwd(), "eval/key-terms.json"), "utf8"),
);
const termDocs = {
  "shield-policy": policy,
  "shield-rejection": await ensure("rejection", cases[0].id, rejectionLetter(cases[0].letter)),
};
const termMisses: string[] = [];
let termHits = 0;
let termTotal = 0;
for (const [name, fields] of Object.entries(expectedTerms)) {
  const doc = termDocs[name as keyof typeof termDocs];
  const chunks = await listChunks(user.id, doc.id);
  const { terms } = await extractKeyTerms(doc.kind, chunks);
  for (const [field, want] of Object.entries(fields)) {
    termTotal++;
    const got = terms.find((t) => t.field === field);
    const ok = want === null ? !got : !!got && got.value.toLowerCase().includes(want.toLowerCase());
    if (ok) termHits++;
    else termMisses.push(`- \`${name}.${field}\`: expected ${want === null ? "nothing" : `"${want}"`}, got ${got ? `"${got.value}"` : "nothing"}`);
  }
}

// ------------------------------------------------------------------ report

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const correct = (r: Result) => r.got === r.expected || (r.expected === "needs_info" && r.got === "asked");

const valid = results.filter((r) => r.expected === "valid");
const challengeable = results.filter((r) => r.expected === "challengeable");
const decidedChallengeable = results.filter((r) => r.got === "challengeable");

const rows = [
  ["Verdict accuracy", pct(results.filter(correct).length, results.length), `${results.length} rejection letters`],
  ["False-hope rate", pct(valid.filter((r) => r.got === "challengeable").length, valid.length), `valid rejections called challengeable (of ${valid.length})`],
  ["Missed-rights rate", pct(challengeable.filter((r) => r.got === "valid").length, challengeable.length), `challengeable rejections called valid (of ${challengeable.length})`],
  ["Citation validity", pct(results.filter((r) => r.citesValid).length, results.length), "every [P]/[R] opens onto a passage it was given"],
  ["Cites the regulator", pct(decidedChallengeable.filter((r) => r.citesRegulation).length, decidedChallengeable.length), "challengeable verdicts backed by an IRDAI passage"],
  ["Groundedness", pct(results.filter((r) => r.grounded).length, results.length), `LLM-as-judge, ${ANSWER_MODEL}`],
  ["Key-terms accuracy", pct(termHits, termTotal), `${termTotal} fields from the policy and a letter`],
  ["Median review", `${(median(results.map((r) => r.ms)) / 1000).toFixed(1)}s, ${median(results.map((r) => r.steps))} steps`, "agent wall clock and tool calls"],
];

const report = `# Evaluation

Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · \`npm run eval\`
${results.length} synthetic rejection letters, each reviewed against the same synthetic policy.

| Metric | Score | Notes |
| --- | --- | --- |
${rows.map(([k, v, n]) => `| ${k} | **${v}** | ${n} |`).join("\n")}

## Every case

| Case | Expected | Got | Cites regulator | Grounded |
| --- | --- | --- | --- | --- |
${results
  .map((r) => `| \`${r.id}\` | ${r.expected} | ${correct(r) ? r.got : `**${r.got}**`} | ${r.citesRegulation ? "yes" : "no"} | ${r.grounded ? "yes" : "no"} |`)
  .join("\n")}

## Wrong verdicts, in full

${
  results
    .filter((r) => !correct(r))
    .map((r) => `### \`${r.id}\`: expected ${r.expected}, got ${r.got}\n\n> ${r.content.replace(/\n+/g, "\n> ")}`)
    .join("\n\n") || "_None._"
}

## Key-terms misses

${termMisses.join("\n") || "_None._"}
`;

writeFileSync(path.join(process.cwd(), "eval/results.md"), report);
console.log(`\n${rows.map(([k, v]) => `${k.padEnd(20)} ${v}`).join("\n")}\n\neval/results.md written`);
process.exit(0);
