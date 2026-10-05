import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { raw } from "./client";

/**
 * Idempotent schema application. Used by `npm run migrate` and by the test
 * harness — never by a route handler, which is why reading a file off disk here
 * is fine on a serverless runtime that wouldn't trace it.
 */
export async function applySchema(): Promise<void> {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

  const statements = readFileSync(file, "utf8")
    .replace(/^\s*--.*$/gm, "") // ponytail: no string literals contain `--`, so this is safe
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await raw(statement);
    } catch (e) {
      // The HNSW build is the one statement allowed to fail: an older pgvector
      // (PGlite's, for instance) may not have the index type. Retrieval is
      // still correct without it — just a sequential scan over one tenant's
      // chunks. Every other failure is a real schema problem.
      if (/hnsw/i.test(statement)) {
        console.warn("hnsw index unavailable; falling back to sequential scan");
        continue;
      }
      throw e;
    }
  }
}
