import type { Usage } from "../llm";
import { SCORES_SCHEMA, structured, type Scores } from "./structured";
import type { Clause } from "./types";

/**
 * RRF ranks by agreement between two retrievers; neither of them has read the
 * question. One Gemini call does, which is what separates "mentions deposits"
 * from "governs whether this deposit can be withheld".
 *
 * Fail-soft on purpose: if the model errors or returns nothing parseable, the
 * RRF order is already a reasonable ranking. A reranker that can take down the
 * answer path is worse than no reranker.
 */
export async function rerank(
  query: string,
  candidates: Clause[],
  keep = 5,
): Promise<{ clauses: Clause[]; usage: Usage; ok: boolean }> {
  if (candidates.length <= keep) return { clauses: candidates, usage: { in: 0, out: 0 }, ok: true };

  const listing = candidates
    .map((c, i) => `[${i + 1}] ${c.heading_path ?? "(no heading)"}\n${c.content.slice(0, 700)}`)
    .join("\n\n");

  try {
    const { parsed, usage } = await structured<Scores>(
      "You score how well each lease clause answers a question. A clause scores high only if it contains language that decides the answer — not merely the same topic. Score every candidate.",
      `Question: ${query}\n\n${listing}`,
      SCORES_SCHEMA,
    );
    if (!parsed) return { clauses: candidates.slice(0, keep), usage, ok: false };

    const ranked = parsed.scores
      .filter((s) => s.index >= 1 && s.index <= candidates.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, keep)
      .map((s) => candidates[s.index - 1]);

    return { clauses: ranked.length ? ranked : candidates.slice(0, keep), usage, ok: true };
  } catch (e) {
    console.error("rerank failed, falling back to RRF order:", e);
    return { clauses: candidates.slice(0, keep), usage: { in: 0, out: 0 }, ok: false };
  }
}
