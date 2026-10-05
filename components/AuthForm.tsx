"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { post } from "@/lib/client";
import Logo from "./Logo";

// Carries the typed email to the other form when the error suggests
// switching. Session storage, never the URL: an email in a query string ends
// up in history, referrers and server logs.
const CARRY = "overturn:email";

// Cloudflare Turnstile. Unset (local dev without keys) means no widget, and
// the server skips the check outside production.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id: string): void;
      remove(id: string): void;
    };
  }
}

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  // Rendered explicitly, not by class name: the script loads once, but this
  // form mounts again on every switch between sign-in and sign-up.
  const renderWidget = () => {
    if (!SITE_KEY || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, {
      sitekey: SITE_KEY,
      callback: setToken,
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
  };

  useEffect(
    () => () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    },
    [],
  );

  const register = mode === "register";

  useEffect(() => {
    try {
      const carried = sessionStorage.getItem(CARRY);
      if (carried) setEmail(carried);
      sessionStorage.removeItem(CARRY);
    } catch {
      // Storage blocked (private mode): the user types it again.
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/api/auth/${mode}`, { email, password, consent, turnstileToken: token });
      // The session cookie is already set by the response; nothing to store.
      router.push("/cases");
      router.refresh();
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : "Something went wrong.",
        status: (err as { status?: number }).status,
      });
      setBusy(false);
      // A token is good for one verification; the next attempt needs a new one.
      if (widget.current) window.turnstile?.reset(widget.current);
      setToken("");
    }
  }

  /** The other form, with the email already filled in. */
  const switchTo = (href: string) => () => {
    try {
      sessionStorage.setItem(CARRY, email);
    } catch {}
    router.push(href);
  };

  // No account on sign-in, or already registered on sign-up: say what to do next.
  const next =
    !register && error?.status === 404
      ? { label: "Create an account with this email", href: "/register" }
      : register && error?.status === 409
        ? { label: "Sign in instead", href: "/login" }
        : null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-3xl p-8 shadow-neu">
        <Link href="/" aria-label="Overturn home">
          <Logo />
        </Link>
        <h1 className="mt-6 font-serif text-3xl">
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

          {register && (
            <label className="flex items-start gap-2.5 text-xs leading-relaxed text-muted">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span>
                I&apos;m 18 or older and agree to the{" "}
                <Link href="/terms" target="_blank" className="font-medium text-accent underline-offset-2 hover:underline">
                  Terms
                </Link>
                . I consent to Overturn processing my documents, including health information, as
                the{" "}
                <Link href="/privacy" target="_blank" className="font-medium text-accent underline-offset-2 hover:underline">
                  Privacy Policy
                </Link>{" "}
                describes.
              </span>
            </label>
          )}

          {SITE_KEY && (
            <>
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                onReady={renderWidget}
              />
              <div ref={box} className="min-h-[65px]" />
            </>
          )}

          {error && (
            <div role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent shadow-neu-inset-sm">
              <p>{error.message}</p>
              {next && (
                <button
                  type="button"
                  onClick={switchTo(next.href)}
                  className="mt-1 font-medium underline underline-offset-2"
                >
                  {next.label} →
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (!!SITE_KEY && !token)}
            className="w-full rounded-xl bg-accent px-4 py-2.5 font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm disabled:opacity-50"
          >
            {busy ? "…" : register ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted">
          {register ? "Already have an account? " : "No account yet? "}
          <button
            type="button"
            onClick={switchTo(register ? "/login" : "/register")}
            className="font-medium text-accent"
          >
            {register ? "Sign in" : "Create one"}
          </button>
        </p>
        <p className="mt-4 text-xs text-muted">
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacy
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
