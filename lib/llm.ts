import { GoogleGenAI } from "@google/genai";

/**
 * Pinned, so a rerun a month from now is the same run. Both are free-tier
 * eligible on Google AI Studio (no card on file) — Pro-tier models are not.
 */
export const ANSWER_MODEL = "gemini-3.7-flash";
export const UTILITY_MODEL = "gemini-3.1-flash-lite";

let client: GoogleGenAI | undefined;

export function genAI(): GoogleGenAI {
  return (client ??= new GoogleGenAI({}));
}

/** For tests, and for the eval harness when it stubs the model. */
export function setGenAI(c: GoogleGenAI | undefined): void {
  client = c;
}

/**
 * Gemini's free tier returns 503 UNAVAILABLE under load; it's transient, not
 * our bug, so retry it with backoff.
 *
 * 429 gets exactly one retry, after the delay the API itself asks for. One
 * question spends four or five calls, and the free tier allows 5 requests a
 * minute on the answer model, so two questions in quick succession trip it
 * and a short pause beats an error.
 * If the API wants longer than the cap, the wait would outlast a chat request,
 * so it throws at once. The eval script isn't racing a 60s function and can
 * wait out a whole per-minute window, so it raises RETRY_429_MAX_S.
 * Anything else (400, auth) fails immediately since a retry won't fix it.
 */
const max429 = () => Number(process.env.RETRY_429_MAX_S) || 15;

export function retryDelayMs(err: unknown): number | null {
  // The SDK nests the API's JSON inside its own message, so the quotes arrive
  // escaped (\"retryDelay\": \"52s\"). \W+ matches both that and plain JSON.
  const m = /retryDelay\W+(\d+(?:\.\d+)?)s/.exec(String((err as Error)?.message ?? ""));
  const s = m ? Number(m[1]) : 5;
  return s <= max429() ? Math.ceil(s * 1000) + 250 : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let retried429 = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const wait = status === 429 && !retried429 ? retryDelayMs(err) : null;
      if (wait !== null) {
        retried429 = true;
        await sleep(wait);
        continue;
      }
      if (status !== 503 || attempt >= tries) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

export type Usage = { in: number; out: number };

export const addUsage = (a: Usage, b: Partial<Usage>): Usage => ({
  in: a.in + (b.in ?? 0),
  out: a.out + (b.out ?? 0),
});
