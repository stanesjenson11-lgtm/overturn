import { genAI, withRetry } from "../llm";

export const EMBED_MODEL = "gemini-embedding-001";

/**
 * Pinned, and pinned in two places: here and `vector(768)` in schema.sql.
 * gemini-embedding-001 supports 128–3072 dims (truncate-and-renormalize under
 * the hood); 768 is Google's own recommended default and keeps storage and
 * HNSW build time down for a corpus this size. A silent change to either
 * number would make every INSERT fail against the column, which is the good
 * failure mode.
 */
export const EMBED_DIM = 768;

// The free-tier request quota is tighter than the per-call size limit, so
// bigger batches buy nothing — keep them modest and predictable.
const BATCH = 32;

/**
 * The free tier embeds 100 texts a minute, counted per text, not per batch
 * call. A 60-page policy wording chunks into more clauses than that, and a
 * blind retry lands in the same exhausted minute (the API's own retryDelay
 * says "58ms" at the window's edge). So embed() paces itself: once this
 * minute's allowance is spent, wait for the next one. Uploads have a 300s
 * budget to spend on that; a query embeds one text and never waits.
 *
 * ponytail: in-process window, so concurrent serverless instances can still
 * collide (withRetry absorbs one 429). A paid key lifts the limit; raise
 * EMBED_PER_MINUTE and this never sleeps.
 */
export const EMBED_PER_MINUTE = 100;
let minute = { start: 0, used: 0 };

async function pace(n: number) {
  if (Date.now() - minute.start >= 60_000) minute = { start: Date.now(), used: 0 };
  if (minute.used + n > EMBED_PER_MINUTE) {
    await new Promise((r) => setTimeout(r, minute.start + 60_000 - Date.now() + 500));
    minute = { start: Date.now(), used: 0 };
  }
  minute.used += n;
}

export async function embed(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    await pace(batch.length);
    const res = await withRetry(() =>
      genAI().models.embedContent({
        model: EMBED_MODEL,
        contents: batch,
        config: { taskType, outputDimensionality: EMBED_DIM },
      }),
    );

    const embeddings = res.embeddings ?? [];
    if (embeddings.length !== batch.length)
      throw new Error(`Gemini returned ${embeddings.length} embeddings for ${batch.length} inputs`);

    for (const e of embeddings) {
      const values = e.values ?? [];
      if (values.length !== EMBED_DIM)
        throw new Error(`Gemini returned ${values.length} dims, expected ${EMBED_DIM}`);
      out.push(values);
    }
  }

  return out;
}
