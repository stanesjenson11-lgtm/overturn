/**
 * The checks a rejection can fail, as plain functions. No model, no database.
 *
 * The model never does date arithmetic: it gathers facts (from the documents,
 * or by asking), calls these through the check_rules tool, and quotes what
 * comes back. Each rule names the provision it encodes. Every provision was
 * read in the primary text (the PDFs scripts/ingest-regulations.ts downloads),
 * not in a blog. Two common blog claims didn't survive that reading: the
 * 36-month pre-existing-disease cap is in the Insurance Products Regulations,
 * not the Master Circular, and the Ombudsman Rules give the insurer one month
 * to answer, not fifteen days.
 *
 * `holds` is three-valued on purpose. `null` means the facts given can't
 * decide it, and `needs` says which fact would. The agent asks for that fact
 * instead of guessing it.
 */

export type RuleResult = {
  rule: string;
  holds: boolean | null;
  finding: string;
  source: string;
  months?: number;
  needs?: string[];
};

const PRODUCTS = "IRDAI (Insurance Products) Regulations, 2024, Schedule III";
const CIRCULAR = "IRDAI Master Circular on Health Insurance Business, 29.05.2024";
const OMBUDSMAN = "Insurance Ombudsman Rules, 2017, rule 14(3)";

// ------------------------------------------------------------------ dates
// ISO yyyy-mm-dd strings in, UTC throughout: a claim date has no timezone, and
// a local-time Date object turns 2024-03-31 into the 30th west of Greenwich.

const parse = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
};

const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** Whole calendar months from `from` to `to`; a month is complete on the same
 *  day-of-month. 2019-03-15 → 2024-03-14 is 59, → 2024-03-15 is 60. */
export function fullMonths(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
}

/** Same day-of-month n months on, clamped to the month's end: Jan 31 + 1 → Feb 28/29. */
export function addMonths(date: string, n: number): string {
  const { y, m, d } = parse(date);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return iso(y, m + n, Math.min(d, last));
}

const missing = (facts: Record<string, unknown>) =>
  Object.entries(facts)
    .filter(([, v]) => v === undefined || v === null || v === "")
    .map(([k]) => k);

const undecided = (rule: string, source: string, needs: string[]): RuleResult => ({
  rule,
  holds: null,
  finding: `Can't decide without: ${needs.join(", ")}.`,
  source,
  needs,
});

// ------------------------------------------------------------------ rules

/**
 * Moratorium: after sixty continuous months of cover, counting portability and
 * migration, no claim can be contested for non-disclosure or misrepresentation,
 * except on grounds of established fraud. For an enhanced sum insured, the
 * enhanced part gets its own sixty months from the date of enhancement.
 * Schedule III §8; the Master Circular §13 repeats it.
 *
 * `holds: true` means the moratorium protects this claim from a non-disclosure
 * rejection.
 */
export function moratorium(f: {
  coverageStart?: string; // first policy's start, including ported/migrated cover
  admissionDate?: string;
  sumInsuredEnhancedOn?: string;
}): RuleResult {
  const rule = "moratorium";
  const source = `${PRODUCTS} §8`;
  const needs = missing({ coverageStart: f.coverageStart, admissionDate: f.admissionDate });
  if (needs.length) return undecided(rule, source, needs);

  const months = fullMonths(f.coverageStart!, f.admissionDate!);
  const holds = months >= 60;
  let finding = holds
    ? `${months} months of continuous cover at admission, past the 60-month moratorium: the claim can't be contested for non-disclosure or misrepresentation, only for established fraud.`
    : `${months} months of continuous cover at admission, short of the 60-month moratorium, so non-disclosure can still be raised.`;

  if (holds && f.sumInsuredEnhancedOn) {
    const enhanced = fullMonths(f.sumInsuredEnhancedOn, f.admissionDate!);
    if (enhanced < 60)
      finding += ` The enhanced part of the sum insured has only ${enhanced} months since enhancement, so the protection covers the original sum insured.`;
  }
  return { rule, holds, finding, source, months };
}

/**
 * Waiting period for a disclosed pre-existing disease: at most 36 months of
 * continuous cover. Schedule III §7.
 *
 * `holds: true` means the waiting period has run out, so it can't bar this
 * claim. A policy that states more than 36 months is flagged, not overruled:
 * the cap governs products under the 2024 regulations (in force from
 * 1 April 2024), and an older product's wording needs the insurer's answer.
 */
export function pedWaiting(f: {
  coverageStart?: string;
  admissionDate?: string;
  policyWaitMonths?: number;
  pedDisclosed?: boolean;
}): RuleResult {
  const rule = "ped_waiting";
  const source = `${PRODUCTS} §7`;
  const needs = missing({
    coverageStart: f.coverageStart,
    admissionDate: f.admissionDate,
    policyWaitMonths: f.policyWaitMonths,
    pedDisclosed: f.pedDisclosed,
  });
  if (needs.length) return undecided(rule, source, needs);

  if (!f.pedDisclosed)
    return {
      rule,
      holds: null,
      finding:
        "The condition wasn't disclosed, so this is a non-disclosure question, not a waiting-period one. Check the moratorium instead.",
      source,
    };

  const months = fullMonths(f.coverageStart!, f.admissionDate!);
  const wait = f.policyWaitMonths!;
  const capped = Math.min(wait, 36);
  const over = wait > 36 ? ` The policy states ${wait} months, more than the 36-month maximum: worth raising.` : "";

  return months >= wait
    ? {
        rule,
        holds: true,
        finding: `${months} months of cover at admission; the policy's ${wait}-month pre-existing-disease wait had already run out.`,
        source,
        months,
      }
    : {
        rule,
        holds: months >= capped,
        finding:
          months >= capped
            ? `${months} months of cover at admission: inside the policy's ${wait}-month wait, but past the 36-month maximum.${over}`
            : `${months} months of cover at admission, inside the ${wait}-month pre-existing-disease wait.${over}`,
        source,
        months,
      };
}

/**
 * Specific waiting period (named diseases/treatments): up to 36 months, and it
 * never applies to a condition caused by an accident. Schedule III §1.7.
 *
 * `holds: true` means the waiting period can't bar this claim.
 */
export function specificWaiting(f: {
  coverageStart?: string;
  admissionDate?: string;
  policyWaitMonths?: number;
  accident?: boolean;
}): RuleResult {
  const rule = "specific_waiting";
  const source = `${PRODUCTS} §1.7`;
  if (f.accident)
    return {
      rule,
      holds: true,
      finding: "Caused by an accident, and a specific waiting period never applies to accidents.",
      source,
    };

  const needs = missing({
    coverageStart: f.coverageStart,
    admissionDate: f.admissionDate,
    policyWaitMonths: f.policyWaitMonths,
    accident: f.accident,
  });
  if (needs.length) return undecided(rule, source, needs);

  const months = fullMonths(f.coverageStart!, f.admissionDate!);
  const wait = f.policyWaitMonths!;
  const over = wait > 36 ? ` The policy states ${wait} months; the definition allows up to 36.` : "";
  return {
    rule,
    holds: months >= Math.min(wait, 36),
    finding:
      months >= wait
        ? `${months} months of cover at admission, past the ${wait}-month specific waiting period.`
        : `${months} months of cover at admission, inside the ${wait}-month specific waiting period.${over}`,
    source,
    months,
  };
}

/**
 * The initial waiting period: an illness first diagnosed within the policy's
 * opening days (30 in standard wordings) isn't covered, an accident always is.
 * This one is a term of the policy, not a regulation, so it checks only the
 * date arithmetic the model must never do itself; the wording decides the rest.
 *
 * `holds: true` means the initial wait can't bar this claim.
 */
export function initialWaiting(f: {
  coverageStart?: string;
  diagnosisDate?: string;
  policyWaitDays?: number;
  accident?: boolean;
}): RuleResult {
  const rule = "initial_waiting";
  const source = "the policy's own initial waiting period clause";
  if (f.accident)
    return {
      rule,
      holds: true,
      finding: "Caused by an accident, which an initial waiting period doesn't apply to.",
      source,
    };

  const needs = missing({ coverageStart: f.coverageStart, diagnosisDate: f.diagnosisDate, accident: f.accident });
  if (needs.length) return undecided(rule, source, needs);

  const days = (Date.parse(f.diagnosisDate!) - Date.parse(f.coverageStart!)) / 86_400_000;
  const wait = f.policyWaitDays ?? 30;
  return {
    rule,
    holds: days >= wait,
    finding:
      days >= wait
        ? `First diagnosed ${days} days after cover began, past the ${wait}-day initial wait.`
        : `First diagnosed ${days} days after cover began, inside the ${wait}-day initial wait.`,
    source,
  };
}

/**
 * A renewal paid within the grace period is not a break in the policy:
 * fifteen days when premiums are monthly, thirty otherwise. Schedule III §1.3,
 * §9.3. A break restarts the clock for every waiting period and the moratorium.
 *
 * `holds: true` means continuity survived the late renewal.
 */
export function continuity(f: {
  renewalDue?: string;
  renewalPaid?: string;
  monthlyPremium?: boolean;
}): RuleResult {
  const rule = "continuity";
  const source = `${PRODUCTS} §1.3, §9.3`;
  const needs = missing({ renewalDue: f.renewalDue, renewalPaid: f.renewalPaid });
  if (needs.length) return undecided(rule, source, needs);

  const days = (Date.parse(f.renewalPaid!) - Date.parse(f.renewalDue!)) / 86_400_000;
  const grace = f.monthlyPremium ? 15 : 30;
  return {
    rule,
    holds: days <= grace,
    finding:
      days <= grace
        ? `Renewal paid ${Math.max(days, 0)} days after the due date, within the ${grace}-day grace period: no break in cover.`
        : `Renewal paid ${days} days after the due date, past the ${grace}-day grace period: a break in cover.`,
    source,
  };
}

/**
 * A rejection must give "full details giving reference to the specific terms
 * and conditions of the policy document". Master Circular §17(b).
 *
 * `holds: true` means the letter meets that bar.
 */
export function citesPolicyTerms(f: { clausesCited?: string[] }): RuleResult {
  const rule = "cites_policy_terms";
  const source = `${CIRCULAR} §17(b)`;
  if (!f.clausesCited) return undecided(rule, source, ["clausesCited"]);
  const holds = f.clausesCited.length > 0;
  return {
    rule,
    holds,
    finding: holds
      ? `The letter cites ${f.clausesCited.join(", ")}.`
      : "The letter cites no clause of the policy, which a rejection is required to do.",
    source,
  };
}

/**
 * "Policyholder shall not be required to submit the documents": insurers and
 * TPAs collect them from the hospital. Master Circular §17(c).
 *
 * `holds: true` means the rejection stands clear of this rule; false means it
 * was rejected for papers the policyholder wasn't required to supply.
 */
export function documentsDuty(f: { rejectedForMissingDocuments?: boolean }): RuleResult {
  const rule = "documents_duty";
  const source = `${CIRCULAR} §17(c)`;
  if (f.rejectedForMissingDocuments === undefined)
    return undecided(rule, source, ["rejectedForMissingDocuments"]);
  return {
    rule,
    holds: !f.rejectedForMissingDocuments,
    finding: f.rejectedForMissingDocuments
      ? "Rejected for missing documents, but the insurer or TPA is meant to collect them from the hospital, not the policyholder."
      : "Not a missing-documents rejection.",
    source,
  };
}

/**
 * When a complaint can go to the Insurance Ombudsman, and until when. It needs
 * a written representation to the insurer first. It opens when the insurer
 * rejects or answers it, or one month after the insurer received it with no
 * reply, and it must be made within one year of that point. Rule 14(3).
 */
export function ombudsmanWindow(f: {
  representationSent?: string;
  insurerReplied?: string;
  today: string;
}): RuleResult & { opensOn?: string; closesOn?: string } {
  const rule = "ombudsman_window";
  const source = OMBUDSMAN;
  if (!f.representationSent)
    return {
      rule,
      holds: false,
      finding: "Write to the insurer first: the Ombudsman only takes a complaint after a written representation.",
      source,
    };

  const opensOn = f.insurerReplied ?? addMonths(f.representationSent, 1);
  const closesOn = addMonths(opensOn, 12);
  const open = f.today >= opensOn && f.today <= closesOn;
  const finding =
    f.today < opensOn
      ? `The Ombudsman opens on ${opensOn} if the insurer hasn't replied by then.`
      : f.today <= closesOn
        ? `Open now; complain to the Ombudsman by ${closesOn}.`
        : `The one-year window closed on ${closesOn}; the Ombudsman can still condone the delay (rule 14(4)).`;
  return { rule, holds: open, finding, source, opensOn, closesOn };
}

/** Everything the check_rules tool can run, by name. */
export const RULES = {
  moratorium,
  ped_waiting: pedWaiting,
  specific_waiting: specificWaiting,
  initial_waiting: initialWaiting,
  continuity,
  cites_policy_terms: citesPolicyTerms,
  documents_duty: documentsDuty,
} as const;
