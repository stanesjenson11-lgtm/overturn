"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Case,
  type Citation,
  type Doc,
  type DocKind,
  type KeyTerm,
  type Msg,
  type Questionnaire,
  type Verdict,
} from "@/lib/client";
import { AnswerText } from "./CitationChip";
import { DeleteButton, REFRESH } from "./Sidebar";
import UploadDropzone, { ACCEPT, PlusIcon, uploadDocument } from "./UploadDropzone";

/** The agent's tool calls, as the user watches them happen. */
const STAGE_LABEL: Record<string, string> = {
  start: "reading the rejection",
  read_letter: "reading the rejection letter",
  search_policy: "searching your documents",
  search_regulations: "checking IRDAI's rules",
  check_rules: "running the rule checks",
  ask_questionnaire: "preparing a few questions",
  record_verdict: "writing the verdict",
  answer: "writing",
};

const REVIEW = "Review this rejection: does the reason the insurer gave hold up?";

const VERDICT_LABEL: Record<Verdict["verdict"], string> = {
  challengeable: "Likely challengeable",
  valid: "The rejection looks valid",
  needs_info: "Needs more information",
};

function VerdictBadge({ verdict }: { verdict: Verdict["verdict"] }) {
  return (
    <p
      className={`mb-3 inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        verdict === "challengeable"
          ? "bg-accent text-accent-ink shadow-neu-sm"
          : "text-muted shadow-neu-inset-sm"
      }`}
    >
      {VERDICT_LABEL[verdict]}
    </p>
  );
}

/**
 * The agent's questions as a form. Dates use the browser's own date input, so
 * they come back as YYYY-MM-DD, the format the rule checks take, with no
 * day/month ambiguity to misread. Answers go back as an ordinary message, so
 * the agent needs no special case to read them.
 */
function QuestionnaireForm({
  questionnaire,
  onSubmit,
}: {
  questionnaire: Questionnaire;
  onSubmit: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));
  const complete = questionnaire.questions.every((q) => answers[q.id]?.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          ["My answers:", ...questionnaire.questions.map((q) => `- ${q.text} ${answers[q.id]}`)].join("\n"),
        );
      }}
      className="mt-4 space-y-4 rounded-2xl p-5 shadow-neu-sm"
    >
      {questionnaire.questions.map((q) => (
        <fieldset key={q.id}>
          <legend className="mb-2 text-sm">{q.text}</legend>
          {q.type === "choice" ? (
            <div className="flex flex-wrap gap-2">
              {q.options!.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={answers[q.id] === o}
                  onClick={() => set(q.id, o)}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    answers[q.id] === o ? "bg-accent text-accent-ink shadow-neu-inset-sm" : "shadow-neu-sm"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <input
              type={q.type === "date" ? "date" : "text"}
              value={answers[q.id] ?? ""}
              onChange={(e) => set(q.id, e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm text-ink shadow-neu-inset outline-none"
            />
          )}
        </fieldset>
      ))}
      <button
        type="submit"
        disabled={!complete}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-40"
      >
        Send answers
      </button>
    </form>
  );
}

const STATUS: Record<string, string> = {
  pending: "queued",
  parsing: "reading pages",
  embedding: "indexing clauses",
  ready: "ready",
  failed: "failed",
};

const SLOTS: { kind: DocKind; label: string; prompt: string; optional?: boolean }[] = [
  { kind: "policy", label: "Policy wording", prompt: "Add the policy wording" },
  { kind: "rejection", label: "Rejection letter", prompt: "Add the rejection letter" },
  {
    kind: "medical",
    label: "Discharge summary",
    prompt: "Add a discharge summary (optional)",
    optional: true,
  },
];

/**
 * The "+" beside the message box: add a document the case doesn't have yet,
 * as a PDF or a photo, without scrolling back up to the slots. It offers only
 * the kinds still missing, because a case holds one of each.
 */
function AttachMenu({
  caseId,
  missing,
  onUploaded,
  onError,
}: {
  caseId: string;
  missing: typeof SLOTS;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A ref, not state: the file picker's change event must see the kind chosen
  // a moment earlier, whatever has or hasn't re-rendered in between.
  const kind = useRef<DocKind | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file || !kind.current) return;
    setBusy(true);
    try {
      await uploadDocument(caseId, kind.current, file);
      onUploaded();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      kind.current = null;
      if (input.current) input.current.value = ""; // the same file can be picked again
    }
  }

  return (
    <div
      className="relative"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="Add a document"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy || !missing.length}
        title={missing.length ? "Add a PDF or a photo" : "All three documents are added"}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-accent shadow-neu-sm transition hover:shadow-neu active:shadow-neu-inset-sm disabled:opacity-40"
      >
        {busy ? <span className="size-2 animate-pulse rounded-full bg-accent" /> : <PlusIcon />}
      </button>

      {open && (
        <ul role="menu" className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl bg-paper p-2 shadow-neu">
          {missing.map((s) => (
            <li key={s.kind} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  kind.current = s.kind;
                  setOpen(false);
                  input.current?.click();
                }}
                className="w-full rounded-xl px-3 py-2 text-left text-sm transition hover:shadow-neu-sm"
              >
                {s.label}
                <span className="block text-xs text-muted">PDF or photo</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}

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
  }, [messages, stage]);

  const ready = docs.some((d) => d.status === "ready");
  const has = (kind: DocKind) => docs.some((d) => d.kind === kind && d.status === "ready");
  const reviewable = has("policy") && has("rejection");
  const latestVerdict = messages.filter((m) => m.meta?.verdict).at(-1);
  const terms = docs.find((d) => d.kind === "policy")?.key_terms ?? [];
  const letter = docs.find((d) => d.kind === "rejection")?.key_terms ?? [];

  async function removeDoc(id: string) {
    await api(`/api/documents/${id}`, { method: "DELETE" });
    await load();
  }

  async function ask(text: string, review = false) {
    if (!text.trim() || streaming || !ready) return;
    setQuestion("");
    setError(null);
    setStreaming(true);
    setStage(STAGE_LABEL.start);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "user", content: text, citations: null },
    ]);

    try {
      const res = await fetch(`/api/cases/${caseId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, review }),
      });

      // A rejected request (429, 404, validation) answers with JSON, not SSE.
      if (!res.ok || !res.headers.get("content-type")?.includes("event-stream")) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply: Msg | null = null;

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

          // The agent streams what it's doing, step by step, and the answer
          // arrives whole once it has decided.
          if (event.type === "stage") setStage(STAGE_LABEL[event.stage] ?? event.stage);
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "done")
            reply = {
              id: `local-a-${Date.now()}`,
              role: "assistant",
              content: event.content,
              citations: event.citations as Citation[],
              meta: { verdict: event.verdict, questionnaire: event.questionnaire },
            };
        }
      }

      if (reply) setMessages((m) => [...m, reply!]);
      window.dispatchEvent(new Event(REFRESH));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStreaming(false);
      setStage(null);
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
                {reviewable && (
                  <button
                    type="button"
                    onClick={() => void ask(REVIEW, true)}
                    className="mt-6 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
                  >
                    Review this rejection
                  </button>
                )}
                <p className="mt-6 text-muted">Or ask something specific:</p>
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
                  {m.meta?.verdict && <VerdictBadge verdict={m.meta.verdict.verdict} />}
                  <AnswerText content={m.content} citations={m.citations} />
                  {/* The appeal is built from the latest verdict, so only that one offers it. */}
                  {m.id === latestVerdict?.id && latestVerdict.meta?.verdict?.verdict === "challengeable" && (
                    <a
                      href={`/api/cases/${caseId}/appeal`}
                      className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
                    >
                      Download the appeal letter (PDF)
                    </a>
                  )}
                  {/* Only the latest message's questions are still open. */}
                  {m.meta?.questionnaire && m === messages.at(-1) && !streaming && (
                    <QuestionnaireForm questionnaire={m.meta.questionnaire} onSubmit={(t) => void ask(t, true)} />
                  )}
                </div>
              </li>
            ),
          )}

          {streaming && (
            <li className="flex gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-accent shadow-neu-inset-sm">
                OT
              </span>
              <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                {stage}…
              </p>
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
          <AttachMenu
            caseId={caseId}
            missing={SLOTS.filter((s) => !docs.some((d) => d.kind === s.kind))}
            onUploaded={load}
            onError={setError}
          />
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
