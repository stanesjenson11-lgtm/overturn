import { describe, expect, it } from "vitest";
import { chunkPages, detectHeading } from "@/lib/ingest/chunk";

const page = (number: number, text: string) => ({ number, text });

describe("heading detection", () => {
  it("reads the three clause styles a lease actually uses", () => {
    expect(detectHeading("ARTICLE IV")).toMatchObject({ depth: 1 });
    expect(detectHeading("SECTION 12 — PETS")).toMatchObject({ depth: 1 });
    expect(detectHeading("SECURITY DEPOSIT")).toMatchObject({ depth: 1 });
    expect(detectHeading("8. SECURITY DEPOSIT")).toMatchObject({ depth: 1 });
    expect(detectHeading("8.2 Deductions")).toMatchObject({ depth: 2 });
    expect(detectHeading("12.4.1 Notice")).toMatchObject({ depth: 3 });
  });

  it("does not mistake body prose for a heading", () => {
    expect(detectHeading("Tenant shall pay rent on the first day of each month.")).toBeNull();
    expect(detectHeading("")).toBeNull();
    // A numbered line whose tail is a full sentence is a clause, not a title —
    // it still opens a section, but the label must not swallow the sentence.
    const long = detectHeading("8.2 Landlord may deduct from the deposit any amounts owed.");
    expect(long?.label).toBe("8.2");
  });
});

describe("chunking a lease", () => {
  const lease = [
    page(
      1,
      [
        "RESIDENTIAL LEASE AGREEMENT",
        "",
        "8. SECURITY DEPOSIT",
        "8.1 Tenant shall deposit the sum of $2,400 with Landlord upon execution.",
        "8.2 Landlord may deduct unpaid rent and damage beyond normal wear and tear.",
      ].join("\n"),
    ),
    page(
      2,
      [
        "12. PETS",
        "Tenant may keep up to two cats or dogs under 25 pounds with written consent.",
        "2",
      ].join("\n"),
    ),
  ];

  it("carries heading path and page numbers onto every chunk", () => {
    const chunks = chunkPages(lease);
    expect(chunks.length).toBeGreaterThan(0);

    const deposit = chunks.find((c) => c.content.includes("$2,400"));
    expect(deposit?.headingPath).toContain("8. SECURITY DEPOSIT");
    expect(deposit?.pageStart).toBe(1);

    const pets = chunks.find((c) => c.content.includes("two cats or dogs"));
    expect(pets?.headingPath).toContain("12. PETS");
    // Without this the citation chip would name the wrong page, which is worse
    // than no page at all — it looks authoritative and sends you to a blank.
    expect(pets?.pageStart).toBe(2);
  });

  it("rolls short subclauses up under their parent, not into a neighbour", () => {
    const chunks = chunkPages(lease);
    const deposit = chunks.find((c) => c.content.includes("$2,400"))!;

    // 8.1 and 8.2 are a sentence each. Split apart they'd retrieve on noise;
    // merged into clause 12 they'd be cited under the wrong heading. Under
    // their shared parent is the only answer that is both useful and true.
    expect(deposit.headingPath).toBe("8. SECURITY DEPOSIT");
    expect(deposit.content).toContain("8.1");
    expect(deposit.content).toContain("8.2");
    expect(deposit.content).not.toContain("cats or dogs");
  });

  it("keeps a subclause's own path when both it and its parent stand alone", () => {
    const body = (label: string) =>
      Array.from({ length: 4 }, (_, i) => `${label} sentence ${i} of this subsection is here.`).join(
        " ",
      );

    const chunks = chunkPages([
      page(1, `8. SECURITY DEPOSIT\n${body("Intro")}\n\n8.2 Deductions\n${body("Deduction")}`),
    ]);

    // The parent has a body of its own, so nothing has to be folded upward and
    // the subclause keeps the more precise label — which is what a citation
    // chip should say when it can say it truthfully.
    expect(chunks.find((c) => c.content.includes("Intro sentence 0"))?.headingPath).toBe(
      "8. SECURITY DEPOSIT",
    );
    expect(chunks.find((c) => c.content.includes("Deduction sentence 0"))?.headingPath).toBe(
      "8. SECURITY DEPOSIT > 8.2 Deductions",
    );
  });

  it("drops page-number furniture", () => {
    const chunks = chunkPages(lease);
    expect(chunks.some((c) => /^2$/m.test(c.content))).toBe(false);
  });

  it("packs plain prose with no clause numbering at all", () => {
    // The honest worst case: a lease written as paragraphs. There is no
    // heading path to be had, and the chunker must not produce one chunk per
    // line or one chunk for the whole document.
    const prose = Array.from(
      { length: 40 },
      (_, i) => `The tenant agrees to keep the premises in good repair, item ${i}.`,
    ).join("\n\n");

    const chunks = chunkPages([page(1, prose)]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.headingPath === null)).toBe(true);
    expect(chunks.every((c) => c.content.length <= 2600)).toBe(true);
  });

  it("numbers chunks contiguously from zero", () => {
    const chunks = chunkPages(lease);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("overlaps consecutive chunks so a straddling clause survives", () => {
    const long = Array.from(
      { length: 30 },
      (_, i) => `Paragraph ${i} of a very long clause that keeps going and going and going.`,
    ).join("\n\n");

    const chunks = chunkPages([page(1, `5. LONG CLAUSE\n${long}`)]);
    expect(chunks.length).toBeGreaterThan(1);
    const tailOfFirst = chunks[0].content.slice(-60);
    expect(chunks[1].content.includes(tailOfFirst.trim().slice(0, 30))).toBe(true);
  });
});
