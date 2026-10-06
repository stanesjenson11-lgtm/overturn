/**
 * The idle sign-out, in numbers. No imports on purpose: the server (token
 * lifetime) and the browser (the idle timer) both read this file, and the
 * browser must not drag `jose` into its bundle to do it.
 */
export const IDLE_SECONDS = 300; // no activity for this long signs you out
export const WARN_SECONDS = 30; // the "Still there?" dialog covers the last stretch
export const PING_EVERY_SECONDS = 60; // an active browser renews the token at most this often

// The idle timer alone lets an active session renew forever: a stolen cookie
// kept warm by a script every minute would never lapse. So a sign-in also has
// an absolute lifetime, counted from the password, not from the last renewal.
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

// The 401 message for a session ended by a newer sign-in elsewhere. Shared so
// the browser (components/IdleTimeout.tsx) can tell "bumped" from "expired":
// both are 401, and the message is the only thing that differs.
export const SIGNED_IN_ELSEWHERE = "You signed in somewhere else.";

/** Whole seconds left before an idle sign-out, never below zero. */
export const remainingSeconds = (lastActivity: number, now: number) =>
  Math.max(0, Math.ceil(IDLE_SECONDS - (now - lastActivity) / 1000));
