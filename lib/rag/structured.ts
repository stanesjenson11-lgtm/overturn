import { Type, type Schema } from "@google/genai";
import { genAI, UTILITY_MODEL, withRetry, type Usage } from "../llm";

/**
 * Hand-written Gemini schemas, not a Zod→JSON-Schema translator.
 *
 * Gemini's `responseSchema` is a constrained OpenAPI-style subset (uppercase
 * `Type` enum, no `$ref`/`allOf`/`additionalProperties`) — a general translator
 * emits constructs it doesn't accept. Both schemas here are two or three
 * fields; writing them by hand is less code than a translation layer and
 * nothing to keep in sync with a schema library's output format.
 */
export const SCORES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    scores: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER, description: "1-based index of the candidate" },
          score: { type: Type.NUMBER, description: "0 = irrelevant, 10 = directly answers" },
        },
        required: ["index", "score"],
      },
    },
  },
  required: ["scores"],
};

export type Scores = { scores: { index: number; score: number }[] };

export const GRADE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    sufficient: { type: Type.BOOLEAN, description: "true if these clauses contain the answer" },
    search_for: {
      type: Type.STRING,
      description: "if not sufficient, a phrase to search the lease for instead; else empty",
    },
  },
  required: ["sufficient", "search_for"],
};

export type Grade = { sufficient: boolean; search_for: string };

const toUsage = (u?: { promptTokenCount?: number; candidatesTokenCount?: number }): Usage => ({
  in: u?.promptTokenCount ?? 0,
  out: u?.candidatesTokenCount ?? 0,
});

/**
 * One JSON call, one parse. Returns `null` on anything that stops this from
 * being a clean object — a safety block, a truncated response, malformed
 * JSON — so callers fail soft instead of throwing into the pipeline.
 */
export async function structured<T>(system: string, prompt: string, schema: Schema) {
  const res = await withRetry(() =>
    genAI().models.generateContent({
      model: UTILITY_MODEL,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: schema,
        thinkingConfig: { thinkingBudget: 0 }, // a scoring/classification call, not a reasoning one
      },
    }),
  );

  const usage = toUsage(res.usageMetadata);
  const finish = res.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") return { parsed: null as T | null, usage };

  try {
    return { parsed: JSON.parse(res.text ?? "") as T, usage };
  } catch {
    return { parsed: null as T | null, usage };
  }
}
