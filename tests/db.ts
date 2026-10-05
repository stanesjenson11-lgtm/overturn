import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { setExecutor } from "@/lib/db/client";
import { applySchema } from "@/lib/db/migrate";
import { EMBED_DIM } from "@/lib/rag/embed";

/**
 * Postgres in-process, with pgvector, via WASM. No Docker, no service container
 * in CI, no "works on my machine" gap — the isolation suite runs against a real
 * planner executing the real statements from queries.ts.
 */
export async function startTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  setExecutor(async (text, params) => (await db.query(text, params as unknown[])).rows as any[]);
  await applySchema();
  return db;
}

export async function stopTestDb(db: PGlite): Promise<void> {
  setExecutor(undefined);
  await db.close();
}

/** A deterministic unit-ish vector, so retrieval is reproducible without Google. */
export function fakeEmbedding(seed: number): number[] {
  const out = new Array<number>(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = Math.sin(seed * 7.3 + i * 0.017);
  const norm = Math.hypot(...out.slice(0, 64)) || 1;
  return out.map((v) => v / norm);
}
