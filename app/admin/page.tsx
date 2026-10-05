"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Stats = {
  runs: number;
  retryRate: number;
  stages: { stage: string; runs: number; p50: number; p95: number }[];
  today: { queries: number; limit: number; inTokens: number; outTokens: number };
};

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Stats>("/api/admin").then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="p-10 text-accent">{error}</main>;
  if (!stats) return <main className="p-10 text-muted">Loading…</main>;

  const slowest = Math.max(1, ...stats.stages.map((s) => s.p95));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/chat" className="text-sm text-muted underline-offset-2 hover:underline">
        ← Back
      </Link>

      <h1 className="mt-4 font-serif text-3xl">Pipeline</h1>
      <p className="mt-2 max-w-prose text-muted">
        Your last {stats.runs} question{stats.runs === 1 ? "" : "s"}, stage by stage. Scoped
        to your account — there is no cross-tenant view in this app, deliberately.
      </p>

      {stats.runs === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-panel p-5 text-sm text-muted">
          No runs yet. Ask a question and this fills in.
        </p>
      ) : (
        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="pb-2 font-medium">Stage</th>
              <th className="pb-2 font-medium">Runs</th>
              <th className="pb-2 font-medium">p50</th>
              <th className="pb-2 font-medium">p95</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {stats.stages.map((s) => (
              <tr key={s.stage} className="border-b border-line/60">
                <td className="py-2.5 font-medium">{s.stage}</td>
                <td className="py-2.5 text-muted">{s.runs}</td>
                <td className="py-2.5 tabular-nums">{ms(s.p50)}</td>
                <td className="py-2.5 tabular-nums text-muted">{ms(s.p95)}</td>
                <td className="w-1/3 py-2.5 pl-4">
                  <span
                    className="block h-1.5 rounded-full bg-accent"
                    style={{ width: `${Math.max(2, (s.p95 / slowest) * 100)}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          {
            k: "Corrective retries",
            v: `${Math.round(stats.retryRate * 100)}%`,
            note: "grader judged retrieval thin",
          },
          {
            k: "Questions today",
            v: `${stats.today.queries} / ${stats.today.limit}`,
            note: "resets midnight UTC",
          },
          {
            k: "Tokens today",
            v: `${(stats.today.inTokens / 1000).toFixed(1)}k in · ${(stats.today.outTokens / 1000).toFixed(1)}k out`,
            note: "across all five stages",
          },
        ].map((c) => (
          <div key={c.k} className="rounded-lg border border-line bg-panel p-4">
            <dt className="text-xs uppercase tracking-wide text-muted">{c.k}</dt>
            <dd className="mt-1 font-serif text-xl">{c.v}</dd>
            <dd className="mt-1 text-xs text-muted">{c.note}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
