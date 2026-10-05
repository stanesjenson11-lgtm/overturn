import { GoogleGenAI } from "@google/genai";

/**
 * Pinned, so a rerun a month from now is the same run. Both are free-tier
 * eligible on Google AI Studio (no card on file) — Pro-tier models are not.
 */
export const ANSWER_MODEL = "gemini-3.7-flash";
export const UTILITY_MODEL = "gemini-3.1-flash-lite";

/**
 * The agent loop's model. One review spends four to six calls, and the free
 * tier allows the answer model only 5 a minute, so a single review would
 * exhaust it. The lite model's allowance is far higher. The legal reasoning
 * is carried by the rules engine and the retrieved text, not by the model's
 * own knowledge; the eval measures whether that holds.
 */
// Overridable so the eval can compare candidates without a code change.
export const AGENT_MODEL = process.env.AGENT_MODEL || UTILITY_MODEL;

/**
 * Reads scanned documents (rejection letters usually arrive as scans).
 * Chosen by `npm run scan-bench` (2026-10-05) on four seeded scans:
 *
 *   gemini-3.1-flash-lite  CER 0.13%, median 12.8s a document, no failures
 *   gemma-4-31b-it         CER 0.12%, median 53.6s, 1 of 4 failed (server 500)
 *   gemma-4-26b-a4b-it     CER 12.4% on the one it finished; 3 of 4 timed out
 *   gemini-3.7-flash       20 requests a day on the free tier: disqualified
 *
 * Gemma 4 31B reads as accurately but four times slower, and a 15-page scan
 * has to finish inside one upload. ponytail: re-run the bench before
 * switching; Gemma's free-API latency is the thing most likely to change.
 */
export const SCAN_MODEL = UTILITY_MODEL;

let client: GoogleGenAI | undefined;

export function genAI(): GoogleGenAI {
  return (client ??= new GoogleGenAI({}));
}

/** For tests, and for the eval harness when it stubs the model. */
export function setGenAI(c: GoogleGenAI | undefined): void {
  client = c;
}

/**
 * Gemini's free tier returns 503 UNAVAILABLE under load, and the Gemma models
 * answer 500 INTERNAL now and then; both are transient on Google's side, not
 * our bug, so retry them with backoff.
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
      if ((status !== 503 && status !== 500) || attempt >= tries) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

export type Usage = { in: number; out: number };

export const addUsage = (a: Usage, b: Partial<Usage>): Usage => ({
  in: a.in + (b.in ?? 0),
  out: a.out + (b.out ?? 0),
});
