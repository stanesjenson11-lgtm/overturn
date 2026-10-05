import { genAI, UTILITY_MODEL, withRetry } from "../llm";

/**
 * Case titles, for when the rejection letter gave no insurer or claim number
 * to name the case by. One cheap call, capped short, and never worth failing
 * over.
 */
export async function titleFor(question: string): Promise<string> {
  try {
    const res = await withRetry(() =>
      genAI().models.generateContent({
        model: UTILITY_MODEL,
        contents: question,
        config: {
          systemInstruction:
            "Title this question about a health insurance claim in at most 8 words. No quotes, no trailing period, no preamble.",
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 40,
        },
      }),
    );
    const text = (res.text ?? "").trim();
    return text.slice(0, 80) || question.slice(0, 60);
  } catch {
    return question.slice(0, 60);
  }
}
