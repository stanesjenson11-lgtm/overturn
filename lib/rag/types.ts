import type { Retrieved } from "../db/queries";

export type Clause = Retrieved;

/** What the UI needs to render a citation chip and its popover. */
export type Citation = {
  id: number; // the [n] the model wrote
  chunkId: string;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type Span = { stage: string; ms: number; note?: string };

export const toCitations = (clauses: Clause[]): Citation[] =>
  clauses.map((c, i) => ({
    id: i + 1,
    chunkId: c.id,
    heading: c.heading_path,
    pageStart: c.page_start,
    pageEnd: c.page_end,
    text: c.content,
  }));
