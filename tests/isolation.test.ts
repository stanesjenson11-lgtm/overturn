import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as listDocs, POST as uploadDoc } from "@/app/api/documents/route";
import { GET as getDoc, DELETE as deleteDoc } from "@/app/api/documents/[id]/route";
import { GET as listChats, POST as newChat } from "@/app/api/chats/route";
import { GET as getChatRoute, DELETE as deleteChatRoute } from "@/app/api/chats/[id]/route";
import { POST as ask } from "@/app/api/chats/[id]/messages/route";
import { GET as admin } from "@/app/api/admin/route";
import {
  createChat,
  createDocument,
  denseSearch,
  insertChunks,
  insertMessage,
  keywordSearch,
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
type Actor = { id: string; cookie: string; docId: string; chatId: string };
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

async function makeActor(email: string, seed: number): Promise<Actor> {
  const res = await register(post("/api/auth/register", { email, password: "a-long-password" }));
  const { id } = (await res.json()) as { id: string };
  const cookie = res.headers.get("set-cookie")!.split(";")[0];

  const doc = await createDocument(id, `${email}-lease.pdf`);
  await insertChunks(id, doc.id, [
    {
      ordinal: 0,
      headingPath: "8. SECURITY DEPOSIT",
      pageStart: 1,
      pageEnd: 1,
      content: `The deposit for ${email} is held in escrow and returned within 30 days.`,
      embedding: fakeEmbedding(seed),
    },
  ]);
  await setDocumentStatus(id, doc.id, "ready", { pageCount: 1 });

  const chat = await createChat(id, doc.id, `${email} conversation`);
  await insertMessage(id, chat.id, "user", `secret question from ${email}`);

  return { id, cookie, docId: doc.id, chatId: chat.id };
}

beforeAll(async () => {
  db = await startTestDb();
  A = await makeActor("a@example.com", 1);
  B = await makeActor("b@example.com", 2);
});
afterAll(async () => stopTestDb(db));

describe("an anonymous request", () => {
  it("cannot list documents or chats", async () => {
    expect((await listDocs(get("/api/documents"))).status).toBe(401);
    expect((await listChats(get("/api/chats"))).status).toBe(401);
    expect((await admin(get("/api/admin"))).status).toBe(401);
  });

  it("cannot upload", async () => {
    const body = new FormData();
    body.append("file", new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }));
    const req = new Request("http://localhost/api/documents", { method: "POST", body });
    expect((await uploadDoc(req)).status).toBe(401);
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

  it("cannot read A's chat", async () => {
    const res = await getChatRoute(get(`/api/chats/${A.chatId}`, B.cookie), ctx(A.chatId));
    expect(res.status).toBe(404);
  });

  it("cannot read A's messages", async () => {
    // Straight at the query layer: even the function that lists messages is
    // scoped, so there is no "internal" call that would return them.
    expect(await listMessages(B.id, A.chatId)).toEqual([]);
    expect((await listMessages(A.id, A.chatId)).length).toBe(1);
  });

  it("cannot post a question into A's chat", async () => {
    const res = await ask(
      post(`/api/chats/${A.chatId}/messages`, { question: "what is A's deposit?" }, B.cookie),
      ctx(A.chatId),
    );
    expect(res.status).toBe(404);
    // Nothing was written into A's conversation on the way to that 404.
    expect((await listMessages(A.id, A.chatId)).length).toBe(1);
  });

  it("cannot delete A's chat", async () => {
    const res = await deleteChatRoute(get(`/api/chats/${A.chatId}`, B.cookie), ctx(A.chatId));
    expect(res.status).toBe(404);

    // A's conversation and its messages survived the attempt intact.
    expect((await getChatRoute(get(`/api/chats/${A.chatId}`, A.cookie), ctx(A.chatId))).status).toBe(
      200,
    );
    expect((await listMessages(A.id, A.chatId)).length).toBe(1);
  });

  it("cannot open a chat against A's document", async () => {
    // The one place a document id legitimately arrives in a request body. It is
    // checked against B's tenant before it is ever stored on a chat row.
    const res = await newChat(post("/api/chats", { documentId: A.docId }, B.cookie));
    expect(res.status).toBe(404);
  });

  it("cannot retrieve over A's chunks", async () => {
    // Both halves of the hybrid, because a tenant filter on only one of them is
    // the same as none.
    expect(await denseSearch(B.id, A.docId, fakeEmbedding(1), 10)).toEqual([]);
    expect(await keywordSearch(B.id, A.docId, "deposit escrow", 10)).toEqual([]);

    // Sanity: the same searches DO return A's chunk for A. Otherwise this test
    // would pass against an empty table.
    expect((await denseSearch(A.id, A.docId, fakeEmbedding(1), 10)).length).toBe(1);
    expect((await keywordSearch(A.id, A.docId, "deposit escrow", 10)).length).toBe(1);
  });

  it("sees none of A's documents or chats in their own listings", async () => {
    const docs = (await (await listDocs(get("/api/documents", B.cookie))).json()) as {
      id: string;
    }[];
    const chats = (await (await listChats(get("/api/chats", B.cookie))).json()) as {
      id: string;
    }[];

    expect(docs.map((d) => d.id)).toEqual([B.docId]);
    expect(chats.map((c) => c.id)).toEqual([B.chatId]);
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
      await listChats(get("/api/chats", A.cookie)),
      await getChatRoute(get(`/api/chats/${A.chatId}`, A.cookie), ctx(A.chatId)),
      await admin(get("/api/admin", A.cookie)),
      // The 401 too: a stored "Not signed in." is a smaller problem than a
      // stored lease, but a stored 200 is the same code path.
      await listChats(get("/api/chats")),
    ];

    for (const res of responses) {
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("vary")).toContain("Cookie");
    }
  });
});

describe("a user deleting their own chat", () => {
  it("removes it, its messages, and 404s the second time", async () => {
    const doomed = await createChat(B.id, B.docId, "throwaway");
    await insertMessage(B.id, doomed.id, "user", "delete me");

    const res = await deleteChatRoute(get(`/api/chats/${doomed.id}`, B.cookie), ctx(doomed.id));
    expect(res.status).toBe(200);

    expect(await listMessages(B.id, doomed.id)).toEqual([]);
    const gone = await getChatRoute(get(`/api/chats/${doomed.id}`, B.cookie), ctx(doomed.id));
    expect(gone.status).toBe(404);

    // And the delete stayed inside B's tenant — A is untouched.
    expect((await listMessages(A.id, A.chatId)).length).toBe(1);
  });
});

describe("opening a new chat", () => {
  it("sweeps the caller's never-used chats, and reaches no further", async () => {
    const empty1 = await createChat(B.id, B.docId, null);
    const empty2 = await createChat(B.id, B.docId, null);

    // One that was actually used, to prove the sweep is "no messages" and not
    // "no title" — a chat can be asked a question before its title lands.
    const used = await createChat(B.id, B.docId, null);
    await insertMessage(B.id, used.id, "user", "a real question");

    // A has an empty chat too. The sweep is a DELETE, so if it were unscoped
    // this is where that shows up.
    const aEmpty = await createChat(A.id, A.docId, null);

    const res = await newChat(post("/api/chats", { documentId: B.docId }, B.cookie));
    expect(res.status).toBe(201);
    const fresh = (await res.json()) as { id: string };

    const mine = ((await (await listChats(get("/api/chats", B.cookie))).json()) as {
      id: string;
    }[]).map((c) => c.id);

    expect(mine).not.toContain(empty1.id);
    expect(mine).not.toContain(empty2.id);
    // The used one survives — and so does the chat just handed back, which was
    // created after the sweep and is empty by definition.
    expect(mine).toContain(used.id);
    expect(mine).toContain(fresh.id);

    const theirs = ((await (await listChats(get("/api/chats", A.cookie))).json()) as {
      id: string;
    }[]).map((c) => c.id);
    expect(theirs).toContain(aEmpty.id);
  });
});
