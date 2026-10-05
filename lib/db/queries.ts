/**
 * Every SQL statement in the application lives in this file. That is what makes
 * the CI tenant scan possible (it reads this file as text), and it is why there
 * is no ORM: the interesting statements are vector and tsvector SQL that an ORM
 * only obscures, and each one carries a tenant filter you want visible.
 *
 * Convention: every tenant-scoped function takes `userId` as its FIRST argument,
 * and that argument always comes from session() — never from a request.
 */
import type { Chunk } from "../ingest/chunk";
import type { KeyTerm } from "../ingest/terms";
import { raw, tq, toVector, type Row } from "./client";

// ---------------------------------------------------------------- users
// A user row *is* the tenant, so these are the only unscoped statements.
// Login has no session yet to scope by; that is the whole point of login.

export type User = { id: string; email: string; password_hash: string };

export async function createUser(email: string, passwordHash: string) {
  const [u] = await raw<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
    [email, passwordHash],
  );
  return u;
}

export async function findUserByEmail(email: string) {
  const [u] = await raw<User>(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [email],
  );
  return u;
}

export async function findUserById(id: string) {
  const [u] = await raw<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE id = $1`,
    [id],
  );
  return u;
}

// ------------------------------------------------------------ documents

export type Doc = {
  id: string;
  filename: string;
  page_count: number | null;
  status: string;
  error: string | null;
  key_terms: KeyTerm[] | null;
  created_at: string;
};

export async function createDocument(userId: string, filename: string) {
  const [d] = await tq<Doc>(
    `INSERT INTO documents (user_id, filename) VALUES ($1, $2)
     RETURNING id, filename, page_count, status, error, key_terms, created_at`,
    [userId, filename],
  );
  return d;
}

export async function listDocuments(userId: string) {
  return tq<Doc>(
    `SELECT id, filename, page_count, status, error, key_terms, created_at
     FROM documents WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function getDocument(userId: string, id: string) {
  const [d] = await tq<Doc>(
    `SELECT id, filename, page_count, status, error, key_terms, created_at
     FROM documents WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return d;
}

export async function countDocuments(userId: string) {
  const [r] = await tq<{ n: string }>(
    `SELECT count(*)::text AS n FROM documents WHERE user_id = $1`,
    [userId],
  );
  return Number(r.n);
}

export async function setDocumentStatus(
  userId: string,
  id: string,
  status: string,
  extra: { pageCount?: number; error?: string; keyTerms?: KeyTerm[] | null } = {},
) {
  // Key terms land in the same statement as "ready", so the UI never sees a
  // ready document whose terms are still on their way.
  await tq(
    `UPDATE documents
        SET status = $3,
            page_count = COALESCE($4, page_count),
            error = $5,
            key_terms = COALESCE($6::jsonb, key_terms)
      WHERE user_id = $1 AND id = $2`,
    [
      userId,
      id,
      status,
      extra.pageCount ?? null,
      extra.error ?? null,
      extra.keyTerms == null ? null : JSON.stringify(extra.keyTerms),
    ],
  );
}

export async function deleteDocument(userId: string, id: string) {
  const rows = await tq<{ id: string }>(
    `DELETE FROM documents WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id],
  );
  return rows.length > 0;
}

// --------------------------------------------------------------- chunks

export type ChunkInput = {
  ordinal: number;
  headingPath: string | null;
  pageStart: number;
  pageEnd: number;
  content: string;
  embedding: number[];
};

export type Retrieved = {
  id: string;
  content: string;
  heading_path: string | null;
  page_start: number;
  page_end: number;
};

export async function insertChunks(
  userId: string,
  documentId: string,
  chunks: ChunkInput[],
) {
  if (chunks.length === 0) return;
  // One multi-row INSERT rather than N round trips — over HTTP each round trip
  // is a fresh request, so the difference is seconds, not microseconds.
  const params: unknown[] = [userId, documentId];
  const values = chunks.map((c) => {
    const i = params.length;
    params.push(c.ordinal, c.headingPath, c.pageStart, c.pageEnd, c.content, toVector(c.embedding));
    return `($1, $2, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}::vector)`;
  });
  await tq(
    `INSERT INTO chunks
       (user_id, document_id, ordinal, heading_path, page_start, page_end, content, embedding)
     VALUES ${values.join(", ")}`,
    params,
  );
}

export async function countChunks(userId: string, documentId: string) {
  const [r] = await tq<{ n: string }>(
    `SELECT count(*)::text AS n FROM chunks WHERE user_id = $1 AND document_id = $2`,
    [userId, documentId],
  );
  return Number(r.n);
}

/** A document's chunks in reading order, shaped as chunkPages() produced them. */
export async function listChunks(userId: string, documentId: string) {
  return tq<Chunk>(
    `SELECT ordinal, heading_path AS "headingPath", page_start AS "pageStart",
            page_end AS "pageEnd", content
       FROM chunks WHERE user_id = $1 AND document_id = $2
      ORDER BY ordinal`,
    [userId, documentId],
  );
}

/** Dense half of the hybrid: cosine distance over the HNSW index. */
export async function denseSearch(
  userId: string,
  documentId: string,
  embedding: number[],
  limit: number,
) {
  return tq<Retrieved & { score: number }>(
    `SELECT id::text AS id, content, heading_path, page_start, page_end,
            1 - (embedding <=> $3::vector) AS score
       FROM chunks
      WHERE user_id = $1 AND document_id = $2
      ORDER BY embedding <=> $3::vector
      LIMIT $4`,
    [userId, documentId, toVector(embedding), limit],
  );
}

/** Keyword half: the same rows, ranked by tsvector match instead. Finds the
 *  exact term a paraphrase-matching embedding drifts past. */
export async function keywordSearch(
  userId: string,
  documentId: string,
  query: string,
  limit: number,
) {
  return tq<Retrieved>(
    `SELECT id::text AS id, content, heading_path, page_start, page_end
       FROM chunks
      WHERE user_id = $1 AND document_id = $2
        AND tsv @@ plainto_tsquery('english', $3)
      ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', $3)) DESC
      LIMIT $4`,
    [userId, documentId, query, limit],
  );
}

// ---------------------------------------------------------------- chats

export type Chat = {
  id: string;
  document_id: string | null;
  title: string | null;
  created_at: string;
};

export async function createChat(userId: string, documentId: string | null, title: string | null) {
  const [c] = await tq<Chat>(
    `INSERT INTO chats (user_id, document_id, title) VALUES ($1, $2, $3)
     RETURNING id, document_id, title, created_at`,
    [userId, documentId, title],
  );
  return c;
}

export async function listChats(userId: string) {
  return tq<Chat>(
    `SELECT id, document_id, title, created_at
     FROM chats WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function getChat(userId: string, id: string) {
  const [c] = await tq<Chat>(
    `SELECT id, document_id, title, created_at
     FROM chats WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return c;
}

/** messages cascade on the chats FK, so one statement is the whole delete.
 *  Returns false when the id belongs to someone else — same shape as
 *  deleteDocument, so the route answers 404 either way. */
export async function deleteChat(userId: string, id: string) {
  const rows = await tq<{ id: string }>(
    `DELETE FROM chats WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id],
  );
  return rows.length > 0;
}

/**
 * Clears out this user's chats that were opened and never asked anything.
 *
 * Clicking a document creates the chat row up front, so backing out without
 * typing leaves an untitled husk in the sidebar forever — titles only get
 * generated from the first question. Swept at the moment the next chat is
 * created, which is exactly when a new husk would otherwise be added.
 *
 * NOT EXISTS rather than `id NOT IN (SELECT chat_id ...)`: chat_id is NOT NULL
 * today, but NOT IN silently matches nothing the day a NULL appears in that
 * column, and a delete that quietly stops working is the worst kind.
 */
export async function deleteEmptyChats(userId: string) {
  const rows = await tq<{ id: string }>(
    `DELETE FROM chats
      WHERE user_id = $1
        AND NOT EXISTS (
              SELECT 1 FROM messages
               WHERE messages.chat_id = chats.id AND messages.user_id = $1
            )
     RETURNING id`,
    [userId],
  );
  return rows.length;
}

export async function setChatTitle(userId: string, id: string, title: string) {
  await tq(`UPDATE chats SET title = $3 WHERE user_id = $1 AND id = $2`, [userId, id, title]);
}

// ------------------------------------------------------------- messages

export type Message = {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  created_at: string;
};

export async function listMessages(userId: string, chatId: string) {
  return tq<Message>(
    `SELECT id::text AS id, role, content, citations, created_at
       FROM messages WHERE user_id = $1 AND chat_id = $2 ORDER BY id`,
    [userId, chatId],
  );
}

export async function insertMessage(
  userId: string,
  chatId: string,
  role: "user" | "assistant",
  content: string,
  citations: unknown = null,
) {
  const [m] = await tq<{ id: string }>(
    `INSERT INTO messages (user_id, chat_id, role, content, citations)
     VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [userId, chatId, role, content, citations === null ? null : JSON.stringify(citations)],
  );
  return m;
}

// ---------------------------------------------------------------- usage

export async function todayUsage(userId: string) {
  const [u] = await tq<{ queries: number; in_tokens: string; out_tokens: string }>(
    `SELECT queries, in_tokens::text, out_tokens::text
       FROM usage WHERE user_id = $1 AND day = CURRENT_DATE`,
    [userId],
  );
  return u ?? { queries: 0, in_tokens: "0", out_tokens: "0" };
}

export async function bumpUsage(userId: string, inTokens: number, outTokens: number) {
  await tq(
    `INSERT INTO usage (user_id, day, queries, in_tokens, out_tokens)
     VALUES ($1, CURRENT_DATE, 1, $2, $3)
     ON CONFLICT (user_id, day) DO UPDATE
       SET queries    = usage.queries + 1,
           in_tokens  = usage.in_tokens + EXCLUDED.in_tokens,
           out_tokens = usage.out_tokens + EXCLUDED.out_tokens`,
    [userId, inTokens, outTokens],
  );
}

// --------------------------------------------------------------- traces

export async function insertTrace(userId: string, chatId: string | null, spans: unknown) {
  await tq(`INSERT INTO traces (user_id, chat_id, spans) VALUES ($1, $2, $3)`, [
    userId,
    chatId,
    JSON.stringify(spans),
  ]);
}

export async function listTraces(userId: string, limit = 50): Promise<Row[]> {
  return tq(
    `SELECT spans, created_at FROM traces
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
}
