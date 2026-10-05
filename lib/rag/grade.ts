import type { Usage } from "../llm";
import { renderClauses } from "./prompt";
import { GRADE_SCHEMA, structured, type Grade } from "./structured";
import type { Clause } from "./types";

/**
 * Corrective RAG, bounded at one retry.
 *
 * The failure this catches is retrieval that looks fine — five clauses, all
 * about deposits, none of them the one that governs withholding. Asking a
 * cheap model "is the answer actually in here?" before spending the answer
 * model's tokens is worth the round trip.
 *
 * Bounded because the alternative is a loop that never terminates on a
 * question the lease will never answer, which is precisely the question this
 * product exists to answer well.
 */
export async function grade(
  query: string,
  clauses: Clause[],
): Promise<{ sufficient: boolean; searchFor: string; usage: Usage }> {
  if (!clauses.length) return { sufficient: false, searchFor: query, usage: { in: 0, out: 0 } };

  try {
    const { parsed, usage } = await structured<Grade>(
      "You judge whether a set of lease clauses is sufficient to answer a question. Sufficient includes the case where the clauses clearly establish that the lease is SILENT on the subject — that is a real answer. Insufficient means the retrieval missed something the lease probably contains.",
      `Question: ${query}\n\n${renderClauses(clauses)}`,
      GRADE_SCHEMA,
    );
    // No opinion means proceed. Blocking the answer on a failed grader would
    // trade a possibly-thin answer for no answer at all.
    if (!parsed) return { sufficient: true, searchFor: "", usage };

    return {
      sufficient: parsed.sufficient,
      searchFor: parsed.search_for?.trim() || query,
      usage,
    };
  } catch (e) {
    console.error("grade failed, proceeding without it:", e);
    return { sufficient: true, searchFor: "", usage: { in: 0, out: 0 } };
  }
}
