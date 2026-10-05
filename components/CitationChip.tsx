"use client";

import { useState } from "react";
import type { Citation } from "@/lib/client";

/**
 * The verbatim clause, one click from the claim it supports.
 *
 * The original PDF is never stored — Vercel's filesystem is ephemeral and blob
 * storage is a whole extra service — so this popover shows the exact text that
 * was retrieved, with its heading and page. That's most of what a PDF viewer
 * would give you, without the service.
 */
export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const pages =
    citation.pageStart === citation.pageEnd
      ? `p. ${citation.pageStart}`
      : `pp. ${citation.pageStart}–${citation.pageEnd}`;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`${citation.heading ?? "Clause"} · ${pages}`}
        className="mx-0.5 rounded-full bg-accent px-1.5 py-0.5 align-super text-[0.7em] font-semibold text-accent-ink transition hover:brightness-105"
      >
        {citation.id}
      </button>

      {open && (
        <span className="absolute bottom-full left-0 z-20 mb-2 block w-[min(30rem,80vw)] rounded-2xl p-4 text-left shadow-neu">
          <span className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
            <span className="font-sans text-xs font-medium uppercase tracking-wide text-muted">
              {citation.heading ?? "Clause"}
            </span>
            <span className="shrink-0 font-sans text-xs text-muted">{pages}</span>
          </span>
          <span className="mt-3 block max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {citation.text}
          </span>
        </span>
      )}
    </span>
  );
}

/** Renders an answer, turning every `[n]` marker into its chip. */
export function AnswerText({
  content,
  citations,
}: {
  content: string;
  citations: Citation[] | null;
}) {
  const byId = new Map((citations ?? []).map((c) => [c.id, c]));

  return (
    <div className="prose-lease">
      {content.split(/\n{2,}/).map((para, p) => (
        <p key={p} className={p ? "mt-[0.85em]" : ""}>
          {para.split(/(\[\d+\])/).map((piece, i) => {
            const m = /^\[(\d+)\]$/.exec(piece);
            const citation = m ? byId.get(Number(m[1])) : undefined;
            return citation ? (
              <CitationChip key={i} citation={citation} />
            ) : (
              <span key={i}>{piece}</span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
