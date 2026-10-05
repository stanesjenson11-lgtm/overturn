import { parseCredentials } from "@/lib/auth/credentials";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/db/queries";
import { route, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

// A hash to verify against when the email doesn't exist, so a miss costs the
// same ~100 ms as a wrong password. Otherwise the response time tells an
// attacker which addresses are registered.
let decoy: Promise<string> | undefined;

export const POST = route(async (req: Request) => {
  const { email, password } = parseCredentials(await req.json());
  const user = await findUserByEmail(email);

  decoy ??= hashPassword("scrypt-timing-decoy");
  const ok = await verifyPassword(password, user?.password_hash ?? (await decoy));

  // One message for both failures — "no such account" is an enumeration oracle.
  if (!user || !ok) throw unauthorized("Email or password is incorrect.");

  return Response.json(
    { id: user.id, email: user.email },
    { headers: { "set-cookie": sessionCookie(await signSession(user.id)) } },
  );
});
