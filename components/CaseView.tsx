"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, type Case, type Citation, type Doc, type DocKind, type KeyTerm, type Msg } from "@/lib/client";
import { AnswerText } from "./CitationChip";
import { DeleteButton, REFRESH } from "./Sidebar";
import UploadDropzone from "./UploadDropzone";

const STAGE_LABEL: Record<string, string> = {
  rewrite: "reading the conversation",
  retrieve: "searching your documents",
  gate: "checking the question is about this claim",
  rerank: "ranking clauses",
  grade: "checking the clauses answer it",
  retry: "widening the search",
  answer: "writing",
};

const STATUS: Record<string, string> = {
  pending: "queued",
  parsing: "reading pages",
  embedding: "indexing clauses",
  ready: "ready",
  failed: "failed",
};

const SLOTS: { kind: DocKind; label: string; prompt: string; optional?: boolean }[] = [
  { kind: "policy", label: "Policy wording", prompt: "Drop the policy wording PDF" },
  { kind: "rejection", label: "Rejection letter", prompt: "Drop the rejection letter (a scan is fine)" },
  {
    kind: "medical",
    label: "Discharge summary",
    prompt: "Optional: discharge summary",
    optional: true,
  },
];

/** One question the documents may well not answer, so declining gets
 *  discovered by anyone who clicks around, not only by someone who knows to look. */
const SUGGESTIONS = [
  "Why was my claim rejected, and does my policy actually say that?",
  "How long is the waiting period for pre-existing diseases in my policy?",
  "Does my policy cover robotic surgery?",
];

/** Facts pulled from one document, each with the page it came from. */
function TermsCard({ title, terms }: { title: string; terms: KeyTerm[] }) {
  if (!terms.length) return null;
  return (
    <section className="mt-6 rounded-2xl p-5 shadow-neu-sm">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-2 text-sm">
        {terms.map((t) => (
          <Fragment key={t.field}>
            <dt className="text-muted">{t.label}</dt>
            <dd>{t.value}</dd>
            <dd className="text-xs tabular-nums text-muted">p.{t.page}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

export default function CaseView({ caseId }: { caseId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ case: Case; documents: Doc[]; messages: Msg[] }>(`/api/cases/${caseId}`);
      setDocs(d.documents);
      setMessages(d.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this case.");
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ingestion runs after the upload response returns, so the only way to learn
  // it finished is to ask. Polling stops the moment nothing is in flight.
  const working = docs.some((d) => d.status !== "ready" && d.status !== "failed");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [working, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft, stage]);

  const ready = docs.some((d) => d.status === "ready");
  const terms = docs.find((d) => d.kind === "policy")?.key_terms ?? [];
  const letter = docs.find((d) => d.kind === "rejection")?.key_terms ?? [];

  async function removeDoc(id: string) {
    await api(`/api/documents/${id}`, { method: "DELETE" });
    await load();
  }

  async function ask(text: string) {
    if (!text.trim() || streaming || !ready) return;
    setQuestion("");
    setError(null);
    setStreaming(true);
    setStage(STAGE_LABEL.retrieve);
    setDraft("");
    setCitations([]);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "user", content: text, citations: null },
    ]);

    try {
      const res = await fetch(`/api/cases/${caseId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });

      // A rejected request (429, 404, validation) answers with JSON, not SSE.
      if (!res.ok || !res.headers.get("content-type")?.includes("event-stream")) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let cites: Citation[] = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; the tail may be partial.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6));

          if (event.type === "stage") setStage(STAGE_LABEL[event.stage] ?? event.stage);
          else if (event.type === "citations") {
            cites = event.citations;
            setCitations(cites);
          } else if (event.type === "text") {
            answer += event.text;
            setDraft(answer);
          } else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "done") {
            answer = event.content;
            cites = event.citations;
          }
        }
      }

      setMessages((m) => [
        ...m,
        { id: `local-a-${Date.now()}`, role: "assistant", content: answer, citations: cites },
      ]);
      window.dispatchEvent(new Event(REFRESH));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStreaming(false);
      setStage(null);
      setDraft("");
    }
  }

  return (
    <div className="flex h-dvh flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-8">
        <section aria-labelledby="docs" className="grid gap-3 sm:grid-cols-3">
          <h2 id="docs" className="sr-only">
            Documents in this case
          </h2>
          {SLOTS.map((slot) => {
            const doc = docs.find((d) => d.kind === slot.kind);
            return (
              <div key={slot.kind}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                  {slot.label}
                </p>
                {doc ? (
                  <div className="group flex items-center gap-1 rounded-xl px-3 py-2.5 shadow-neu-sm">
                    <div className="min-w-0 flex-1" title={doc.error ?? undefined}>
                      <p className="truncate text-sm">{doc.filename}</p>
                      <p className={`text-xs ${doc.status === "failed" ? "text-accent" : "text-muted"}`}>
                        {doc.status === "ready"
                          ? `${doc.page_count ?? "?"} pages`
                          : doc.status === "failed"
                            ? (doc.error ?? "failed")
                            : `${STATUS[doc.status] ?? doc.status} …`}
                      </p>
                    </div>
                    <DeleteButton what={doc.filename} onDelete={() => removeDoc(doc.id)} />
                  </div>
                ) : (
                  <UploadDropzone caseId={caseId} kind={slot.kind} prompt={slot.prompt} onUploaded={load} />
                )}
              </div>
            );
          })}
        </section>

        {messages.length === 0 && !streaming && (
          <div className="mt-10 max-w-lg">
            <h1 className="font-serif text-2xl">What do your documents say?</h1>
            <TermsCard title="What the insurer said" terms={letter} />
            <TermsCard title="Your policy at a glance" terms={terms} />
            {ready ? (
              <>
                <p className="mt-4 text-muted">Try one of these:</p>
                <ul className="mt-4 space-y-3">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => void ask(s)}
                        className="w-full rounded-xl px-4 py-3 text-left text-sm shadow-neu-sm transition hover:shadow-neu active:shadow-neu-inset-sm"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-muted">
                Add the policy wording and the insurer&apos;s rejection letter above. Questions open
                up once a document is indexed.
              </p>
            )}
          </div>
        )}

        <ol className="mt-8 space-y-8">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-ink shadow-neu-sm">
                  {m.content}
                </p>
              </li>
            ) : (
              <li key={m.id} className="flex gap-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-accent shadow-neu-inset-sm">
                  OT
                </span>
                <div className="min-w-0 flex-1">
                  <AnswerText content={m.content} citations={m.citations} />
                </div>
              </li>
            ),
          )}

          {streaming && (
            <li className="flex gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-accent shadow-neu-inset-sm">
                OT
              </span>
              <div className="min-w-0 flex-1">
                {draft ? (
                  <AnswerText content={draft} citations={citations} />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                    {stage}…
                  </p>
                )}
              </div>
            </li>
          )}
        </ol>

        {error && (
          <p role="alert" className="mt-6 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent shadow-neu-inset-sm">
            {error}
          </p>
        )}

        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="border-t border-line"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={ready ? "Ask about the rejection, a clause, a waiting period…" : "Upload a document to start"}
            disabled={streaming || !ready}
            className="flex-1 rounded-full px-4 py-3 text-sm text-ink shadow-neu-inset outline-none placeholder:text-muted disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || !ready || !question.trim()}
            aria-label="Ask"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-4">
              <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="mx-auto max-w-3xl px-6 pb-3 text-xs text-muted">
          Information from your documents, not legal or medical advice.
        </p>
      </form>
    </div>
  );
}
