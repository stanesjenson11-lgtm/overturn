import { bumpUsage, hitRateLimit, purgeExpired, todayUsage } from "./db/queries";
import { tooMany } from "./http";
import type { Usage } from "./llm";

/** A shared demo link is a shared credit card unless something says no. */
export const DAILY_QUERIES = 50;
export const DAILY_OUT_TOKENS = 200_000;

export async function assertWithinDailyLimit(userId: string): Promise<void> {
  const used = await todayUsage(userId);
  if (used.queries >= DAILY_QUERIES)
    throw tooMany(`You've used today's ${DAILY_QUERIES} questions. It resets at midnight UTC.`);
  if (Number(used.out_tokens) >= DAILY_OUT_TOKENS)
    throw tooMany("You've used today's token budget. It resets at midnight UTC.");
}

export const recordUsage = (userId: string, usage: Usage) =>
  bumpUsage(userId, usage.in, usage.out);

/**
 * At most `max` requests per `windowSec` for `key`, or a 429.
 *
 * Fixed windows in Postgres: no new service, and the count is one atomic
 * upsert. A burst straddling a window edge can reach 2×max; for slowing down
 * password guessing that's fine.
 */
export async function rateLimit(key: string, max: number, windowSec: number): Promise<void> {
  const ms = windowSec * 1000;
  const start = Math.floor(Date.now() / ms) * ms;
  const count = await hitRateLimit(key, new Date(start));
  // ponytail: probabilistic cleanup, ~1 request in 200; a cron when traffic warrants.
  if (Math.random() < 0.005) await purgeExpired();
  if (count > max) {
    const minutes = Math.max(1, Math.ceil((start + ms - Date.now()) / 60_000));
    throw tooMany(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
}

/** The caller's IP. On Vercel the first x-forwarded-for entry is set by the
 *  edge, not the client; elsewhere (local dev) it may be absent. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}
