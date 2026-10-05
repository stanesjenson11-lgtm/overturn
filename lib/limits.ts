import { bumpUsage, todayUsage } from "./db/queries";
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
