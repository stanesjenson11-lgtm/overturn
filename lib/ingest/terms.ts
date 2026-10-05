import { Type, type Schema } from "@google/genai";
import type { Usage } from "../llm";
import { structured } from "../rag/structured";
import type { Chunk } from "./chunk";

/**
 * What to pull out of each kind of document, in display order. A medical
 * document has no set: its job is to be searched, not summarised.
 *
 * Labels are stored alongside each term, so the browser renders them without
 * importing this server-only module.
 */
const TERM_SETS = {
  policy: {
    labels: {
      sum_insured: "Sum insured",
      room_rent: "Room rent limit",
      co_pay: "Co-payment",
      initial_waiting: "Initial wait",
      ped_waiting: "Pre-existing diseases wait",
      specific_waiting: "Specific diseases wait",
      claim_intimation: "Tell the insurer within",
    },
    describe:
      "a health insurance policy wording. Fields: sum_insured = the sum insured or how it is set; room_rent = the room rent limit; co_pay = any co-payment and when it applies; initial_waiting = the initial waiting period; ped_waiting = the waiting period for pre-existing diseases; specific_waiting = the waiting period for specified diseases; claim_intimation = how soon a claim or admission must be reported.",
  },
  rejection: {
    labels: {
      insurer: "Insurer",
      claim_number: "Claim no.",
      policy_number: "Policy no.",
      letter_date: "Letter dated",
      admission_date: "Admitted",
      amount_claimed: "Claimed",
      amount_disallowed: "Disallowed",
      reason: "Reason given",
      clauses_cited: "Clauses cited",
    },
    describe:
      "an insurer's letter rejecting (repudiating) a health insurance claim. Fields: insurer = the insurer's name; claim_number = the claim number; policy_number = the policy number; letter_date = the date of the letter; admission_date = the date of admission; amount_claimed = the amount claimed; amount_disallowed = the amount rejected or not payable; reason = the reason the letter gives, in its own words; clauses_cited = the policy clause numbers the letter relies on.",
  },
} as const;

export type TermKind = keyof typeof TERM_SETS;
export type KeyTerm = { field: string; label: string; value: string; page: number };

const hasTerms = (kind: string): kind is TermKind => Object.hasOwn(TERM_SETS, kind);

// A fixed set of fields is something responseSchema expresses well. It's
// free-form maps it can't, which is where schema-constrained extraction
// quietly drops data.
const schemaFor = (fields: string[]): Schema => ({
  type: Type.OBJECT,
  properties: {
    terms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING, enum: fields },
          value: {
            type: Type.STRING,
            description: "a few words, amounts, dates and numbers copied exactly as written",
          },
          clause: { type: Type.INTEGER, description: "number of the passage it comes from" },
        },
        required: ["field", "value", "clause"],
      },
    },
  },
  required: ["terms"],
});

const systemFor = (describe: string) =>
  `You pull key facts out of ${describe}
Use only the numbered passages given. For each field the document actually states, give its value in a few words, copying amounts, dates and numbers exactly as written, and the number of the passage it comes from. Leave out any field the document does not state. Never infer or use typical values.`;

const numbers = (s: string) =>
  new Set([...s.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])));
const words = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];

/**
 * The model's JSON is well-formed by contract, not true by contract. A term
 * survives only if the passage it cites exists and actually supports it: every
 * number in the value appears in that passage, and so do most of its words. A
 * right-looking amount pinned to the wrong passage is dropped, because a card
 * that cites the wrong page is worse than one with a gap.
 */
export function groundTerms(kind: TermKind, raw: unknown, chunks: Chunk[]): KeyTerm[] {
  const labels: Record<string, string> = TERM_SETS[kind].labels;
  const list = (raw as { terms?: unknown } | null)?.terms;
  const out = new Map<string, KeyTerm>();

  for (const t of Array.isArray(list) ? list : []) {
    const { field, value, clause } = (t ?? {}) as Record<string, unknown>;
    // hasOwn, not `in`: "toString" is in every object.
    if (typeof field !== "string" || !Object.hasOwn(labels, field)) continue;
    if (out.has(field) || typeof value !== "string") continue;
    const v = value.trim();
    if (!v || v.length > 120) continue;

    const chunk = Number.isInteger(clause) ? chunks[(clause as number) - 1] : undefined;
    if (!chunk) continue;

    const have = numbers(chunk.content);
    if (![...numbers(v)].every((n) => have.has(n))) continue;
    const text = chunk.content.toLowerCase();
    const w = words(v);
    if (w.filter((x) => text.includes(x)).length < w.length / 2) continue;

    out.set(field, { field, label: labels[field], value: v, page: chunk.pageStart });
  }
  return Object.keys(labels).flatMap((f) => out.get(f) ?? []);
}

/** One structured call over the whole document; nothing here is allowed to fail an upload. */
export async function extractKeyTerms(
  kind: string,
  chunks: Chunk[],
): Promise<{ terms: KeyTerm[]; usage: Usage }> {
  if (!hasTerms(kind)) return { terms: [], usage: { in: 0, out: 0 } };
  const set = TERM_SETS[kind];
  const listing = chunks
    .map((c, i) => `[${i + 1}] ${c.headingPath ?? "(no heading)"} (p.${c.pageStart})\n${c.content}`)
    .join("\n\n");
  const { parsed, usage } = await structured<unknown>(
    systemFor(set.describe),
    listing,
    schemaFor(Object.keys(set.labels)),
  );
  return { terms: groundTerms(kind, parsed, chunks), usage };
}

/** For the eval's offline check that expectations name real fields. */
export const termFields = (kind: TermKind) => Object.keys(TERM_SETS[kind].labels);
