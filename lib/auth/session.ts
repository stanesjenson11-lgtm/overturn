import { SignJWT, jwtVerify } from "jose";
import { unauthorized } from "../http";
import { IDLE_SECONDS, PING_EVERY_SECONDS } from "./idle";

export const COOKIE = "ls_session";

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

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
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
 */
export async function session(req: Request): Promise<{ userId: string }> {
  const jwt = readCookie(req, COOKIE);
  if (!jwt) throw unauthorized();
  try {
    const { payload } = await jwtVerify(jwt, key());
    if (!payload.sub) throw unauthorized();
    return { userId: payload.sub };
  } catch {
    // Expired, tampered, or signed with a rotated secret — all the same to us.
    throw unauthorized("Session expired.");
  }
}
