import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as listDocs, POST as uploadDoc } from "@/app/api/documents/route";
import { GET as getDoc, DELETE as deleteDoc } from "@/app/api/documents/[id]/route";
import { GET as listCasesRoute, POST as newCase } from "@/app/api/cases/route";
import { GET as getCaseRoute, DELETE as deleteCaseRoute } from "@/app/api/cases/[id]/route";
import { POST as ask } from "@/app/api/cases/[id]/messages/route";
import { GET as appeal } from "@/app/api/cases/[id]/appeal/route";
import {
  createCase,
  createDocument,
  denseSearch,
  insertChunks,
  insertMessage,
  keywordSearch,
  listCaseDocuments,
  listMessages,
  setDocumentStatus,
} from "@/lib/db/queries";
import { fakeEmbedding, startTestDb, stopTestDb } from "./db";

/**
 * THE MOST IMPORTANT FILE IN THE REPO.
 *
 * Each `it` is a distinct attack, not a variation of one. They all rest on the
 * same claim: a resource id supplied by the client selects *within* the caller's
 * tenant and can never reach outside it — so someone else's id matches zero
 * rows, and the route answers 404 rather than confirming the thing exists.
 */

let db: PGlite;
type Actor = { id: string; cookie: string; docId: string; caseId: string };
let A: Actor;
let B: Actor;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (path: string, cookie?: string) =>
  new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const upload = (caseId: string, cookie?: string) => {
  const body = new FormData();
  body.append("file", new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }));
  body.append("caseId", caseId);
  body.append("kind", "medical");
  return new Request("http://localhost/api/documents", {
    method: "POST",
    body,
    headers: cookie ? { cookie } : {},
  });
};

async function makeActor(email: string, seed: number): Promise<Actor> {
  const res = await register(post("/api/auth/register", { email, password: "a-long-password", consent: true }));
  const { id } = (await res.json()) as { id: string };
  const cookie = res.headers.get("set-cookie")!.split(";")[0];

  const claim = await createCase(id, `${email} claim`);
  const doc = await createDocument(id, claim.id, "policy", `${email}-policy.pdf`);
  await insertChunks(id, doc.id, [
    {
      ordinal: 0,
      headingPath: "4.1 PRE-EXISTING DISEASES",
      pageStart: 1,
      pageEnd: 1,
      content: `Pre-existing diseases for ${email} are covered after thirty-six months of continuous cover.`,
      embedding: fakeEmbedding(seed),
    },
  ]);
  await setDocumentStatus(id, doc.id, "ready", { pageCount: 1 });
  await insertMessage(id, claim.id, "user", `secret question from ${email}`);

  return { id, cookie, docId: doc.id, caseId: claim.id };
}

beforeAll(async () => {
  db = await startTestDb();
  A = await makeActor("a@example.com", 1);
  B = await makeActor("b@example.com", 2);
});
afterAll(async () => stopTestDb(db));

describe("an anonymous request", () => {
  it("cannot list documents or cases", async () => {
    expect((await listDocs(get("/api/documents"))).status).toBe(401);
    expect((await listCasesRoute(get("/api/cases"))).status).toBe(401);
  });

  it("cannot upload", async () => {
    expect((await uploadDoc(upload(A.caseId))).status).toBe(401);
  });

  it("cannot forge a session by editing the cookie", async () => {
    const forged = `ls_session=${A.cookie.split("=")[1].slice(0, -3)}aaa`;
    expect((await listDocs(get("/api/documents", forged))).status).toBe(401);
  });
});

describe("user B, holding user A's ids", () => {
  it("cannot read A's document", async () => {
    const res = await getDoc(get(`/api/documents/${A.docId}`, B.cookie), ctx(A.docId));
    // 404, not 403: a 403 would confirm the document exists and belongs to
    // someone. This response tells B nothing at all.
    expect(res.status).toBe(404);
  });

  it("cannot delete A's document", async () => {
    const res = await deleteDoc(get(`/api/documents/${A.docId}`, B.cookie), ctx(A.docId));
    expect(res.status).toBe(404);

    // And A still has it — the failed delete must not have half-succeeded.
    expect((await getDoc(get(`/api/documents/${A.docId}`, A.cookie), ctx(A.docId))).status).toBe(
      200,
    );
  });

  it("cannot read A's case", async () => {
    const res = await getCaseRoute(get(`/api/cases/${A.caseId}`, B.cookie), ctx(A.caseId));
    expect(res.status).toBe(404);
  });

  it("cannot read A's messages", async () => {
    // Straight at the query layer: even the function that lists messages is
    // scoped, so there is no "internal" call that would return them.
    expect(await listMessages(B.id, A.caseId)).toEqual([]);
    expect((await listMessages(A.id, A.caseId)).length).toBe(1);
  });

  it("cannot post a question into A's case", async () => {
    const res = await ask(
      post(`/api/cases/${A.caseId}/messages`, { question: "why was A's claim rejected?" }, B.cookie),
      ctx(A.caseId),
    );
    expect(res.status).toBe(404);
    // Nothing was written into A's case on the way to that 404.
    expect((await listMessages(A.id, A.caseId)).length).toBe(1);
  });

  it("cannot delete A's case", async () => {
    const res = await deleteCaseRoute(get(`/api/cases/${A.caseId}`, B.cookie), ctx(A.caseId));
    expect(res.status).toBe(404);

    // A's case, its documents and its messages survived the attempt intact.
    expect((await getCaseRoute(get(`/api/cases/${A.caseId}`, A.cookie), ctx(A.caseId))).status).toBe(
      200,
    );
    expect((await listCaseDocuments(A.id, A.caseId)).length).toBe(1);
    expect((await listMessages(A.id, A.caseId)).length).toBe(1);
  });

  it("cannot download an appeal letter built from A's case", async () => {
    const res = await appeal(get(`/api/cases/${A.caseId}/appeal`, B.cookie), ctx(A.caseId));
    expect(res.status).toBe(404);
    // And A gets a refusal, not an empty letter, until a verdict says challengeable.
    const own = await appeal(get(`/api/cases/${A.caseId}/appeal`, A.cookie), ctx(A.caseId));
    expect(own.status).toBe(400);
  });

  it("cannot file a document into A's case", async () => {
    // The case id arrives in the upload's form body, the one place a case id
    // legitimately comes from the client. A document filed there would be
    // quoted in A's next answer.
    const res = await uploadDoc(upload(A.caseId, B.cookie));
    expect(res.status).toBe(404);
    expect((await listCaseDocuments(A.id, A.caseId)).length).toBe(1);
  });

  it("cannot retrieve over A's chunks, even smuggled in beside its own", async () => {
    // Both halves of the hybrid, because a tenant filter on only one of them is
    // the same as none.
    expect(await denseSearch(B.id, [A.docId], fakeEmbedding(1), 10)).toEqual([]);
    expect(await keywordSearch(B.id, [A.docId], "pre-existing diseases", 10)).toEqual([]);

    // The list form is new with multi-document cases: A's id riding along with
    // B's own must still match only B's rows.
    const mixed = await denseSearch(B.id, [B.docId, A.docId], fakeEmbedding(1), 10);
    expect(mixed.map((r) => r.content)).toEqual([expect.stringContaining("b@example.com")]);
    const mixedKw = await keywordSearch(B.id, [B.docId, A.docId], "pre-existing diseases", 10);
    expect(mixedKw.map((r) => r.content)).toEqual([expect.stringContaining("b@example.com")]);

    // Sanity: the same searches DO return A's chunk for A. Otherwise this test
    // would pass against an empty table.
    expect((await denseSearch(A.id, [A.docId], fakeEmbedding(1), 10)).length).toBe(1);
    expect((await keywordSearch(A.id, [A.docId], "pre-existing diseases", 10)).length).toBe(1);
  });

  it("sees none of A's documents or cases in their own listings", async () => {
    const docs = (await (await listDocs(get("/api/documents", B.cookie))).json()) as {
      id: string;
    }[];
    const cases = (await (await listCasesRoute(get("/api/cases", B.cookie))).json()) as {
      id: string;
    }[];

    expect(docs.map((d) => d.id)).toEqual([B.docId]);
    expect(cases.map((c) => c.id)).toEqual([B.caseId]);
  });
});

describe("a well-formed id that belongs to nobody", () => {
  it("is also a 404, indistinguishable from someone else's", async () => {
    const nowhere = "00000000-0000-4000-8000-000000000000";
    const missing = await getDoc(get(`/api/documents/${nowhere}`, B.cookie), ctx(nowhere));
    const theirs = await getDoc(get(`/api/documents/${A.docId}`, B.cookie), ctx(A.docId));

    expect(missing.status).toBe(theirs.status);
    expect(await missing.json()).toEqual(await theirs.json());
  });

  it("and so is a malformed case id on upload", async () => {
    const malformed = await uploadDoc(upload("not-a-uuid", B.cookie));
    const theirs = await uploadDoc(upload(A.caseId, B.cookie));
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual(await theirs.json());
  });
});

/**
 * The failure mode the SQL tests cannot see: correct rows, correct session,
 * and then the response gets stored and replayed to whoever sits down next.
 * Every one of these responses is tenant-specific, so none of them may be
 * cacheable — and a cache that ignores that must still key on the cookie.
 */
describe("every response", () => {
  it("forbids caching and varies on the cookie", async () => {
    const responses = [
      await listDocs(get("/api/documents", A.cookie)),
      await listCasesRoute(get("/api/cases", A.cookie)),
      await getCaseRoute(get(`/api/cases/${A.caseId}`, A.cookie), ctx(A.caseId)),
      // The 401 too: a stored "Not signed in." is a smaller problem than a
      // stored claim, but a stored 200 is the same code path.
      await listCasesRoute(get("/api/cases")),
    ];

    for (const res of responses) {
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("vary")).toContain("Cookie");
    }
  });
});

describe("a user deleting their own case", () => {
  it("removes it with its documents and messages, and 404s the second time", async () => {
    const doomed = await createCase(B.id, "throwaway");
    await createDocument(B.id, doomed.id, "rejection", "letter.pdf");
    await insertMessage(B.id, doomed.id, "user", "delete me");

    const res = await deleteCaseRoute(get(`/api/cases/${doomed.id}`, B.cookie), ctx(doomed.id));
    expect(res.status).toBe(200);

    expect(await listMessages(B.id, doomed.id)).toEqual([]);
    expect(await listCaseDocuments(B.id, doomed.id)).toEqual([]);
    const gone = await getCaseRoute(get(`/api/cases/${doomed.id}`, B.cookie), ctx(doomed.id));
    expect(gone.status).toBe(404);

    // And the delete stayed inside B's tenant — A is untouched.
    expect((await listMessages(A.id, A.caseId)).length).toBe(1);
  });
});

describe("opening a new case", () => {
  it("sweeps the caller's never-used cases, and reaches no further", async () => {
    const empty1 = await createCase(B.id, null);
    const empty2 = await createCase(B.id, null);

    // Used two different ways, to prove the sweep means "nothing in it" and not
    // "no title": one has a document but no question yet, one has a question.
    const withDoc = await createCase(B.id, null);
    await createDocument(B.id, withDoc.id, "policy", "policy.pdf");
    const withQuestion = await createCase(B.id, null);
    await insertMessage(B.id, withQuestion.id, "user", "a real question");

    // A has an empty case too. The sweep is a DELETE, so if it were unscoped
    // this is where that shows up.
    const aEmpty = await createCase(A.id, null);

    const res = await newCase(post("/api/cases", {}, B.cookie));
    expect(res.status).toBe(201);
    const fresh = (await res.json()) as { id: string; title: string };

    // Named as a draft, numbered past the cases B has. Another "New case" now
    // sweeps this still-empty draft and may reuse its number, but no two live
    // cases ever share a name.
    expect(fresh.title).toMatch(/^Draft case \d+$/);
    // (The untitled ones are created directly in this test; the route always names a case.)
    const titles = ((await (await listCasesRoute(get("/api/cases", B.cookie))).json()) as {
      title: string | null;
    }[]).flatMap((c) => (c.title ? [c.title] : []));
    expect(new Set(titles).size).toBe(titles.length);

    const mine = ((await (await listCasesRoute(get("/api/cases", B.cookie))).json()) as {
      id: string;
    }[]).map((c) => c.id);

    expect(mine).not.toContain(empty1.id);
    expect(mine).not.toContain(empty2.id);
    // Used ones survive — and so does the case just handed back, which was
    // created after the sweep and is empty by definition.
    expect(mine).toContain(withDoc.id);
    expect(mine).toContain(withQuestion.id);
    expect(mine).toContain(fresh.id);

    const theirs = ((await (await listCasesRoute(get("/api/cases", A.cookie))).json()) as {
      id: string;
    }[]).map((c) => c.id);
    expect(theirs).toContain(aEmpty.id);
  });
});
