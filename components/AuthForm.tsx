"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { post } from "@/lib/client";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const register = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/api/auth/${mode}`, { email, password });
      // The session cookie is already set by the response; nothing to store.
      router.push("/chat");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-3xl p-8 shadow-neu">
        <Link href="/" className="text-sm uppercase tracking-[0.2em] text-muted">
          LeaseLens
        </Link>
        <h1 className="mt-3 font-serif text-3xl">
          {register ? "Create an account" : "Welcome back"}
        </h1>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm text-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl px-4 py-2.5 text-sm text-ink shadow-neu-inset-sm outline-none focus:shadow-neu-inset"
            />
          </label>

          <label className="block">
            <span className="text-sm text-muted">Password</span>
            <input
              type="password"
              required
              minLength={10}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl px-4 py-2.5 text-sm text-ink shadow-neu-inset-sm outline-none focus:shadow-neu-inset"
            />
            {register && (
              <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>
            )}
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent shadow-neu-inset-sm">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-accent px-4 py-2.5 font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-50"
          >
            {busy ? "…" : register ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted">
          {register ? "Already have an account? " : "No account yet? "}
          <Link href={register ? "/login" : "/register"} className="font-medium text-accent">
            {register ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
  );
}
