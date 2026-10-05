import { genAI, UTILITY_MODEL, withRetry, type Usage } from "../llm";

const NONE: Usage = { in: 0, out: 0 };

const usage = (u?: { promptTokenCount?: number; candidatesTokenCount?: number }): Usage => ({
  in: u?.promptTokenCount ?? 0,
  out: u?.candidatesTokenCount ?? 0,
});

/**
 * "What about two of them?" retrieves nothing. It has to become "does the lease
 * permit two pets" before it touches the index, because the retriever has no
 * conversation — it only sees the string.
 *
 * Skipped entirely on the first message of a chat: there is no context to fold
 * in, so the call would be latency for nothing.
 */
export async function rewriteQuery(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<{ query: string; usage: Usage; rewritten: boolean }> {
  if (history.length === 0) return { query: question, usage: NONE, rewritten: false };

  const transcript = history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Tenant" : "LeaseLens"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  try {
    const res = await withRetry(() =>
      genAI().models.generateContent({
        model: UTILITY_MODEL,
        contents: `${transcript}\nTenant: ${question}\n\nStandalone query:`,
        config: {
          systemInstruction:
            "Rewrite the tenant's latest question as a standalone search query over a lease agreement. Resolve pronouns and elisions from the conversation. Keep the tenant's own terms. Output the query alone, with no preamble, quotes, or explanation. If the question already stands alone, output it unchanged.",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    );

    const text = (res.text ?? "").trim();
    const u = usage(res.usageMetadata);
    // A rewrite that came back empty or absurdly long is a failed rewrite.
    if (!text || text.length > 400) return { query: question, usage: u, rewritten: false };
    return { query: text, usage: u, rewritten: text !== question };
  } catch (e) {
    console.error("rewrite failed, using the raw question:", e);
    return { query: question, usage: NONE, rewritten: false };
  }
}

/** Chat titles. One cheap call, capped short, and never worth failing over. */
export async function titleFor(question: string): Promise<string> {
  try {
    const res = await withRetry(() =>
      genAI().models.generateContent({
        model: UTILITY_MODEL,
        contents: question,
        config: {
          systemInstruction:
            "Title this lease question in at most 8 words. No quotes, no trailing period, no preamble.",
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
