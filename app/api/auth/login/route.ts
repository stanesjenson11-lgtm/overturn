import { parseCredentials } from "@/lib/auth/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { findUserByEmail, logSecurityEvent } from "@/lib/db/queries";
import { notFound, route, unauthorized } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/limits";

export const runtime = "nodejs";

/**
 * Says which of the two things went wrong, so the form can offer the right
 * next step: no account means "create one", a wrong password means "try
 * again". This does tell a caller whether an email is registered, but
 * registering already did ("That email is already registered"), so a vague
 * login message protected nothing. Guessing at scale is what actually
 * matters, and that's what the rate limits and the bot check below are for.
 *
 * Order: the cheap limits first (one upsert each), then Turnstile (a network
 * call), then scrypt (deliberately slow), so a flood is refused before it
 * costs anything.
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
  if (!user) throw notFound("There's no account with this email.");
  if (!(await verifyPassword(password, user.password_hash))) {
    await logSecurityEvent("login_failed", user.id, ip);
    throw unauthorized("That password isn't right.");
  }

  await logSecurityEvent("login", user.id, ip);
  return Response.json(
    { id: user.id, email: user.email },
    { headers: { "set-cookie": sessionCookie(await signSession(user.id)) } },
  );
});
