import { readFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { denseSearch, findUserByEmail, listDocuments } from "@/lib/db/queries";
import { embed } from "@/lib/rag/embed";

/**
 * Calibrates OFF_TOPIC_THRESHOLD (lib/rag/search.ts) against the seeded leases.
 *
 *   ON  = every golden question about the lease, answerable or not. "Can I
 *         keep a python?" must NOT be gated: declining it well is the
 *         pipeline's job, with the pet clause in hand.
 *   OFF = questions that aren't about a lease at all.
 *
 * Prints the top-1 cosine for each and the gap between the groups. If they
 * overlap, no threshold is safe and the gate should be off. Embedding calls
 * only, so it's cheap. Not portable: re-run after changing the embedding model
 * or the corpus.
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

const EMAIL = process.argv[2] ?? "demo@leaselens.app";

const EXTRA_OFF = [
  "What's the weather like in Tokyo tomorrow?",
  "Who won the football world cup in 2022?",
  "Explain how photosynthesis works.",
  "Translate good morning into Spanish.",
  "What is the square root of 144?",
];

type Case = { id: string; document: string; question: string };
const cases: Case[] = readFileSync(path.join(process.cwd(), "eval/golden.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const user = await findUserByEmail(EMAIL);
if (!user) throw new Error(`No seeded account for ${EMAIL}. Run: npm run seed`);
const docs = new Map(
  (await listDocuments(user.id)).map((d) => [d.filename.replace(/\.pdf$/, ""), d.id]),
);

// Off-topic extras are scored against every lease: off-topic is off-topic.
const probes = [
  ...cases.map((c) => ({ ...c, off: c.id.startsWith("off-topic") })),
  ...EXTRA_OFF.flatMap((question, i) =>
    [...docs.keys()].map((document) => ({ id: `extra-${i}`, document, question, off: true })),
  ),
];

const vectors = await embed(
  probes.map((p) => p.question),
  "RETRIEVAL_QUERY",
);

const scored: { off: boolean; score: number; label: string }[] = [];
for (const [i, p] of probes.entries()) {
  const docId = docs.get(p.document);
  if (!docId) throw new Error(`Document ${p.document} is not seeded for ${EMAIL}`);
  const [top] = await denseSearch(user.id, docId, vectors[i], 1);
  scored.push({ off: p.off, score: Number(top?.score ?? 0), label: `${p.document.padEnd(12)} ${p.question}` });
}

for (const s of [...scored].sort((a, b) => b.score - a.score))
  console.log(`${s.off ? "OFF" : "ON "}  ${s.score.toFixed(3)}  ${s.label}`);

const onMin = Math.min(...scored.filter((s) => !s.off).map((s) => s.score));
const offMax = Math.max(...scored.filter((s) => s.off).map((s) => s.score));
console.log(`\nON min top-1 = ${onMin.toFixed(3)}, OFF max top-1 = ${offMax.toFixed(3)}`);
console.log(
  onMin > offMax
    ? `Gap of ${(onMin - offMax).toFixed(3)}. Set OFF_TOPIC_THRESHOLD near ${((onMin + offMax) / 2).toFixed(2)}.`
    : "NO GAP: the groups overlap, so no single threshold separates them. Leave the gate off.",
);
process.exit(0);
