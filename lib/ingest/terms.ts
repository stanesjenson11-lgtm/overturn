import { Type, type Schema } from "@google/genai";
import type { Usage } from "../llm";
import { structured } from "../rag/structured";
import type { Chunk } from "./chunk";

/** The only fields the model may return, in display order. */
export const KEY_TERM_LABELS = {
  rent: "Rent",
  rent_due: "Due",
  late_fee: "Late fee",
  deposit: "Deposit",
  deposit_return: "Deposit returned",
  term: "Term",
  notice_to_end: "Notice to end",
  pets: "Pets",
  utilities: "You pay",
} as const;

export type KeyTermField = keyof typeof KEY_TERM_LABELS;
// The label is stored alongside so the browser renders it without importing
// this server-only module.
export type KeyTerm = { field: KeyTermField; label: string; value: string; page: number };

const FIELDS = Object.keys(KEY_TERM_LABELS) as KeyTermField[];

// A fixed set of fields is something responseSchema expresses well. It's
// free-form maps it can't, which is where schema-constrained extraction
// quietly drops data.
const KEY_TERMS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    terms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING, enum: FIELDS },
          value: {
            type: Type.STRING,
            description: "a few words, amounts and numbers copied exactly as written",
          },
          clause: { type: Type.INTEGER, description: "number of the clause it comes from" },
        },
        required: ["field", "value", "clause"],
      },
    },
  },
  required: ["terms"],
};

const SYSTEM = `You pull key terms out of a residential lease, using only the numbered clauses given.
Fields: rent = monthly rent; rent_due = when rent is due; late_fee = the late fee and when it applies; deposit = security deposit amount; deposit_return = how long the landlord has to return the deposit; term = length of the lease; notice_to_end = notice needed to end or not renew; pets = what the pet clause allows; utilities = utilities the tenant pays.
For each field the lease actually states, give its value in a few words, copying amounts, dates and numbers exactly as written, and the number of the clause it comes from. Leave out any field the lease does not state. Never infer or use typical values.`;

const numbers = (s: string) =>
  new Set([...s.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])));
const words = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];

/**
 * The model's JSON is well-formed by contract, not true by contract. A term
 * survives only if the clause it cites exists and actually supports it: every
 * number in the value appears in that clause, and so do most of its words. A
 * right-looking amount pinned to the wrong clause is dropped, because a key
 * terms card that cites the wrong page is worse than one with a gap.
 */
export function groundTerms(raw: unknown, chunks: Chunk[]): KeyTerm[] {
  const list = (raw as { terms?: unknown } | null)?.terms;
  const out = new Map<KeyTermField, KeyTerm>();

  for (const t of Array.isArray(list) ? list : []) {
    const { field, value, clause } = (t ?? {}) as Record<string, unknown>;
    // hasOwn, not `in`: "toString" is in every object.
    if (typeof field !== "string" || !Object.hasOwn(KEY_TERM_LABELS, field)) continue;
    const f = field as KeyTermField;
    if (out.has(f) || typeof value !== "string") continue;
    const v = value.trim();
    if (!v || v.length > 120) continue;

    const chunk = Number.isInteger(clause) ? chunks[(clause as number) - 1] : undefined;
    if (!chunk) continue;

    const have = numbers(chunk.content);
    if (![...numbers(v)].every((n) => have.has(n))) continue;
    const text = chunk.content.toLowerCase();
    const w = words(v);
    if (w.filter((x) => text.includes(x)).length < w.length / 2) continue;

    out.set(f, { field: f, label: KEY_TERM_LABELS[f], value: v, page: chunk.pageStart });
  }
  return FIELDS.flatMap((f) => out.get(f) ?? []);
}

/** One structured call over the whole lease; nothing here is allowed to fail an upload. */
export async function extractKeyTerms(chunks: Chunk[]): Promise<{ terms: KeyTerm[]; usage: Usage }> {
  const listing = chunks
    .map((c, i) => `[${i + 1}] ${c.headingPath ?? "(no heading)"} (p.${c.pageStart})\n${c.content}`)
    .join("\n\n");
  const { parsed, usage } = await structured<unknown>(SYSTEM, listing, KEY_TERMS_SCHEMA);
  return { terms: groundTerms(parsed, chunks), usage };
}
