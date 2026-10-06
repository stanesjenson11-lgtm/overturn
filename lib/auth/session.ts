import { SignJWT, jwtVerify } from "jose";
import { findSession } from "../db/queries";
import { unauthorized } from "../http";
import { COOKIE } from "./cookie";
import { IDLE_SECONDS, MAX_SESSION_SECONDS, PING_EVERY_SECONDS, SIGNED_IN_ELSEWHERE } from "./idle";

export { COOKIE };

// The browser's idle timer signs you out after IDLE_SECONDS, but an active
// browser renews the token at most once every PING_EVERY_SECONDS, so the token
// has to outlive that timer by one ping interval or an active user could be
// refused just before a renewal. If the tab is closed or JS is off, this
// expiry is what signs them out: the server is the backstop, not the timer.
const TOKEN_SECONDS = IDLE_SECONDS + PING_EVERY_SECONDS;

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

/** `sessionId` is the user's row in `sessions` (from createSession), carried
 *  as the standard jti claim. */
export async function signSession(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_SECONDS}s`)
    .sign(key());
}

/**
 * One cookie, and nothing clever about it.
 *
 * The split-deploy version of the LeaseLens engine this grew from needed an in-memory access token plus a
 * rotating opaque refresh token in a `SameSite=None; Path=/auth` cookie, plus a
 * proxy rewrite to make that cookie first-party across two origins. All of that
 * existed to work around the deployment split. Same origin, so: SameSite=Lax
 * (which is also CSRF protection for the state-changing routes), httpOnly so no
 * script can read it, Secure everywhere except plain-http localhost.
 *
 * No Max-Age or Expires: a browser-session cookie, kept in memory rather than
 * written to disk, so closing the browser signs you out and the next visit
 * asks for the password again.
 */
export function sessionCookie(jwt: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${jwt}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function clearedCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * THE ONLY PLACE A USER IDENTITY ENTERS THE SYSTEM.
 *
 * No route handler reads a user id from a body, a query string, or a header.
 * A document or chat id in a URL selects a resource *within* the tenant this
 * function returns; it never decides which tenant that is. Every query that
 * consumes such an id also carries `user_id = $1` from here, so an id belonging
 * to someone else matches zero rows and the route 404s.
 *
 * A valid signature is necessary, not sufficient: the token also names its
 * row in `sessions` (jti), and that row must exist for this same user, not be
 * ended (signed out, signed out everywhere, or replaced by a newer sign-in),
 * and be younger than MAX_SESSION_SECONDS. A token from before server-side
 * sessions has no jti and is refused; its owner signs in again.
 */
export async function session(req: Request): Promise<{ userId: string; sessionId: string }> {
  const jwt = readCookie(req, COOKIE);
  if (!jwt) throw unauthorized();
  let userId: string | undefined, sessionId: string | undefined;
  try {
    const { payload } = await jwtVerify(jwt, key());
    ({ sub: userId, jti: sessionId } = payload);
  } catch {
    // Expired, tampered, or signed with a rotated secret — all the same to us.
  }
  if (!userId || !sessionId) throw unauthorized("Session expired.");

  const row = await findSession(userId, sessionId);
  if (row?.ended_reason === "replaced") throw unauthorized(SIGNED_IN_ELSEWHERE);
  if (!row || row.ended_reason) throw unauthorized("Session expired.");
  if (Date.now() - new Date(row.created_at).getTime() > MAX_SESSION_SECONDS * 1000)
    throw unauthorized("Session expired.");
  return { userId, sessionId };
}
