import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { EMBED_DIM } from "@/lib/rag/embed";

// Every query points at seed 1's direction, like the pipeline tests.
vi.mock("@/lib/rag/embed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rag/embed")>()),
  embed: async (texts: string[]) =>
    texts.map(() => Array.from({ length: EMBED_DIM }, (_, i) => Math.sin(7.3 + i * 0.017))),
}));

const { searchRegulations, hybridSearch } = await import("@/lib/rag/search");
const { createCase, createDocument, insertChunks, replaceRegulation } = await import(
  "@/lib/db/queries"
);
const { startTestDb, stopTestDb, fakeEmbedding } = await import("./db");

const USER = "c0ffee00-0000-4000-8000-000000000002";
let db: PGlite;
let docId: string;

const clause = (ordinal: number, content: string, seed: number) => ({
  ordinal,
  headingPath: `8. MORATORIUM`,
  pageStart: 37,
  pageEnd: 37,
  content,
  embedding: fakeEmbedding(seed),
});

beforeAll(async () => {
  db = await startTestDb();
  await db.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'r@example.com', 'x')`, [USER]);
  const claim = await createCase(USER, null);
  docId = (await createDocument(USER, claim.id, "policy", "policy.pdf")).id;
  await insertChunks(USER, docId, [
    { ...clause(0, "Your policy: pre-existing diseases are covered after 48 months.", 1), headingPath: "4.1" },
  ]);
  await replaceRegulation("products-2024", "IRDAI (Insurance Products) Regulations, 2024", [
    clause(0, "After completion of sixty continuous months of coverage no claim shall be contestable.", 1),
  ]);
});
afterAll(async () => stopTestDb(db));

describe("the regulation corpus", () => {
  it("is searchable, with ids that can't collide with a policy clause's", async () => {
    const { clauses } = await searchRegulations("moratorium after sixty months");
    expect(clauses).toHaveLength(1);
    expect(clauses[0].id).toMatch(/^r\d+$/);
    expect(clauses[0].title).toMatch(/Insurance Products/);
  });

  it("replaces a source on re-ingest instead of piling up copies", async () => {
    await replaceRegulation("products-2024", "IRDAI (Insurance Products) Regulations, 2024", [
      clause(0, "Revised: sixty continuous months of coverage.", 1),
      clause(1, "Waiting period for pre-existing diseases: maximum 36 months.", 2),
    ]);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reg_chunks`);
    expect(rows[0].n).toBe(2);
  });

  it("never mixes with a user's documents, in either direction", async () => {
    const regs = (await searchRegulations("pre-existing diseases")).clauses.map((c) => c.content);
    expect(regs.some((c) => c.startsWith("Your policy"))).toBe(false);

    const mine = (await hybridSearch(USER, [docId], "pre-existing diseases")).clauses.map((c) => c.content);
    expect(mine).toEqual([expect.stringMatching(/^Your policy/)]);
  });
});
