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

export async function embed(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
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
