import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { EMBED_DIM } from "@/lib/rag/embed";

// Every query points at seed 1's direction, so retrieval is deterministic.
vi.mock("@/lib/rag/embed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rag/embed")>()),
  embed: async (texts: string[]) =>
    texts.map(() => Array.from({ length: EMBED_DIM }, (_, i) => Math.sin(7.3 + i * 0.017))),
}));

const { setGenAI } = await import("@/lib/llm");
const { reviewCase, MAX_STEPS } = await import("@/lib/agent");
const { createCase, createDocument, insertChunks, replaceRegulation } = await import("@/lib/db/queries");
const { startTestDb, stopTestDb, fakeEmbedding } = await import("./db");

const USER = "c0ffee00-0000-4000-8000-000000000003";
let db: PGlite;
let documentIds: string[];

type Part = Record<string, unknown>;
const call = (name: string, args: Record<string, unknown> = {}): Part => ({ functionCall: { name, args } });

/** A model that plays back one scripted turn per call, and records what it was sent. */
function scripted(turns: Part[][], opts: { throws?: boolean } = {}) {
  const requests: any[] = [];
  setGenAI({
    models: {
      generateContent: async (req: any) => {
        requests.push(structuredClone(req));
        if (opts.throws) throw new Error("upstream is down");
        return {
          candidates: [{ content: { role: "model", parts: turns.shift() ?? [{ text: "Done." }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    },
  } as any);
  return requests;
}

/** The tool responses the agent sent back in a given request. */
const responsesIn = (req: any) =>
  req.contents.at(-1).parts.map((p: any) => p.functionResponse?.response);

const run = async (question = "Review this rejection.", history: any[] = []) => {
  const events: any[] = [];
  for await (const e of reviewCase({
    userId: USER,
    documentIds,
    question,
    history,
    facts: {
      letter: [{ field: "claim_number", label: "Claim no.", value: "SH/CLM/2025/004512", page: 1 }],
      policy: [],
    },
  }))
    events.push(e);
  return events;
};

beforeAll(async () => {
  db = await startTestDb();
  await db.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'agent@example.com', 'x')`, [USER]);
  const claim = await createCase(USER, null);
  const policy = await createDocument(USER, claim.id, "policy", "policy.pdf");
  // Fewer passages than the reranker keeps, so it never needs a model call.
  await insertChunks(USER, policy.id, [
    {
      ordinal: 0,
      headingPath: "3.2 PRE-EXISTING DISEASES",
      pageStart: 1,
      pageEnd: 1,
      content: "Pre-existing diseases declared in the proposal are covered after 36 months of Continuous Coverage.",
      embedding: fakeEmbedding(1),
    },
  ]);
  documentIds = [policy.id];
  await replaceRegulation("products-2024", "IRDAI (Insurance Products) Regulations, 2024", [
    {
      ordinal: 0,
      headingPath: "8. Moratorium",
      pageStart: 37,
      pageEnd: 37,
      content: "After completion of sixty continuous months of coverage no claim shall be contestable.",
      embedding: fakeEmbedding(1),
    },
  ]);
});
afterAll(async () => {
  setGenAI(undefined);
  await stopTestDb(db);
});

describe("the agent loop", () => {
  it("hands the model the case facts, then searches the case's own documents", async () => {
    const requests = scripted([
      [call("search_policy", { query: "pre-existing disease waiting period" })],
      [{ text: "Clause 3.2 covers declared conditions after 36 months [P1]." }],
    ]);
    const events = await run();

    expect(requests[0].contents.at(-1).parts[0].text).toMatch(/CASE FACTS[\s\S]*Claim no\.: SH\/CLM\/2025\/004512/);
    const [found] = responsesIn(requests[1]);
    expect(found.passages[0]).toMatchObject({ id: "P1", heading: "3.2 PRE-EXISTING DISEASES" });

    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.citations).toEqual([expect.objectContaining({ id: "P1", source: "policy" })]);
    expect(events.filter((e) => e.type === "stage").map((e) => e.stage)).toEqual(["search_policy", "answer"]);
  });

  it("labels regulations R… and keeps one id for a passage retrieved twice", async () => {
    const requests = scripted([
      [call("search_regulations", { query: "moratorium" })],
      [call("search_regulations", { query: "sixty months non-disclosure" })],
      [{ text: "Sixty months of cover ends contestability [R1]." }],
    ]);
    const done = (await run()).at(-1);

    expect(responsesIn(requests[1])[0].passages[0].id).toBe("R1");
    expect(responsesIn(requests[2])[0].passages[0].id).toBe("R1");
    expect(done.citations).toEqual([
      expect.objectContaining({ id: "R1", source: "regulation", document: expect.stringMatching(/Insurance Products/) }),
    ]);
  });

  it("runs rule checks, and answers a bad date with an error it can recover from", async () => {
    const requests = scripted([
      [call("check_rules", { rule: "moratorium", coverageStart: "2019-03-01", admissionDate: "02/10/2025" })],
      [call("check_rules", { rule: "moratorium", coverageStart: "2019-03-01", admissionDate: "2025-10-02" })],
      [{ text: "Done." }],
    ]);
    await run("Review this. My cover started on 2019-03-01 and I was admitted on 02/10/2025.");

    expect(responsesIn(requests[1])[0].error).toMatch(/YYYY-MM-DD/);
    expect(responsesIn(requests[2])[0]).toMatchObject({ rule: "moratorium", holds: true, months: 79 });
  });

  it("refuses a rule input nobody stated, like a start date guessed from a policy number", async () => {
    const requests = scripted([
      [call("check_rules", { rule: "moratorium", coverageStart: "2019-01-01", admissionDate: "2025-10-02" })],
      [{ text: "Done." }],
    ]);
    const done = (await run("Review this. Policy SH/IND/2019/118230; admitted 02/10/2025.")).at(-1);

    expect(responsesIn(requests[1])[0].error).toMatch(/coverageStart 2019-01-01: not stated/);
    expect(done.checks).toEqual([]); // nothing was decided on a guess
  });

  it("stops and hands back control when it asks the user something", async () => {
    const requests = scripted([
      [
        call("ask_questionnaire", {
          intro: "Two dates settle this.",
          questions: [
            { id: "coverage_start", text: "When did your cover first start?", type: "date" },
            { id: "declared", text: "Did you declare the condition?", type: "choice", options: ["Yes", "No"] },
            { text: "" }, // unrenderable, dropped
          ],
        }),
      ],
    ]);
    const done = (await run()).at(-1);

    expect(requests).toHaveLength(1);
    expect(done.content).toBe("Two dates settle this.");
    expect(done.questionnaire.questions.map((q: any) => q.type)).toEqual(["date", "choice"]);
  });

  it("records a verdict, dropping any cite it never handed out", async () => {
    scripted([
      [call("search_policy", { query: "pre-existing" })],
      [
        call("record_verdict", {
          verdict: "challengeable",
          summary: "The moratorium bars this rejection.",
          grounds: [{ point: "The policy covers declared conditions after 36 months.", cites: ["P1", "P9", "R3"] }],
        }),
      ],
    ]);
    const done = (await run()).at(-1);

    expect(done.verdict.verdict).toBe("challengeable");
    expect(done.verdict.grounds[0].cites).toEqual(["P1"]);
    expect(done.content).toContain("[P1]");
    expect(done.content).not.toMatch(/\[P9\]|\[R3\]/);
    expect(done.citations.map((c: any) => c.id)).toEqual(["P1"]);
  });

  it("makes a review end in a tool call, and a question free to answer in prose", async () => {
    let requests = scripted([[{ text: "Done." }]]);
    await run();
    expect(requests[0].config.toolConfig).toBeUndefined();

    requests = scripted([[{ text: "Done." }]]);
    const events: any[] = [];
    for await (const e of reviewCase({ userId: USER, documentIds, question: "Review this.", history: [], review: true }))
      events.push(e);
    expect(requests[0].config.toolConfig.functionCallingConfig.mode).toBe("ANY");
  });

  it("briefs a review with the whole letter and the governing rules before the first call", async () => {
    const requests = scripted([[{ text: "Done." }]]);
    for await (const _ of reviewCase({
      userId: USER,
      documentIds,
      question: "Review this.",
      history: [],
      letterId: documentIds[0],
      review: true,
    }));
    const briefing = requests[0].contents.at(-1).parts[0].text;
    expect(briefing).toMatch(/THE REJECTION LETTER, IN FULL[\s\S]*<passage id="P1"/);
    expect(briefing).toMatch(/IRDAI RULES[\s\S]*<passage id="R1"[^>]*document="IRDAI \(Insurance Products\)/);
  });

  it("reads '[P1, R1]' as two citations, however the model bracketed them", async () => {
    scripted([
      [call("search_policy", { query: "pre-existing" })],
      [call("search_regulations", { query: "moratorium" })],
      [{ text: "Covered after 36 months [P1, R1]." }],
    ]);
    const done = (await run()).at(-1);
    expect(done.content).toContain("[P1][R1]");
    expect(done.citations.map((c: any) => c.id)).toEqual(["P1", "R1"]);
  });

  it("refuses a malformed verdict rather than recording half of one", async () => {
    const requests = scripted([[call("record_verdict", { verdict: "probably fine" })], [{ text: "Done." }]]);
    const done = (await run()).at(-1);
    expect(responsesIn(requests[1])[0].error).toMatch(/challengeable, valid or needs_info/);
    expect(done.verdict).toBeUndefined();
  });

  it("reports an unknown tool instead of throwing", async () => {
    const requests = scripted([[call("delete_claim")], [{ text: "Done." }]]);
    await run();
    expect(responsesIn(requests[1])[0].error).toMatch(/Unknown tool/);
  });

  it("stops at the step cap when the model keeps calling tools", async () => {
    const requests = scripted(Array.from({ length: 20 }, () => [call("search_policy", { query: "again" })]));
    const done = (await run()).at(-1);
    expect(requests).toHaveLength(MAX_STEPS);
    expect(done.content).toMatch(/couldn't finish/);
  });

  it("fails soft when the model is unreachable", async () => {
    scripted([], { throws: true });
    const events = await run();
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/try sending it again/) });
  });
});

describe("what counts as a stated date", () => {
  it("accepts the ways people write a date, and refuses a bare year", async () => {
    const { mentioned } = await import("@/lib/agent");
    expect(mentioned("2019-03-01", "cover since 2019-03-01")).toBe(true);
    expect(mentioned("2019-03-01", "Policy start: 01/03/2019")).toBe(true);
    expect(mentioned("2019-03-01", "started 1/3/2019")).toBe(true);
    expect(mentioned("2019-03-01", "I've been covered since March 2019")).toBe(true);
    expect(mentioned("2019-03-01", "Policy Number: SH/IND/2019/118230")).toBe(false);
  });
});
