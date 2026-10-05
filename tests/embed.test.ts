import { afterEach, describe, expect, it, vi } from "vitest";
import { setGenAI } from "@/lib/llm";
import { EMBED_DIM, embed } from "@/lib/rag/embed";

afterEach(() => {
  vi.useRealTimers();
  setGenAI(undefined);
});

describe("embedding a long policy on the free tier", () => {
  it("waits for the next minute instead of overrunning 100 texts a minute", async () => {
    vi.useFakeTimers();
    const calledAt: number[] = [];
    setGenAI({
      models: {
        embedContent: async ({ contents }: { contents: string[] }) => {
          calledAt.push(Date.now());
          return { embeddings: contents.map(() => ({ values: new Array(EMBED_DIM).fill(0.1) })) };
        },
      },
    } as any);

    const pending = embed(
      Array.from({ length: 150 }, (_, i) => `clause ${i}`),
      "RETRIEVAL_DOCUMENT",
    );
    await vi.advanceTimersByTimeAsync(61_000);
    const vectors = await pending;

    expect(vectors).toHaveLength(150);
    // Batches of 32: three (96 texts) fit the first minute, the fourth doesn't.
    expect(calledAt).toHaveLength(5);
    expect(calledAt[2] - calledAt[0]).toBeLessThan(1_000);
    expect(calledAt[3] - calledAt[0]).toBeGreaterThanOrEqual(60_000);
  });
});
