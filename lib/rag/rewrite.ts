import { ThinkingLevel } from "@google/genai";
import { genAI, UTILITY_MODEL, withFallback } from "../llm";

/**
 * Case titles, for when the rejection letter gave no insurer or claim number
 * to name the case by. One cheap call, capped short, and never worth failing
 * over.
 */
export async function titleFor(question: string): Promise<string> {
  try {
    const res = await withFallback(UTILITY_MODEL, (model) =>
      genAI().models.generateContent({
        model,
        contents: question,
        config: {
          systemInstruction:
            "Title this question about a health insurance claim in at most 8 words. No quotes, no trailing period, no preamble.",
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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
