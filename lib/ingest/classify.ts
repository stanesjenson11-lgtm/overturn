import type { DocKind } from "../db/queries";
import type { Page } from "./pdf";

/**
 * Which document this is, from its own words: no upload asks the user to say.
 *
 * Each kind has phrases the other two rarely use. A rejection letter quotes
 * policy clauses, and a policy describes how claims get repudiated, so no
 * single word decides it: each distinct signal scores once (so a long policy
 * doesn't win by repetition) and the strongest total wins.
 *
 * Deterministic and free on purpose: it runs on every upload, costs no model
 * quota, and is checked against every sample in tests/classify.test.ts.
 * ponytail: phrase scoring; ask the utility model only when two kinds tie, if
 * real documents start landing in the wrong slot.
 */
const SIGNALS: Record<DocKind, [RegExp, number][]> = {
  rejection: [
    [/repudiat/, 3],
    [/claim (?:is|has been|stands|was)? ?(?:rejected|denied|declined|disallowed)/, 3],
    [/regret to inform|we regret that/, 3],
    [/not (?:admissible|payable|tenable)/, 3],
    [/rejection letter|denial of (?:the )?claim|claim rejection/, 3],
    [/dear (?:policyholder|sir|madam|customer|insured)/, 1],
    [/amount (?:claimed|payable|disallowed|deducted)/, 1],
    [/claim (?:no|number|reference)/, 1],
  ],
  policy: [
    [/policy wording|policy terms and conditions|terms and conditions of (?:the|this) policy/, 3],
    [/\bdefinitions\b/, 3],
    [/["“][a-z][^"”]{1,40}["”] (?:means|shall mean)/, 3],
    [/\bexclusions\b/, 2],
    [/policy schedule|policy period/, 1],
    [/the company (?:shall|will|may) (?:pay|indemnify|not be liable)/, 2],
    [/insured person/, 1],
  ],
  medical: [
    [/discharge summary/, 3],
    [/date of discharge|discharged on/, 2],
    [/chief complaints?|presenting complaints?/, 3],
    [/course in (?:the )?hospital|hospital course/, 3],
    [/(?:condition|advice) (?:at|on) discharge|discharge advice/, 3],
    [/final diagnosis|provisional diagnosis/, 2],
    [/history of present(?:ing)? illness|past history/, 2],
    [/investigations?/, 1],
    [/\b(?:final )?bill\b|invoice|receipt/, 1],
  ],
};

export const KIND_LABEL: Record<DocKind, string> = {
  policy: "policy wording",
  rejection: "rejection letter",
  medical: "medical document",
};

export function classify(pages: Page[]): DocKind {
  const text = pages.map((p) => p.text).join("\n").toLowerCase().replace(/\s+/g, " ");
  const score = (kind: DocKind) => SIGNALS[kind].reduce((n, [re, w]) => n + (re.test(text) ? w : 0), 0);
  const scores = (["rejection", "policy", "medical"] as const).map((k) => [k, score(k)] as const);
  const [best, top] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  // Nothing recognisable: a bill, a prescription, a lab report. "Medical
  // document" is the kind for supporting papers, and it's never a rule input.
  return top > 0 ? best : "medical";
}
