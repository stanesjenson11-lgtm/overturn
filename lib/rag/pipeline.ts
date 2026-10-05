import { genAI, ANSWER_MODEL, addUsage, withRetry, type Usage } from "../llm";
import { ANSWER_SYSTEM, userTurn } from "./prompt";
import { grade } from "./grade";
import { rerank } from "./rerank";
import { hybridSearch, OFF_TOPIC_THRESHOLD } from "./search";
import { rewriteQuery } from "./rewrite";
import { toCitations, type Citation, type Clause, type Span } from "./types";

export type Turn = { role: "user" | "assistant"; content: string };

export type PipelineEvent =
  | { type: "stage"; stage: string; ms: number }
  | { type: "text"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; content: string; citations: Citation[]; usage: Usage; spans: Span[] }
  | { type: "error"; message: string };

const CANDIDATES = 25;
const KEEP = 5;

// Phrased like every other decline ("does not address") so the UI, the eval's
// refusal metric and the user all read it the same way.
export const OFF_TOPIC_REPLY =
  "This lease does not address that. It doesn't look like a question about the lease, so I didn't search any further. Try asking about rent, the deposit, notice, repairs, or anything else the lease covers.";

/**
 * rewrite → retrieve → rerank → grade → (retry once) → answer.
 *
 * An async generator rather than a callback soup: the route handler's only job
 * becomes turning these events into SSE frames, and the eval harness drains the
 * same generator with no HTTP involved. One pipeline, two consumers.
 */
export async function* answerQuestion(opts: {
  userId: string;
  documentId: string;
  question: string;
  history: Turn[];
}): AsyncGenerator<PipelineEvent> {
  const spans: Span[] = [];
  let usage: Usage = { in: 0, out: 0 };
  const clock = () => {
    const t = Date.now();
    return (stage: string, note?: string): Span => {
      const span = { stage, ms: Date.now() - t, note };
      spans.push(span);
      return span;
    };
  };

  try {
    // ---- 1. rewrite
    let stop = clock();
    const { query, usage: u1, rewritten } = await rewriteQuery(opts.question, opts.history);
    usage = addUsage(usage, u1);
    yield { type: "stage", ...stop("rewrite", rewritten ? query : undefined) };

    // ---- 2. retrieve (both halves tenant-scoped in SQL)
    stop = clock();
    const found = await hybridSearch(opts.userId, opts.documentId, query, CANDIDATES);
    let candidates: Clause[] = found.clauses;
    yield { type: "stage", ...stop("retrieve", `${candidates.length} candidates`) };

    // ---- 2b. off-topic gate: nothing in the lease is even close, so rerank,
    // grade and answer would spend three or four calls to say the same thing.
    if (found.topScore < OFF_TOPIC_THRESHOLD) {
      yield { type: "stage", ...clock()("gate", `off-topic, top score ${found.topScore.toFixed(3)}`) };
      yield { type: "citations", citations: [] };
      yield { type: "done", content: OFF_TOPIC_REPLY, citations: [], usage, spans };
      return;
    }

    // ---- 3. rerank
    stop = clock();
    let { clauses, usage: u2 } = await rerank(query, candidates, KEEP);
    usage = addUsage(usage, u2);
    yield { type: "stage", ...stop("rerank", `${clauses.length} kept`) };

    // ---- 4. grade, and at most one corrective retry
    stop = clock();
    const verdict = await grade(query, clauses);
    usage = addUsage(usage, verdict.usage);
    yield { type: "stage", ...stop("grade", verdict.sufficient ? "sufficient" : "retrying") };

    if (!verdict.sufficient) {
      stop = clock();
      const { clauses: widened } = await hybridSearch(
        opts.userId,
        opts.documentId,
        verdict.searchFor,
        CANDIDATES,
      );
      // Union, not replacement: the first pass may already hold the answer, and
      // the grader is a heuristic, not an oracle.
      const seen = new Set(clauses.map((c) => c.id));
      candidates = [...clauses, ...widened.filter((c) => !seen.has(c.id))];
      const second = await rerank(verdict.searchFor, candidates, KEEP);
      usage = addUsage(usage, second.usage);
      clauses = second.clauses;
      yield { type: "stage", ...stop("retry", `${clauses.length} kept`) };
    }

    const citations = toCitations(clauses);
    yield { type: "citations", citations };

    // ---- 5. answer
    stop = clock();
    const stream = await withRetry(() => genAI().models.generateContentStream({
      model: ANSWER_MODEL,
      config: {
        systemInstruction: ANSWER_SYSTEM,
        maxOutputTokens: 4000,
        // No thinkingConfig override here: the answer stage is the one call
        // where reasoning about what the clauses do and don't cover earns its
        // latency, so it keeps the model's own default budget rather than the
        // thinkingBudget: 0 the utility calls use.
      },
      // Gemini's roles are "user"/"model", not "user"/"assistant" — mapped here
      // rather than threading a second role vocabulary through the app.
      contents: [
        ...opts.history
          .slice(-4)
          .map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.content }] })),
        { role: "user" as const, parts: [{ text: userTurn(opts.question, clauses) }] },
      ],
    }));

    let content = "";
    let finishReason: string | undefined;
    let outTokens = 0;
    let inTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) {
        content += delta;
        yield { type: "text", text: delta };
      }
      finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      inTokens = chunk.usageMetadata?.promptTokenCount ?? inTokens;
      outTokens = chunk.usageMetadata?.candidatesTokenCount ?? outTokens;
    }

    // Checked before trusting `content`: SAFETY/PROHIBITED_CONTENT/RECITATION
    // mean the model declined or was blocked mid-stream, and what did arrive is
    // not a usable answer — persisting it would put nonsense in the chat.
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      yield { type: "error", message: "The model declined to answer this question." };
      return;
    }
    usage = addUsage(usage, { in: inTokens, out: outTokens });
    yield { type: "stage", ...stop("answer", `${outTokens} tokens`) };

    // Only chips the answer actually referenced. An unused clause in the
    // sidebar reads as a claim the answer never made.
    const cited = new Set(
      [...content.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
    );
    const used = citations.filter((c) => cited.has(c.id));

    yield {
      type: "done",
      content,
      citations: used.length ? used : citations,
      usage,
      spans,
    };
  } catch (e) {
    console.error("pipeline failed:", e);
    yield {
      type: "error",
      message:
        "I couldn't reach the model just now. Your question wasn't lost — try sending it again.",
    };
  }
}
