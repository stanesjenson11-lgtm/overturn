import { denseSearch, keywordSearch } from "../db/queries";
import { embed } from "./embed";
import { rrf } from "./rrf";
import type { Clause } from "./types";

/**
 * Both halves of the hybrid are separate SQL statements against the same table,
 * and both carry `user_id = $1 AND document_id = $2`. There is no path where
 * one is scoped and the other isn't, because there is no third place retrieval
 * can read chunks from.
 *
 * Dense finds the paraphrase — "can I have a snake" against "animals of any
 * kind". Keyword finds the exact term the embedding drifted past — a defined
 * term like "Permitted Occupant" that only means anything inside this lease.
 * Leases need both.
 */
export async function hybridSearch(
  userId: string,
  documentId: string,
  query: string,
  limit = 25,
): Promise<{ clauses: Clause[]; topScore: number }> {
  const [vector] = await embed([query], "RETRIEVAL_QUERY");

  const [dense, keyword] = await Promise.all([
    denseSearch(userId, documentId, vector, limit),
    keywordSearch(userId, documentId, query, limit),
  ]);

  // RRF discards scores by design, so the one absolute signal (how close the
  // nearest clause is at all) is read off the dense list before fusion.
  return { clauses: rrf([dense, keyword], limit), topScore: Number(dense[0]?.score ?? 0) };
}

/**
 * Below this top-1 cosine the question isn't about the lease at all ("what's
 * the capital of France?"), and the pipeline declines without spending the
 * rerank, grade and answer calls on it.
 *
 * Calibrated with `npm run calibrate` on 2026-10-05 (gemini-embedding-001 at
 * 768 dims, the two seeded leases): every golden lease question scored
 * 0.596–0.756 at top-1, answerable or not, with "can I keep a python?" lowest;
 * off-topic questions topped out at 0.503. 0.55 sits mid-gap (0.093). Lease
 * questions the lease doesn't cover stay above it on purpose: declining those
 * well needs the nearby clauses in hand, which only the full pipeline has.
 *
 * ponytail: one global constant from two synthetic leases. Re-run calibrate
 * after changing the embedding model; calibrate per document if real uploads
 * start tripping it.
 */
export const OFF_TOPIC_THRESHOLD = 0.55;
