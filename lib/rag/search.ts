import {
  denseSearch,
  keywordSearch,
  regDenseSearch,
  regKeywordSearch,
  type RegClause,
} from "../db/queries";
import { embed } from "./embed";
import { rrf } from "./rrf";
import type { Clause } from "./types";

/**
 * Both halves of the hybrid are separate SQL statements against the same table,
 * and both carry `user_id = $1 AND document_id = ANY($2)`. There is no path
 * where one is scoped and the other isn't, because there is no third place
 * retrieval can read chunks from.
 *
 * Dense finds the paraphrase — "heart condition I already had" against
 * "pre-existing disease". Keyword finds the exact term the embedding drifted
 * past — a defined term like "Reasonable and Customary Charges" that only
 * means anything inside this policy. Policy wordings need both.
 */
export async function hybridSearch(
  userId: string,
  documentIds: string[],
  query: string,
  limit = 25,
): Promise<{ clauses: Clause[]; topScore: number }> {
  const [vector] = await embed([query], "RETRIEVAL_QUERY");

  const [dense, keyword] = await Promise.all([
    denseSearch(userId, documentIds, vector, limit),
    keywordSearch(userId, documentIds, query, limit),
  ]);

  // RRF discards scores by design, so the one absolute signal (how close the
  // nearest clause is at all) is read off the dense list before fusion.
  return { clauses: rrf([dense, keyword], limit), topScore: Number(dense[0]?.score ?? 0) };
}

/**
 * The same hybrid over the public regulations: IRDAI's rules, which a
 * rejection is checked against. A sibling rather than a flag on hybridSearch,
 * because the tenant version's SQL must always carry user_id and this one has
 * none to carry. Keeping them apart keeps that visible.
 */
export async function searchRegulations(
  query: string,
  limit = 25,
): Promise<{ clauses: RegClause[]; topScore: number }> {
  const [vector] = await embed([query], "RETRIEVAL_QUERY");
  const [dense, keyword] = await Promise.all([
    regDenseSearch(vector, limit),
    regKeywordSearch(query, limit),
  ]);
  return { clauses: rrf([dense, keyword], limit), topScore: Number(dense[0]?.score ?? 0) };
}
