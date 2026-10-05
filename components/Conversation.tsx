"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api, type Chat, type Citation, type Doc, type KeyTerm, type Msg } from "@/lib/client";
import { AnswerText } from "./CitationChip";
import { REFRESH } from "./Sidebar";

const STAGE_LABEL: Record<string, string> = {
  rewrite: "reading the conversation",
  retrieve: "searching the lease",
  gate: "checking the question is about the lease",
  rerank: "ranking clauses",
  grade: "checking the clauses answer it",
  retry: "widening the search",
  answer: "writing",
};

/** One deliberately unanswerable prompt, so the refusal gets discovered by
 *  anyone who clicks around rather than only by someone who knows to look. */
const SUGGESTIONS = [
  "Can my landlord keep my deposit for normal wear and tear?",
  "How much notice do I have to give before moving out?",
  "Am I allowed to keep a python?",
];

export default function Conversation({ chatId }: { chatId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<KeyTerm[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api<{ chat: Chat; messages: Msg[] }>(`/api/chats/${chatId}`)
      .then((d) => {
        setMessages(d.messages);
        // The card only shows on an empty chat, so only an empty chat fetches it.
        // A failure here costs a nice-to-have, not the conversation.
        if (d.chat.document_id && d.messages.length === 0)
          void api<Doc>(`/api/documents/${d.chat.document_id}`)
            .then((doc) => setTerms(doc.key_terms ?? []))
            .catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [chatId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft, stage]);

  async function ask(text: string) {
    if (!text.trim() || streaming) return;
    setQuestion("");
    setError(null);
    setStreaming(true);
    setStage("searching the lease");
    setDraft("");
    setCitations([]);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "user", content: text, citations: null },
    ]);

    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
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
        {messages.length === 0 && !streaming && (
          <div className="mt-16 max-w-lg">
            <div className="mb-5 flex size-11 items-center justify-center rounded-2xl text-accent shadow-neu-sm">
              <svg viewBox="0 0 24 24" fill="none" className="size-5">
                <path
                  d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path d="M9.5 12h5M9.5 15.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h1 className="font-serif text-2xl">What does your lease say?</h1>
            {terms.length > 0 && (
              <section aria-labelledby="glance" className="mt-6 rounded-2xl p-5 shadow-neu-sm">
                <h2 id="glance" className="text-xs font-medium uppercase tracking-wide text-muted">
                  At a glance
                </h2>
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
            )}
            <p className="mt-2 text-muted">Try one of these:</p>
            <ul className="mt-5 space-y-3">
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
          </div>
        )}

        <ol className="space-y-8">
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
                  LL
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
                LL
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
            placeholder="Ask about a clause, a deadline, a deposit…"
            disabled={streaming}
            className="flex-1 rounded-full px-4 py-3 text-sm text-ink shadow-neu-inset outline-none placeholder:text-muted disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || !question.trim()}
            aria-label="Ask"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-4">
              <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="mx-auto max-w-3xl px-6 pb-3 text-xs text-muted">
          Information from your document, not legal advice.
        </p>
      </form>
    </div>
  );
}
