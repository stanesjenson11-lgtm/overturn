import { PDFDocument, StandardFonts } from "pdf-lib";
import type { KeyTerm } from "./ingest/terms";
import type { Citation } from "./rag/types";
import { ombudsmanWindow } from "./rules";

/**
 * The appeal letter, assembled without a model call.
 *
 * Every sentence that matters is already verified by the time a verdict
 * exists: the grounds came from the agent's record_verdict, each ground's
 * quotes are the exact passages it cited, the facts were grounded against the
 * rejection letter, and the deadlines come from the rules engine. Drafting
 * with a model would be the one step where something new could be invented.
 * A template can't do that. Missing personal details stay as visible
 * [placeholders] for the user to fill.
 */

export type LetterInput = {
  facts: KeyTerm[]; // from the rejection letter
  verdict: { summary: string; grounds: { point: string; cites: string[] }[] };
  citations: Citation[];
  today: string; // YYYY-MM-DD
};

const fact = (facts: KeyTerm[], field: string, placeholder: string) =>
  facts.find((f) => f.field === field)?.value ?? `[${placeholder}]`;

/** DD/MM/YYYY, the way Indian insurers date their letters. */
const indian = (iso: string) => iso.split("-").reverse().join("/");

const quote = (c: Citation) => {
  const where =
    c.source === "regulation"
      ? `${c.document ?? "IRDAI regulations"}, ${c.heading ?? "clause"}, p.${c.pageStart}`
      : `Policy wording, ${c.heading ?? "clause"}, p.${c.pageStart}`;
  const text = c.text.replace(/\s+/g, " ").trim();
  return `   ${where}: "${text.length > 400 ? `${text.slice(0, 400)}..." (extract)` : `${text}"`}`;
};

export function appealLetter({ facts, verdict, citations, today }: LetterInput): string {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const claimed = fact(facts, "amount_claimed", "amount claimed");

  const grounds = verdict.grounds.map((g, i) =>
    [`${i + 1}. ${g.point}`, ...g.cites.flatMap((id) => (byId.has(id) ? [quote(byId.get(id)!)] : []))].join(
      "\n",
    ),
  );

  return [
    "To: The Grievance Redressal Officer",
    fact(facts, "insurer", "Insurer name"),
    "",
    `Date: ${indian(today)}`,
    "",
    `Subject: Request to review the rejection of claim ${fact(facts, "claim_number", "claim number")}`,
    "",
    `Policy number: ${fact(facts, "policy_number", "policy number")}`,
    `Claim number: ${fact(facts, "claim_number", "claim number")}`,
    `Date of admission: ${fact(facts, "admission_date", "date of admission")}`,
    `Amount claimed: ${claimed}`,
    "",
    "Dear Sir or Madam,",
    "",
    `Your letter dated ${fact(facts, "letter_date", "date of your letter")} rejected the above claim, relying on ${fact(facts, "clauses_cited", "the clause cited")}, for this reason: "${fact(facts, "reason", "reason given")}". I ask you to review that decision, for the following reasons.`,
    "",
    ...grounds.flatMap((g) => [g, ""]),
    verdict.summary,
    "",
    `I request that you reverse the rejection and settle the claim of ${claimed} under the policy. Please reply in writing. If I have no reply within one month of your receiving this letter, or the rejection is upheld, I may complain to the Insurance Ombudsman under rule 14(3) of the Insurance Ombudsman Rules, 2017.`,
    "",
    "Enclosures: copy of your rejection letter; policy wording.",
    "",
    "Yours faithfully,",
    "",
    "[Your name]",
    "[Address, phone number, email]",
  ].join("\n");
}

/** What happens after sending, from the rules engine. Not part of the letter. */
export function nextSteps(today: string): string {
  const w = ombudsmanWindow({ representationSent: today, today });
  return [
    "YOUR NEXT STEPS (keep this page; don't send it)",
    "",
    `1. Fill in the [placeholders], sign, and send the letter to the insurer's Grievance Redressal Officer today (${indian(today)}), by email or registered post. Keep proof of sending.`,
    `2. If there's no reply by ${indian(w.opensOn!)}, or the insurer upholds the rejection, you can complain to the Insurance Ombudsman for free: Insurance Ombudsman Rules, 2017, rule 14(3).`,
    `3. Complain to the Ombudsman within one year of the insurer's reply, or of the date above if there's none: by ${indian(w.closesOn!)} at the latest. Late complaints can be condoned, but don't count on it.`,
    "",
    "This letter was assembled from your documents and IRDAI's rules. It is information, not legal advice.",
  ].join("\n");
}

/**
 * pdf-lib's standard fonts encode WinAnsi only: a rupee sign, a smart quote
 * or a Devanagari name throws mid-render. Map the common ones, drop the rest.
 * ponytail: embed a Unicode font when letters need names in Indian scripts.
 */
export const toWinAnsi = (s: string) =>
  s
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

/** Renders text to a real PDF: line wrapping, page breaks, an actual text layer. */
export async function renderPdf(text: string, pages: string[] = []): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const [size, leading, margin, width, height] = [11, 15.5, 56, 595, 842]; // A4 points

  const wrap = (paragraph: string) => {
    const lines: string[] = [];
    let current = "";
    for (const word of paragraph.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width - margin * 2) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines;
  };

  // Each extra text starts on a fresh page: the next-steps sheet must never
  // run on from the bottom of a letter the user is about to send.
  for (const body of [text, ...pages]) {
    let page = pdf.addPage([width, height]);
    let y = height - margin;
    for (const paragraph of toWinAnsi(body).split("\n")) {
      for (const line of paragraph ? wrap(paragraph) : [""]) {
        if (y < margin) {
          page = pdf.addPage([width, height]);
          y = height - margin;
        }
        if (line) page.drawText(line, { x: margin, y, size, font });
        y -= leading;
      }
    }
  }

  return pdf.save();
}
