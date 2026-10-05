import { HttpError } from "../http";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile: a bot check on sign-in and sign-up, verified here
 * because a token the browser merely *has* proves nothing until Cloudflare
 * says it was issued for this site and not spent.
 *
 * No secret configured: production refuses (a missing env var must not
 * silently switch bot protection off), dev and tests skip.
 */
export async function verifyTurnstile(token: unknown, ip: string): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production")
      throw new Error("TURNSTILE_SECRET_KEY must be set in production");
    return;
  }

  const fail = new HttpError(400, "Please complete the check that you're not a bot, then try again.");
  if (typeof token !== "string" || !token || token.length > 2048) throw fail;

  const body = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") body.set("remoteip", ip);
  const res = await fetch(SITEVERIFY, { method: "POST", body });
  const out = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (out.success !== true) throw fail;
}
