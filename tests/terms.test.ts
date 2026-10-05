import { beforeAll, describe, expect, it } from "vitest";
import { chunkPages, type Chunk } from "@/lib/ingest/chunk";
import { extractPages } from "@/lib/ingest/pdf";
import { extractKeyTerms, groundTerms } from "@/lib/ingest/terms";
import { renderPdf, SHIELD_POLICY, SHIELD_REJECTION } from "@/scripts/fixtures";

/**
 * The guard runs against real chunks of the synthetic documents, so "the
 * passage it cites" means what it means in production: a 1-based index into
 * chunkPages().
 */
let policy: Chunk[];
let letter: Chunk[];
let waiting: number; // 1-based passage numbers, as the model sees them
let room: number;

const at = (chunks: Chunk[], needle: string) =>
  chunks.findIndex((c) => c.content.includes(needle)) + 1;

beforeAll(async () => {
  policy = chunkPages(await extractPages(await renderPdf(SHIELD_POLICY)));
  letter = chunkPages(await extractPages(await renderPdf(SHIELD_REJECTION)));
  waiting = at(policy, "covered after 36 months");
  room = at(policy, "1% of the Sum Insured");
  expect(waiting).toBeGreaterThan(0);
  expect(room).toBeGreaterThan(0);
});

describe("grounding policy terms", () => {
  it("keeps a term its passage supports, with that passage's page, in display order", () => {
    const terms = groundTerms(
      "policy",
      {
        terms: [
          { field: "ped_waiting", value: "36 months of Continuous Coverage", clause: waiting },
          { field: "room_rent", value: "1% of the Sum Insured per day", clause: room },
        ],
      },
      policy,
    );
    expect(terms.map((t) => t.field)).toEqual(["room_rent", "ped_waiting"]);
    expect(terms[1]).toMatchObject({ label: "Pre-existing diseases wait" });
    expect(terms[1].page).toBe(policy[waiting - 1].pageStart);
  });

  it("drops a right value pinned to the wrong passage", () => {
    expect(
      groundTerms("policy", { terms: [{ field: "room_rent", value: "1% per day", clause: waiting }] }, policy),
    ).toEqual([]);
  });

  it("drops a number the passage never states", () => {
    // The 2024 rules allow up to 36 months; a model "remembering" the old 48
    // must not get it onto the card.
    expect(
      groundTerms("policy", { terms: [{ field: "ped_waiting", value: "48 months", clause: waiting }] }, policy),
    ).toEqual([]);
  });

  it("survives whatever shape comes back", () => {
    const junk = {
      terms: [
        { field: "toString", value: "36 months", clause: waiting }, // inherited key, not a field
        { field: "claim_number", value: "36 months", clause: waiting }, // a letter field, not a policy one
        { field: "ped_waiting", value: "36 months", clause: 999 }, // no such passage
        { field: "ped_waiting", value: "36 months", clause: "3" }, // not an integer
        { field: "ped_waiting", value: "x".repeat(121), clause: waiting }, // runaway value
        null,
        { field: "ped_waiting", value: "36 months", clause: waiting },
        { field: "ped_waiting", value: "after 36 months", clause: waiting }, // duplicate: first wins
      ],
    };
    expect(groundTerms("policy", junk, policy).map((t) => t.value)).toEqual(["36 months"]);
    expect(groundTerms("policy", null, policy)).toEqual([]);
    expect(groundTerms("policy", { terms: "nope" }, policy)).toEqual([]);
  });
});

describe("grounding a rejection letter's facts", () => {
  it("keeps Indian-format amounts and claim numbers the letter states", () => {
    const p = at(letter, "SH/CLM/2025/004512");
    const terms = groundTerms(
      "rejection",
      {
        terms: [
          { field: "claim_number", value: "SH/CLM/2025/004512", clause: p },
          { field: "amount_claimed", value: "Rs. 2,85,000", clause: p },
        ],
      },
      letter,
    );
    expect(terms.map((t) => t.label)).toEqual(["Claim no.", "Claimed"]);
  });

  it("drops a claim number the letter doesn't contain", () => {
    const p = at(letter, "SH/CLM/2025/004512");
    expect(
      groundTerms("rejection", { terms: [{ field: "claim_number", value: "SH/CLM/2025/004513", clause: p }] }, letter),
    ).toEqual([]);
  });
});

describe("a document kind with nothing to extract", () => {
  it("costs no model call", async () => {
    // A medical document is searched, not summarised; no genAI is configured
    // here, so reaching the model would throw.
    expect(await extractKeyTerms("medical", policy)).toEqual({ terms: [], usage: { in: 0, out: 0 } });
  });
});
