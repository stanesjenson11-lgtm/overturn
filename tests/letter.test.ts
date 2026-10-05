import { describe, expect, it } from "vitest";
import { extractPages } from "@/lib/ingest/pdf";
import { appealLetter, nextSteps, renderPdf, toWinAnsi } from "@/lib/letter";
import type { Citation } from "@/lib/rag/types";

const cite = (id: string, source: Citation["source"], text: string): Citation => ({
  id,
  source,
  document: source === "regulation" ? "IRDAI (Insurance Products) Regulations, 2024" : null,
  chunkId: id,
  heading: source === "regulation" ? "8. Moratorium" : "6. MORATORIUM",
  pageStart: source === "regulation" ? 37 : 2,
  pageEnd: source === "regulation" ? 37 : 2,
  text,
});

const facts = [
  { field: "insurer", label: "Insurer", value: "SHIELD HEALTH INSURANCE LTD", page: 1 },
  { field: "claim_number", label: "Claim no.", value: "SH/CLM/2025/004512", page: 1 },
  { field: "amount_claimed", label: "Claimed", value: "Rs. 2,85,000", page: 1 },
  { field: "reason", label: "Reason given", value: "non-disclosure of a material fact", page: 1 },
];

const letter = appealLetter({
  facts,
  verdict: {
    summary: "The moratorium bars a non-disclosure rejection after 60 months of cover.",
    grounds: [{ point: "Cover had run for 79 months at admission.", cites: ["P4", "R1", "R9"] }],
  },
  citations: [
    cite("P4", "policy", "After 60 continuous months of coverage, no claim shall be contestable."),
    cite("R1", "regulation", "After completion of sixty continuous months of coverage no claim shall be contestable."),
  ],
  today: "2025-11-20",
});

describe("the appeal letter", () => {
  it("states the claim from the rejection letter's own facts", () => {
    expect(letter).toContain("SHIELD HEALTH INSURANCE LTD");
    expect(letter).toContain("Subject: Request to review the rejection of claim SH/CLM/2025/004512");
    expect(letter).toContain('for this reason: "non-disclosure of a material fact"');
    expect(letter).toContain("Date: 20/11/2025");
  });

  it("quotes exactly what each ground cites, and nothing it doesn't", () => {
    expect(letter).toContain('Policy wording, 6. MORATORIUM, p.2: "After 60 continuous months');
    expect(letter).toContain("IRDAI (Insurance Products) Regulations, 2024, 8. Moratorium, p.37:");
    // R9 was never retrieved: no quote, no invented page.
    expect(letter.match(/: "/g)).toHaveLength(3); // two quotes + the reason
  });

  it("leaves what it doesn't know as a visible placeholder, never a guess", () => {
    expect(letter).toContain("Policy number: [policy number]");
    expect(letter).toContain("[Your name]");
  });

  it("names the Ombudsman route under the rule that grants it", () => {
    expect(letter).toMatch(/rule 14\(3\) of the Insurance Ombudsman Rules, 2017/);
  });
});

describe("the next steps", () => {
  it("dates the Ombudsman window from the day the letter goes", () => {
    const steps = nextSteps("2025-11-20");
    expect(steps).toContain("no reply by 20/12/2025");
    expect(steps).toContain("by 20/12/2026 at the latest");
  });
});

describe("rendering", () => {
  it("maps what the standard font can't encode instead of crashing on it", () => {
    expect(toWinAnsi("₹2,85,000 — “approved” ‘as is’ …")).toBe(`Rs. 2,85,000 - "approved" 'as is' ...`);
    expect(toWinAnsi("Insured: राम Kumar")).toBe("Insured:  Kumar");
  });

  it("produces a readable PDF with the next steps on a page of their own", async () => {
    const pages = await extractPages(await renderPdf(`${letter}\nAmount: ₹2,85,000`, [nextSteps("2025-11-20")]));
    expect(pages.at(-1)!.text).toMatch(/^YOUR NEXT STEPS/);
    expect(pages.slice(0, -1).map((p) => p.text).join(" ")).toContain("Rs. 2,85,000");
  });
});
