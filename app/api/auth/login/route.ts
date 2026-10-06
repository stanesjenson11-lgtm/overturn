import { parseCredentials } from "@/lib/auth/credentials";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { createSession, endSessions, findUserByEmail, logSecurityEvent } from "@/lib/db/queries";
import { route, unauthorized } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/limits";

export const runtime = "nodejs";

/**
 * One answer for "no such account" and "wrong password", in the same status,
 * words and time (an unknown email is checked against DUMMY_HASH, one full
 * scrypt, just like a real one), so sign-in doesn't confirm which emails are
 * registered.
 *
 * Order: the cheap limits first (one upsert each), then Turnstile (a network
 * call), then scrypt (deliberately slow), so a flood is refused before it
 * costs anything.
 *
 * One active session per user: a successful sign-in ends every other one
 * (ended_reason 'replaced'). No prompt; the newest sign-in wins, and the other
 * browser learns it on its next request (session() answers SIGNED_IN_ELSEWHERE).
 */
export const POST = route(async (req: Request) => {
  const body = await req.json();
  const { email, password } = parseCredentials(body);
  const ip = clientIp(req);

  // Per IP+email stops guessing one account; per IP stops spraying many.
  await rateLimit(`login:ip:${ip}`, 30, 15 * 60);
  await rateLimit(`login:email:${ip}:${email}`, 10, 15 * 60);
  await verifyTurnstile(body?.turnstileToken, ip);

  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    await logSecurityEvent("login_failed", user?.id ?? null, ip);
    throw unauthorized("Email or password is incorrect.");
  }

  // Create first, then end the rest: two sign-ins racing can at worst end each
  // other, never leave two sessions alive.
  const sessionId = await createSession(user.id);
  if ((await endSessions(user.id, "replaced", sessionId)) > 0)
    await logSecurityEvent("session_replaced", user.id, ip);
  await logSecurityEvent("login", user.id, ip);
  return Response.json(
    { id: user.id, email: user.email },
    { headers: { "set-cookie": sessionCookie(await signSession(user.id, sessionId)) } },
  );
});
