/**
 * Reciprocal Rank Fusion.
 *
 *   score(d) = Σ over lists  1 / (k + rank(d))
 *
 * Fuses ranked lists without needing their scores to be comparable — which
 * matters here because cosine distance and ts_rank_cd are not on the same
 * scale, and normalising them against each other would be a tuning parameter
 * pretending to be a formula.
 *
 * k=60 is the value from the original TREC paper; it damps the top of each list
 * so one confident-but-wrong first result cannot dominate the fusion.
 */
export const RRF_K = 60;

export function rrf<T extends { id: string }>(lists: T[][], limit: number, k = RRF_K): T[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, i) => {
      byId.set(item.id, byId.get(item.id) ?? item);
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + i + 1));
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => byId.get(id)!);
}
