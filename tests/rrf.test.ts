import { describe, expect, it } from "vitest";
import { rrf, RRF_K } from "@/lib/rag/rrf";

const c = (id: string) => ({ id });

describe("reciprocal rank fusion", () => {
  it("promotes a document both retrievers agree on", () => {
    // "b" is second in each list and first in neither; agreement should beat a
    // single retriever's confidence, which is the entire point of fusing.
    const dense = [c("a"), c("b"), c("c")];
    const keyword = [c("d"), c("b"), c("e")];

    expect(rrf([dense, keyword], 3).map((x) => x.id)).toEqual(["b", "a", "d"]);
  });

  it("scores by 1/(k + rank), one-indexed", () => {
    const dense = [c("a"), c("b")];
    const only = rrf([dense], 2);
    expect(only.map((x) => x.id)).toEqual(["a", "b"]);
    // A change to RRF_K should be a deliberate act, not a silent drift.
    expect(RRF_K).toBe(60);
  });

  it("respects the limit and de-duplicates across lists", () => {
    const list = [c("a"), c("b"), c("c")];
    expect(rrf([list, list], 2)).toHaveLength(2);
    expect(rrf([list, list], 10)).toHaveLength(3);
  });

  it("survives an empty list from one retriever", () => {
    // A keyword query with no tsvector match returns zero rows. That is normal,
    // not an error, and must not take the dense half down with it.
    expect(rrf([[c("a")], []], 5).map((x) => x.id)).toEqual(["a"]);
    expect(rrf([[], []], 5)).toEqual([]);
  });
});
