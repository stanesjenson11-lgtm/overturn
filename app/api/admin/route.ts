import { session } from "@/lib/auth/session";
import { listTraces, todayUsage } from "@/lib/db/queries";
import { json, route } from "@/lib/http";
import { DAILY_QUERIES } from "@/lib/limits";
import type { Span } from "@/lib/rag/types";

export const runtime = "nodejs";

/**
 * The pipeline dashboard — scoped to the signed-in user, like everything else.
 * "Admin" here means "look inside your own runs", not "see everyone's": there
 * is no privileged role in this system, deliberately. A role that can read
 * across tenants is a second authorization model to get wrong.
 */
export const GET = route(async (req: Request) => {
  const { userId } = await session(req);

  const traces = await listTraces(userId, 100);
  const usage = await todayUsage(userId);

  const byStage = new Map<string, number[]>();
  let retries = 0;

  for (const t of traces) {
    const spans = (typeof t.spans === "string" ? JSON.parse(t.spans) : t.spans) as Span[];
    if (spans.some((s) => s.stage === "retry")) retries++;
    for (const s of spans) byStage.set(s.stage, [...(byStage.get(s.stage) ?? []), s.ms]);
  }

  const ORDER = ["rewrite", "retrieve", "rerank", "grade", "retry", "answer"];
  const stages = [...byStage.entries()]
    .map(([stage, all]) => {
      const sorted = [...all].sort((a, b) => a - b);
      return {
        stage,
        runs: sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted.at(-1) ?? 0,
      };
    })
    .sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));

  return json({
    runs: traces.length,
    retryRate: traces.length ? retries / traces.length : 0,
    stages,
    today: {
      queries: usage.queries,
      limit: DAILY_QUERIES,
      inTokens: Number(usage.in_tokens),
      outTokens: Number(usage.out_tokens),
    },
  });
});
