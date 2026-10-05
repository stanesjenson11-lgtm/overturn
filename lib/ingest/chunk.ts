import type { Page } from "./pdf";

export type Chunk = {
  ordinal: number;
  headingPath: string | null;
  pageStart: number;
  pageEnd: number;
  content: string;
};

// Characters, not tokens — ~4 chars/token is close enough for a chunk budget,
// and a real tokenizer here would be a dependency earning nothing.
const TARGET = 1600; // ≈ 400 tokens
const OVERLAP = 240; // ≈ 60 tokens
const MIN = 200;

type Unit = { text: string; page: number };

/** `8.` / `8.2` / `12.4.1` — a numbered clause, with its text on the same line. */
const NUMBERED = /^(\d+(?:\.\d+)*)[.)]?\s+(\S.*)$/;
/**
 * `ARTICLE IV` / `SECTION 12 — PETS`. Case-sensitive on purpose: leases set
 * these headings in capitals, and a case-insensitive match turns the wrapped
 * tail of "...gives notice under / Section 12." into a phantom heading that
 * splits a clause in half.
 */
const ARTICLE = /^(ARTICLE|SECTION)\s+([IVXLCDM]+|\d+)\b\s*[.:—-]?\s*(.*)$/;

/**
 * A heading, or null. Exported because it is the one piece of the chunker with
 * a genuinely fuzzy contract, and the tests pin it directly.
 */
export function detectHeading(line: string): { depth: number; label: string } | null {
  const t = line.trim();
  if (!t || t.length > 90) return null;

  const article = ARTICLE.exec(t);
  if (article) return { depth: 1, label: t.replace(/\s+/g, " ") };

  const numbered = NUMBERED.exec(t);
  if (numbered) {
    const [, number, rest] = numbered;
    // "12.5" alone is a heading; "12.5 shall be paid by the fifteenth" is a
    // clause whose first words happen to be numbered — both start a section,
    // but only a short, title-cased tail reads as a heading label.
    const titled = rest.length <= 60 && !/[.;]$/.test(rest);
    // Verbatim when it reads as a title, so the citation chip shows the lease's
    // own wording; bare number otherwise, so a heading path never swallows a
    // whole sentence.
    return { depth: number.split(".").length, label: titled ? t.replace(/\s+/g, " ") : number };
  }

  // A short ALL-CAPS line with no sentence punctuation: "SECURITY DEPOSIT".
  if (/^[A-Z][A-Z0-9 ,'&/()-]{2,60}$/.test(t) && /[A-Z]{3}/.test(t) && !/[.;]$/.test(t))
    return { depth: 1, label: t.replace(/\s+/g, " ") };

  return null;
}

/**
 * Hyphenation across a line break, page-number-only lines, ragged whitespace.
 * Blank lines are deliberately KEPT: they are the only paragraph boundary a PDF
 * text layer gives you, and dropping them collapses a page into one unit that
 * can then only be split on arbitrary character counts.
 */
function cleanPage(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => !/^(page\s+)?\d+(\s*\/\s*\d+)?$/i.test(l));
}

function splitLongUnit(u: Unit): Unit[] {
  if (u.text.length <= TARGET) return [u];
  const out: Unit[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, page: u.page });
    buf = "";
  };
  for (const s of u.text.split(/(?<=[.;:])\s+/)) {
    if (s.length > TARGET) {
      flush();
      for (let i = 0; i < s.length; i += TARGET)
        out.push({ text: s.slice(i, i + TARGET), page: u.page });
      continue;
    }
    if (buf.length + s.length + 1 > TARGET) flush();
    buf = buf ? `${buf} ${s}` : s;
  }
  flush();
  return out;
}

/** Last whole words of `text`, up to OVERLAP characters. */
function tail(text: string): string {
  if (text.length <= OVERLAP) return text;
  const cut = text.slice(-OVERLAP);
  const space = cut.indexOf(" ");
  return space < 0 ? cut : cut.slice(space + 1);
}

type Section = { headingPath: string | null; units: Unit[] };

/** Longest shared heading path — the honest label for a merged chunk. */
function commonPath(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  const [as, bs] = [a.split(" > "), b.split(" > ")];
  const shared: string[] = [];
  for (let i = 0; i < Math.min(as.length, bs.length) && as[i] === bs[i]; i++) shared.push(as[i]);
  return shared.length ? shared.join(" > ") : null;
}

/**
 * A heading on its own line is a section with no body: "4. UTILITIES" followed
 * by "4.1 …" leaves the parent holding two words, which retrieves on nothing
 * but its own title.
 *
 * Undersized sections are folded into a RELATIVE — a parent, child, or sibling —
 * and the merged chunk takes the heading path they share. Merging into an
 * unrelated neighbour would be worse than a small chunk: the citation chip
 * would name clause 5 for text that came from clause 4, and a wrong page number
 * is more damaging than a missing one because it looks authoritative.
 *
 * A short clause that has no relative simply stays short. That is not a defect;
 * some clauses are one sentence.
 */
function mergeUndersizedSections(sections: Section[]): Section[] {
  const size = (s: Section) => s.units.reduce((n, u) => n + u.text.length + 2, 0);

  for (let i = 0; i < sections.length && sections.length > 1; i++) {
    if (size(sections[i]) >= MIN) continue;
    const [prev, self, next] = [sections[i - 1], sections[i], sections[i + 1]];

    if (next && commonPath(self.headingPath, next.headingPath)) {
      next.units.unshift(...self.units);
      next.headingPath = commonPath(self.headingPath, next.headingPath);
    } else if (prev && commonPath(prev.headingPath, self.headingPath)) {
      prev.units.push(...self.units);
      prev.headingPath = commonPath(prev.headingPath, self.headingPath);
    } else if (i === 0 && next) {
      // The title block ahead of clause 1 has no relative by definition. It
      // belongs to the opening clause, and keeps that clause's heading — last
      // resort only, or it would swallow the clause it merged into and then
      // keep going.
      next.units.unshift(...self.units);
    } else continue;

    sections.splice(i, 1);
    i--;
  }
  return sections;
}

/**
 * Chunk a lease on clause boundaries.
 *
 * Sections come first (a clause is a semantic unit — splitting mid-clause is
 * how a retriever returns half an obligation), then each section is packed to
 * ~400 tokens with ~60 tokens of overlap so a clause that straddles a boundary
 * is still whole in one of the two chunks.
 *
 * Plain-prose leases have no clause numbering at all; those fall through to
 * paragraph packing under a null heading path, which is the honest worst case.
 */
export function chunkPages(pages: Page[]): Chunk[] {
  const stack: { depth: number; label: string }[] = [];
  const sections: { headingPath: string | null; units: Unit[] }[] = [
    { headingPath: null, units: [] },
  ];

  for (const page of pages) {
    let paragraph: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length) {
        sections.at(-1)!.units.push({ text: paragraph.join(" "), page: page.number });
        paragraph = [];
      }
    };

    for (const line of cleanPage(page.text)) {
      if (!line) {
        flushParagraph();
        continue;
      }
      const heading = detectHeading(line);
      if (heading) {
        flushParagraph();
        while (stack.length && stack.at(-1)!.depth >= heading.depth) stack.pop();
        stack.push(heading);
        sections.push({
          headingPath: stack.map((h) => h.label).join(" > "),
          units: [{ text: line.trim(), page: page.number }],
        });
        continue;
      }
      paragraph.push(line);
    }
    flushParagraph();
  }

  const sized = mergeUndersizedSections(sections.filter((s) => s.units.length > 0));

  const chunks: Chunk[] = [];
  for (const section of sized) {
    const units = section.units.flatMap(splitLongUnit);
    if (!units.length) continue;

    let cur: Unit[] = [];
    let carry: Unit | null = null;

    const emit = () => {
      if (!cur.length) return;
      const body = cur.map((u) => u.text).join("\n\n");
      const content = carry ? `${carry.text}\n\n${body}` : body;
      const pagesIn = [...cur.map((u) => u.page), ...(carry ? [carry.page] : [])];

      const prev = chunks.at(-1);
      // A trailing scrap belongs to the clause it came from, not to a chunk of
      // its own — a 40-character chunk retrieves on noise.
      if (content.length < MIN && prev && prev.headingPath === section.headingPath) {
        prev.content += `\n\n${body}`;
        prev.pageEnd = Math.max(prev.pageEnd, ...pagesIn);
      } else {
        chunks.push({
          ordinal: chunks.length,
          headingPath: section.headingPath,
          pageStart: Math.min(...pagesIn),
          pageEnd: Math.max(...pagesIn),
          content,
        });
      }
      carry = { text: tail(content), page: cur.at(-1)!.page };
      cur = [];
    };

    const size = () => cur.reduce((n, x) => n + x.text.length + 2, carry ? carry.text.length : 0);

    for (const u of units) {
      // Close the chunk BEFORE the unit that would overflow it, not after.
      // Emitting after means every chunk can reach twice TARGET, which is how a
      // 400-token budget quietly becomes an 800-token one.
      if (cur.length && size() + u.text.length >= TARGET) emit();
      cur.push(u);
    }
    emit();
  }

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}
