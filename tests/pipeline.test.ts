import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { EMBED_DIM } from "@/lib/rag/embed";

// Google is the only thing in the retrieval path that leaves the process.
// Every query points straight at the deposit clause (the direction of
// fakeEmbedding(1), cosine 1) so it clears the off-topic gate on purpose; an
// off-topic question gets a vector orthogonal-ish to every clause.
vi.mock("@/lib/rag/embed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rag/embed")>()),
  embed: async (texts: string[]) =>
    texts.map((t) =>
      Array.from({ length: EMBED_DIM }, (_, i) =>
        /capital of France/.test(t) ? (i % 2 ? -1 : 1) : Math.sin(7.3 + i * 0.017),
      ),
    ),
}));

const { setGenAI } = await import("@/lib/llm");
const { answerQuestion } = await import("@/lib/rag/pipeline");
const { createDocument, insertChunks } = await import("@/lib/db/queries");
const { startTestDb, stopTestDb, fakeEmbedding } = await import("./db");

const USER = "c0ffee00-0000-4000-8000-000000000001";

type FakeOpts = {
  answer?: string;
  sufficient?: boolean;
  finishReason?: string;
  throws?: boolean;
};

function fakeGemini(opts: FakeOpts = {}) {
  const answer = opts.answer ?? "The deposit is returned within 30 days [1].";
  let graded = 0;

  return {
    models: {
      // structured() calls for rerank + grade, told apart by their system
      // instruction; rewrite/title calls also land here with no schema.
      generateContent: async (req: { config?: { systemInstruction?: string } }) => {
        const system = req.config?.systemInstruction ?? "";
        const usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 5 };

        if (system.startsWith("You score")) {
          return {
            text: JSON.stringify({ scores: [{ index: 1, score: 9 }, { index: 2, score: 4 }] }),
            usageMetadata,
            candidates: [{ finishReason: "STOP" }],
          };
        }
        if (system.startsWith("You judge")) {
          // Only the first grade reports insufficiency. If the pipeline asked
          // again it would get "sufficient" — so a second retry span appearing
          // would mean the loop, not the grader, decided to keep going.
          const sufficient = opts.sufficient === false ? graded++ > 0 : true;
          return {
            text: JSON.stringify({ sufficient, search_for: "deposit return" }),
            usageMetadata,
            candidates: [{ finishReason: "STOP" }],
          };
        }
        // rewrite and titleFor — plain text
        return { text: "standalone query", usageMetadata, candidates: [{ finishReason: "STOP" }] };
      },
      generateContentStream: async () => {
        if (opts.throws) throw new Error("upstream is down");
        const pieces = answer.match(/.{1,10}/g) ?? [];
        return {
          async *[Symbol.asyncIterator]() {
            for (const [i, piece] of pieces.entries()) {
              yield {
                text: piece,
                candidates: i === pieces.length - 1 ? [{ finishReason: opts.finishReason ?? "STOP" }] : [],
                usageMetadata:
                  i === pieces.length - 1
                    ? { promptTokenCount: 500, candidatesTokenCount: 40 }
                    : undefined,
              };
            }
          },
        };
      },
    },
  } as any;
}

let db: PGlite;
let documentId: string;

beforeAll(async () => {
  db = await startTestDb();
  await db.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, [
    USER,
    "pipeline@example.com",
  ]);
  const doc = await createDocument(USER, "lease.pdf");
  documentId = doc.id;

  await insertChunks(USER, documentId, [
    {
      ordinal: 0,
      headingPath: "8. SECURITY DEPOSIT",
      pageStart: 6,
      pageEnd: 6,
      content: "Landlord shall return the security deposit within 30 days of surrender.",
      embedding: fakeEmbedding(1),
    },
    {
      ordinal: 1,
      headingPath: "12. PETS",
      pageStart: 9,
      pageEnd: 9,
      content: "Tenant may keep up to two cats or dogs under 25 pounds with written consent.",
      embedding: fakeEmbedding(2),
    },
  ]);
});

afterAll(async () => {
  setGenAI(undefined);
  await stopTestDb(db);
});

const drain = async (events: AsyncGenerator<any>) => {
  const out: any[] = [];
  for await (const e of events) out.push(e);
  return out;
};

const run = (question = "when do I get my deposit back?", history: any[] = []) =>
  drain(answerQuestion({ userId: USER, documentId, question, history }));

describe("the pipeline", () => {
  it("streams an answer with citations attached", async () => {
    setGenAI(fakeGemini());
    const events = await run();

    expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(1);

    const citations = events.find((e) => e.type === "citations");
    expect(citations.citations[0]).toMatchObject({ id: 1, pageStart: 6 });

    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.content).toContain("[1]");
    expect(done.usage.out).toBeGreaterThan(0);
  });

  it("skips the rewrite call on the first question of a chat", async () => {
    setGenAI(fakeGemini());
    const first = await run();
    expect(first.find((e) => e.stage === "rewrite").note).toBeUndefined();

    const later = await run("what about two of them?", [
      { role: "user", content: "can I keep a cat?" },
      { role: "assistant", content: "Yes, with consent [1]." },
    ]);
    // With history there IS something to fold in, so the call happens and the
    // rewritten query is recorded on the span.
    expect(later.find((e) => e.stage === "rewrite").note).toBe("standalone query");
  });

  it("retries once when the grader says retrieval was thin, and only once", async () => {
    setGenAI(fakeGemini({ sufficient: false }));
    const events = await run();

    const retries = events.filter((e) => e.type === "stage" && e.stage === "retry");
    expect(retries).toHaveLength(1);
    expect(events.at(-1).type).toBe("done");
  });

  it("drops only the citations the answer never referenced", async () => {
    setGenAI(fakeGemini({ answer: "Only the first clause matters [1]." }));
    const done = (await run()).at(-1);
    expect(done.citations.map((c: any) => c.id)).toEqual([1]);
  });

  it("reports a refusal instead of persisting the content blocks", async () => {
    setGenAI(fakeGemini({ finishReason: "SAFETY" }));
    const events = await run();

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("fails soft when the model is unreachable", async () => {
    setGenAI(fakeGemini({ throws: true }));
    const events = await run();

    // A friendly event, not a thrown exception: the route turns these into SSE
    // frames, and an exception mid-stream reaches the browser as a dead socket.
    expect(events.at(-1).type).toBe("error");
    expect(events.at(-1).message).toMatch(/try sending it again/i);
  });

  it("declines an off-topic question without a single model call", async () => {
    let calls = 0;
    const fake = fakeGemini();
    setGenAI({
      models: {
        generateContent: async (req: any) => (calls++, fake.models.generateContent(req)),
        generateContentStream: async () => (calls++, fake.models.generateContentStream()),
      },
    } as any);

    const events = await run("What is the capital of France?");
    const done = events.at(-1);

    expect(done.type).toBe("done");
    expect(done.content).toMatch(/does not address/);
    expect(done.citations).toEqual([]);
    expect(done.spans.map((s: any) => s.stage)).toEqual(["rewrite", "retrieve", "gate"]);
    // First message: no rewrite call, and the gate stops rerank, grade, answer.
    expect(calls).toBe(0);
  });

  it("records a span for every stage it ran", async () => {
    setGenAI(fakeGemini());
    const done = (await run()).at(-1);
    expect(done.spans.map((s: any) => s.stage)).toEqual([
      "rewrite",
      "retrieve",
      "rerank",
      "grade",
      "answer",
    ]);
  });
});
