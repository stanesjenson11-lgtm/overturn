import type { Retrieved } from "../db/queries";

export type Clause = Retrieved;

/**
 * What the UI needs to render a citation chip and its popover.
 *
 * The id is what the model wrote: "P3" for a passage of the user's own
 * documents, "R2" for a regulation. Two prefixes rather than one number line,
 * because "your policy says" and "the regulator says" carry different weight
 * in an appeal, and the reader should see which is which at a glance.
 */
export type Citation = {
  id: string;
  source: "policy" | "regulation";
  document: string | null;
  chunkId: string;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type Span = { stage: string; ms: number; note?: string };

/** ponytail: the fixed pipeline's positional ids; goes when that pipeline does (Phase 8). */
export const toCitations = (clauses: Clause[]): Citation[] =>
  clauses.map((c, i) => ({
    id: String(i + 1),
    source: "policy",
    document: null,
    chunkId: c.id,
    heading: c.heading_path,
    pageStart: c.page_start,
    pageEnd: c.page_end,
    text: c.content,
  }));
