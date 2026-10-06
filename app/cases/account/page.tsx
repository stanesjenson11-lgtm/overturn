"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { broadcastSignOut } from "@/components/IdleTimeout";
import { api, post } from "@/lib/client";

// Taking everything and destroying everything both ask for the password again
// (app/api/account/stepup.ts), in the same dialog; only the words differ.
const ASK = {
  export: {
    title: "Confirm it's you",
    body: "Enter your password to download a copy of your data.",
    confirm: "Download",
    busy: "Preparing…",
  },
  delete: {
    title: "Delete your account?",
    body: "Every case, document and message goes, immediately and for good. Enter your password to confirm.",
    confirm: "Delete everything",
    busy: "Deleting…",
  },
} as const;
type Action = keyof typeof ASK;

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** Your data: see it, take it, delete it (DPDP Act ss.11–12). */
export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [action, setAction] = useState<Action>("export");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ email: string }>("/api/auth/me").then((u) => setEmail(u.email), () => {});
  }, []);

  // The native modal makes the page behind inert, and hands focus back to the
  // button that opened it when it closes.
  function ask(a: Action) {
    setAction(a);
    setPassword("");
    setError("");
    dialog.current?.showModal();
    input.current?.focus();
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ password });
      if (action === "delete") {
        await api("/api/account", { method: "DELETE", body });
        router.push("/");
        router.refresh();
        return; // stays busy while the page changes
      }
      // A POST can't be a plain link, so the file is handed over from memory.
      const data = await api("/api/account/export", { method: "POST", body });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `overturn-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      // Safari reads the URL after click() returns; revoking at once can cancel it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      dialog.current?.close();
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  async function signOutEverywhere() {
    setLeaving(true);
    setLeaveError("");
    try {
      await post("/api/auth/logout-all", {});
    } catch (err) {
      // A 401 means this session was already gone, which is where this was going.
      if ((err as { status?: number }).status !== 401) {
        setLeaveError(message(err));
        return setLeaving(false);
      }
    }
    broadcastSignOut();
    // A full load, not a client-side push: nothing signed-in stays in memory.
    window.location.replace("/login");
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
          <button
            type="button"
            onClick={() => ask("export")}
            className="mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-medium shadow-neu-sm transition hover:shadow-neu"
          >
            Download my data (JSON)
          </button>
        </section>

        <section className="mt-8 rounded-2xl p-5 shadow-neu-sm">
          <h2 className="font-serif text-xl">Sign out everywhere</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Ends every session on every device and browser, this one included. Use it if you
            stayed signed in on a computer that isn&apos;t yours.
          </p>
          {leaveError && (
            <p role="alert" className="mt-3 text-sm text-accent">
              {leaveError}
            </p>
          )}
          <button
            type="button"
            onClick={signOutEverywhere}
            disabled={leaving}
            className="mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-medium shadow-neu-sm transition hover:shadow-neu disabled:opacity-50"
          >
            {leaving ? "Signing out…" : "Sign out of all devices"}
          </button>
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
          <button
            type="button"
            onClick={() => ask("delete")}
            className="mt-4 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
          >
            Delete my account
          </button>
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

      {/* The backdrop colour is a literal for the same reason as IdleTimeout's:
          ::backdrop doesn't inherit the theme's variables in older browsers. */}
      <dialog
        ref={dialog}
        aria-labelledby="stepup-title"
        aria-describedby="stepup-body"
        onCancel={(e) => busy && e.preventDefault()} // Escape cancels, unless it's already sent
        onClose={() => setPassword("")}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl bg-paper p-8 text-ink shadow-neu backdrop:bg-[#00000080]"
      >
        <form onSubmit={confirm}>
          <h2 id="stepup-title" className="font-serif text-2xl">
            {ASK[action].title}
          </h2>
          <p id="stepup-body" className="mt-3 text-sm text-muted">
            {ASK[action].body}
          </p>
          <label className="mt-5 block">
            <span className="text-sm text-muted">Password</span>
            <input
              ref={input}
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl px-4 py-2.5 text-sm text-ink shadow-neu-inset-sm outline-none focus:shadow-neu-inset"
            />
          </label>
          {error && (
            <p role="alert" className="mt-3 text-sm text-accent">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => dialog.current?.close()}
              className="rounded-xl px-4 py-2.5 text-sm font-medium shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-50"
            >
              {busy ? ASK[action].busy : ASK[action].confirm}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
