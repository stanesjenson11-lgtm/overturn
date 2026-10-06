"use client";

import { useEffect, useRef, useState } from "react";
import { PING_EVERY_SECONDS, WARN_SECONDS, remainingSeconds } from "@/lib/auth/idle";
import { post } from "@/lib/client";

// Shared by every tab: working in one keeps the others signed in, and signing
// out of one signs out all of them.
const ACTIVITY = "overturn:lastActivity";
const SIGNED_OUT = "overturn:signedOut";

// Keys count, not just the mouse: someone typing a long message without
// touching the mouse is not idle. Scroll is listened for in the capture phase,
// because it doesn't bubble out of the scrolling chat pane.
const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;

// Storage can throw (blocked, some private modes). Then this tab times itself
// out on its own activity alone, which is still correct, just not shared.
function read(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** For the sidebar's Sign out: the other tabs follow this one to /login. */
export const broadcastSignOut = () => write(SIGNED_OUT, `out ${Date.now()}`);

/**
 * Signs you out after five minutes without activity, with a "Still there?"
 * warning for the last thirty seconds.
 *
 * This is the courteous half. The token's own expiry (lib/auth/session.ts) is
 * the enforcement: if this script never runs, or the tab is closed, the server
 * stops accepting the cookie a minute after this timer would have fired.
 */
export default function IdleTimeout() {
  const [left, setLeft] = useState<number | null>(null); // seconds, while warning
  const dialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const own = useRef(0); // this tab's last activity
  const shared = useRef(0); // the newest activity any tab has stored
  const pinged = useRef(0);
  const inflight = useRef<Promise<unknown> | null>(null);
  const leaving = useRef(false);

  // Everything below touches only refs and setLeft, so the first render's
  // copies, captured by the effect, never go stale.
  const record = (now: number) => {
    own.current = now;
    write(ACTIVITY, String(now));
  };

  const leave = async (expired: boolean, broadcast = true) => {
    if (leaving.current) return;
    leaving.current = true;
    // A renewal landing after the logout would set the cookie right back.
    await inflight.current;
    await post("/api/auth/logout", {}).catch(() => {});
    if (broadcast) write(SIGNED_OUT, `${expired ? "expired" : "out"} ${Date.now()}`);
    // A full load, not a client-side push: nothing signed-in stays in memory.
    window.location.replace(expired ? "/login?expired=1" : "/login");
  };

  const ping = () => {
    pinged.current = Date.now();
    inflight.current = post("/api/auth/refresh", {}).catch((e: { status?: number }) => {
      if (e.status === 401) void leave(true);
      // Anything else (offline, a blip): the next minute tries again.
    });
  };

  const stay = () => {
    if (leaving.current) return; // too late: a renewal now would race the logout
    record(Date.now());
    setLeft(null);
    ping();
  };

  useEffect(() => {
    record(Date.now()); // opening the page counts

    const onActivity = () => {
      const now = Date.now();
      if (now - own.current < 1000) return; // a storage write a second, at most
      // Once the warning is up only its buttons extend the session, so a
      // twitch of the mouse can't dismiss it unread.
      if (remainingSeconds(Math.max(own.current, shared.current), now) <= WARN_SECONDS) return;
      record(now);
    };

    const tick = () => {
      if (leaving.current) return;
      shared.current = read(ACTIVITY);
      const last = Math.max(own.current, shared.current);
      const now = Date.now();
      const r = remainingSeconds(last, now);
      if (r <= 0) return void leave(true);
      setLeft(r <= WARN_SECONDS ? r : null);
      // Renew only after real activity, and at most once a minute.
      if (r > WARN_SECONDS && last > pinged.current && now - pinged.current >= PING_EVERY_SECONDS * 1000)
        ping();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNED_OUT && e.newValue) void leave(e.newValue.startsWith("expired"), false);
    };

    const opts = { capture: true, passive: true };
    for (const e of EVENTS) window.addEventListener(e, onActivity, opts);
    window.addEventListener("storage", onStorage);
    const timer = setInterval(tick, 1000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, opts);
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, []);

  // The native modal dialog makes the page behind inert (no clicks, no Tab
  // into it) and hands focus back to wherever it was when it closes.
  const open = left !== null;
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      stayButton.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  // No aria-live on the countdown: an alertdialog reads its label and
  // description once as focus lands in it, and a live region would then
  // announce every tick. The backdrop colour is a literal because ::backdrop
  // doesn't inherit the theme's CSS variables in older browsers.
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-body"
      onCancel={(e) => {
        e.preventDefault(); // Escape means stay
        stay();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl bg-paper p-8 text-ink shadow-neu backdrop:bg-[#00000080]"
    >
      <h2 id="idle-title" className="font-serif text-2xl">
        Still there?
      </h2>
      <p id="idle-body" className="mt-3 text-sm text-muted">
        For your security, you&apos;ll be signed out in{" "}
        <span className="font-medium text-ink tabular-nums">{left ?? WARN_SECONDS}</span>{" "}
        {left === 1 ? "second" : "seconds"}.
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => void leave(false)}
          className="rounded-xl px-4 py-2.5 text-sm font-medium shadow-neu-sm transition active:shadow-neu-inset-sm"
        >
          Sign out
        </button>
        <button
          ref={stayButton}
          type="button"
          onClick={stay}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
        >
          Stay signed in
        </button>
      </div>
    </dialog>
  );
}
