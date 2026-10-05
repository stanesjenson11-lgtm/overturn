import { describe, expect, it } from "vitest";
import {
  addMonths,
  citesPolicyTerms,
  continuity,
  documentsDuty,
  fullMonths,
  initialWaiting,
  moratorium,
  ombudsmanWindow,
  pedWaiting,
  specificWaiting,
} from "@/lib/rules";

describe("calendar months", () => {
  it("completes a month on the same day-of-month, not before", () => {
    expect(fullMonths("2019-03-15", "2024-03-14")).toBe(59);
    expect(fullMonths("2019-03-15", "2024-03-15")).toBe(60);
  });

  it("clamps to the end of a shorter month", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2024-03-31", 12)).toBe("2025-03-31");
  });

  it("refuses anything that isn't an ISO date rather than guessing", () => {
    expect(() => fullMonths("15/03/2019", "2024-03-15")).toThrow(/ISO/);
  });
});

describe("the moratorium", () => {
  it("protects a claim admitted after sixty continuous months", () => {
    const r = moratorium({ coverageStart: "2019-03-01", admissionDate: "2025-10-01" });
    expect(r).toMatchObject({ holds: true, months: 79 });
    expect(r.source).toMatch(/Schedule III §8/);
  });

  it("does not protect one admitted a day short", () => {
    expect(moratorium({ coverageStart: "2019-03-15", admissionDate: "2024-03-14" }).holds).toBe(false);
  });

  it("says the enhanced sum insured has its own clock", () => {
    const r = moratorium({
      coverageStart: "2018-01-01",
      admissionDate: "2025-01-01",
      sumInsuredEnhancedOn: "2023-06-01",
    });
    expect(r.holds).toBe(true);
    expect(r.finding).toMatch(/enhanced part/);
  });

  it("asks for the fact it lacks instead of assuming one", () => {
    expect(moratorium({ admissionDate: "2025-01-01" })).toMatchObject({
      holds: null,
      needs: ["coverageStart"],
    });
  });
});

describe("the pre-existing disease wait", () => {
  it("has run out once the policy's own period has passed", () => {
    const r = pedWaiting({
      coverageStart: "2021-01-01",
      admissionDate: "2024-06-01",
      policyWaitMonths: 36,
      pedDisclosed: true,
    });
    expect(r).toMatchObject({ holds: true, months: 41 });
  });

  it("still applies inside it", () => {
    const r = pedWaiting({
      coverageStart: "2023-01-01",
      admissionDate: "2024-06-01",
      policyWaitMonths: 36,
      pedDisclosed: true,
    });
    expect(r.holds).toBe(false);
  });

  it("flags a policy that states more than the 36-month maximum", () => {
    const r = pedWaiting({
      coverageStart: "2021-01-01",
      admissionDate: "2024-06-01",
      policyWaitMonths: 48,
      pedDisclosed: true,
    });
    // 41 months: inside the policy's 48, past the regulation's 36.
    expect(r.holds).toBe(true);
    expect(r.finding).toMatch(/more than the 36-month maximum/);
  });

  it("hands an undisclosed condition to the moratorium instead", () => {
    const r = pedWaiting({
      coverageStart: "2021-01-01",
      admissionDate: "2024-06-01",
      policyWaitMonths: 36,
      pedDisclosed: false,
    });
    expect(r.holds).toBeNull();
    expect(r.finding).toMatch(/moratorium/);
  });
});

describe("a specific waiting period", () => {
  it("never applies to an accident, whatever the dates", () => {
    expect(specificWaiting({ accident: true }).holds).toBe(true);
  });

  it("bars a named treatment inside the period", () => {
    const r = specificWaiting({
      coverageStart: "2024-01-01",
      admissionDate: "2025-06-01",
      policyWaitMonths: 24,
      accident: false,
    });
    expect(r).toMatchObject({ holds: false, months: 17 });
  });

  it("needs to know whether it was an accident before it can say anything", () => {
    expect(specificWaiting({ coverageStart: "2024-01-01", admissionDate: "2025-06-01", policyWaitMonths: 24 }).needs).toEqual(["accident"]);
  });
});

describe("the initial waiting period", () => {
  it("bars an illness diagnosed in the policy's first 30 days", () => {
    const r = initialWaiting({ coverageStart: "2025-06-01", diagnosisDate: "2025-06-14", accident: false });
    expect(r.holds).toBe(false);
    expect(r.finding).toMatch(/13 days/);
  });

  it("is over on day 30, and never applies to an accident", () => {
    expect(initialWaiting({ coverageStart: "2025-06-01", diagnosisDate: "2025-07-01", accident: false }).holds).toBe(true);
    expect(initialWaiting({ coverageStart: "2025-06-01", diagnosisDate: "2025-06-02", accident: true }).holds).toBe(true);
  });
});

describe("continuity across a late renewal", () => {
  it("survives a payment inside the 30-day grace period", () => {
    expect(continuity({ renewalDue: "2023-04-01", renewalPaid: "2023-04-28" }).holds).toBe(true);
  });

  it("breaks past it", () => {
    expect(continuity({ renewalDue: "2023-04-01", renewalPaid: "2023-05-05" }).holds).toBe(false);
  });

  it("uses 15 days for monthly premiums", () => {
    expect(
      continuity({ renewalDue: "2023-04-01", renewalPaid: "2023-04-20", monthlyPremium: true }).holds,
    ).toBe(false);
  });
});

describe("what the rejection letter itself owes", () => {
  it("must cite a term of the policy", () => {
    expect(citesPolicyTerms({ clausesCited: [] }).holds).toBe(false);
    expect(citesPolicyTerms({ clausesCited: ["Clause 4.1"] }).holds).toBe(true);
  });

  it("can't blame the policyholder for documents the insurer collects", () => {
    expect(documentsDuty({ rejectedForMissingDocuments: true }).holds).toBe(false);
    expect(documentsDuty({ rejectedForMissingDocuments: false }).holds).toBe(true);
  });
});

describe("the Ombudsman window", () => {
  it("needs a written representation to the insurer first", () => {
    expect(ombudsmanWindow({ today: "2025-01-01" }).holds).toBe(false);
  });

  it("opens one month after an unanswered representation and closes a year later", () => {
    const r = ombudsmanWindow({ representationSent: "2025-01-10", today: "2025-01-20" });
    expect(r).toMatchObject({ holds: false, opensOn: "2025-02-10", closesOn: "2026-02-10" });
  });

  it("opens on the insurer's reply when there is one", () => {
    const r = ombudsmanWindow({
      representationSent: "2025-01-10",
      insurerReplied: "2025-01-25",
      today: "2025-03-01",
    });
    expect(r).toMatchObject({ holds: true, opensOn: "2025-01-25", closesOn: "2026-01-25" });
  });

  it("names the condonation route once the year has passed", () => {
    const r = ombudsmanWindow({ representationSent: "2023-01-10", today: "2025-01-01" });
    expect(r.holds).toBe(false);
    expect(r.finding).toMatch(/condone/);
  });
});
