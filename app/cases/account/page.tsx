"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

/** Your data: see it, take it, delete it (DPDP Act ss.11–12). */
export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ email: string }>("/api/auth/me").then((u) => setEmail(u.email), () => {});
  }, []);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!armed) return setArmed(true);
    setBusy(true);
    setError("");
    try {
      await api("/api/account", { method: "DELETE", body: JSON.stringify({ password }) });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <main className="h-dvh flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-serif text-3xl">Your data</h1>
        {email && <p className="mt-2 text-sm text-muted">Signed in as {email}</p>}

        <section className="mt-10 rounded-2xl p-5 shadow-neu-sm">
          <h2 className="font-serif text-xl">Download a copy</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Every case, what was read from each document, and every message with its sources and
            verdict, as one JSON file. To save a single case as a readable PDF, open it and use
            Download chat.
          </p>
          <a
            href="/api/account/export"
            className="mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-medium shadow-neu-sm transition hover:shadow-neu"
          >
            Download my data (JSON)
          </a>
        </section>

        <section className="mt-8 rounded-2xl p-5 shadow-neu-sm">
          <h2 className="font-serif text-xl">Delete your account</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Deletes your account, every case, the text read from your documents, and every message,
            immediately and for good. This also withdraws your consent. A record that the account
            existed and was deleted stays in the security log for a year, as the{" "}
            <Link href="/privacy#retention" className="text-accent underline-offset-2 hover:underline">
              privacy policy
            </Link>{" "}
            explains.
          </p>
          <form onSubmit={remove} className="mt-4 space-y-3">
            <label className="block max-w-sm">
              <span className="text-sm text-muted">Your password, to confirm</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setArmed(false);
                }}
                className="mt-1.5 w-full rounded-xl px-4 py-2.5 text-sm text-ink shadow-neu-inset-sm outline-none focus:shadow-neu-inset"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-accent">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-50"
            >
              {busy ? "Deleting…" : armed ? "Click again to delete everything" : "Delete my account"}
            </button>
          </form>
        </section>

        <p className="mt-10 text-xs text-muted">
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacy policy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="underline-offset-2 hover:underline">
            Terms
          </Link>
        </p>
      </div>
    </main>
  );
}
