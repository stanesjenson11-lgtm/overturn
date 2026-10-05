import { parseCredentials } from "@/lib/auth/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/db/queries";
import { notFound, route, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Says which of the two things went wrong, so the form can offer the right
 * next step: no account means "create one", a wrong password means "try
 * again". This does tell a caller whether an email is registered, but
 * registering already did ("That email is already registered"), so a vague
 * login message protected nothing. Guessing at scale is what actually
 * matters, and that's a rate-limiting job, not a wording one.
 */
export const POST = route(async (req: Request) => {
  const { email, password } = parseCredentials(await req.json());
  const user = await findUserByEmail(email);

  if (!user) throw notFound("There's no account with this email.");
  if (!(await verifyPassword(password, user.password_hash)))
    throw unauthorized("That password isn't right.");

  return Response.json(
    { id: user.id, email: user.email },
    { headers: { "set-cookie": sessionCookie(await signSession(user.id)) } },
  );
});
