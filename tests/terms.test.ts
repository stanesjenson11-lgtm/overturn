import { beforeAll, describe, expect, it } from "vitest";
import { chunkPages, type Chunk } from "@/lib/ingest/chunk";
import { extractPages } from "@/lib/ingest/pdf";
import { groundTerms } from "@/lib/ingest/terms";
import { MAPLE_COURT, renderPdf } from "@/scripts/fixtures";

/**
 * The guard runs against real chunks of the seeded lease, so "the clause it
 * cites" means what it means in production: a 1-based index into chunkPages().
 */
let chunks: Chunk[];
let rent: number; // 1-based clause numbers, as the model sees them
let deposit: number;

beforeAll(async () => {
  chunks = chunkPages(await extractPages(await renderPdf(MAPLE_COURT)));
  rent = chunks.findIndex((c) => c.content.includes("$1,850")) + 1;
  deposit = chunks.findIndex((c) => c.content.includes("$2,400")) + 1;
  expect(rent).toBeGreaterThan(0);
  expect(deposit).toBeGreaterThan(0);
});

describe("groundTerms", () => {
  it("keeps a term its clause supports, with the clause's page, in display order", () => {
    const terms = groundTerms(
      {
        terms: [
          { field: "deposit", value: "$2,400", clause: deposit },
          { field: "deposit_return", value: "within thirty (30) days", clause: deposit },
          { field: "rent", value: "$1,850 per month", clause: rent },
        ],
      },
      chunks,
    );
    expect(terms.map((t) => t.field)).toEqual(["rent", "deposit", "deposit_return"]);
    expect(terms[0]).toMatchObject({ label: "Rent", value: "$1,850 per month" });
    expect(terms[0].page).toBe(chunks[rent - 1].pageStart);
  });

  it("drops a right amount pinned to the wrong clause", () => {
    expect(groundTerms({ terms: [{ field: "rent", value: "$1,850", clause: deposit }] }, chunks)).toEqual([]);
  });

  it("drops a number the clause never states", () => {
    expect(groundTerms({ terms: [{ field: "rent", value: "$1,950", clause: rent }] }, chunks)).toEqual([]);
  });

  it("drops words the clause doesn't contain, even with no numbers to check", () => {
    const terms = groundTerms(
      { terms: [{ field: "pets", value: "Reptiles welcome without consent", clause: rent }] },
      chunks,
    );
    expect(terms).toEqual([]);
  });

  it("survives whatever shape comes back", () => {
    const junk = {
      terms: [
        { field: "toString", value: "$1,850", clause: rent }, // inherited key, not a field
        { field: "rent", value: "$1,850", clause: 999 }, // no such clause
        { field: "rent", value: "$1,850", clause: "3" }, // not an integer
        { field: "rent", value: "x".repeat(121), clause: rent }, // runaway value
        null,
        { field: "rent", value: "$1,850", clause: rent },
        { field: "rent", value: "$1,850 monthly", clause: rent }, // duplicate: first wins
      ],
    };
    expect(groundTerms(junk, chunks).map((t) => t.value)).toEqual(["$1,850"]);
    expect(groundTerms(null, chunks)).toEqual([]);
    expect(groundTerms({ terms: "nope" }, chunks)).toEqual([]);
  });
});
