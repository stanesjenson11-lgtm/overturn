/**
 * The idle sign-out, in numbers. No imports on purpose: the server (token
 * lifetime) and the browser (the idle timer) both read this file, and the
 * browser must not drag `jose` into its bundle to do it.
 */
export const IDLE_SECONDS = 300; // no activity for this long signs you out
export const WARN_SECONDS = 30; // the "Still there?" dialog covers the last stretch
export const PING_EVERY_SECONDS = 60; // an active browser renews the token at most this often

/** Whole seconds left before an idle sign-out, never below zero. */
export const remainingSeconds = (lastActivity: number, now: number) =>
  Math.max(0, Math.ceil(IDLE_SECONDS - (now - lastActivity) / 1000));
