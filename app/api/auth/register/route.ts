import { parseCredentials } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { createUser } from "@/lib/db/queries";
import { badRequest, route } from "@/lib/http";

export const runtime = "nodejs"; // scrypt is node:crypto, not Web Crypto

export const POST = route(async (req: Request) => {
  const { email, password } = parseCredentials(await req.json());

  let user;
  try {
    user = await createUser(email, await hashPassword(password));
  } catch (e) {
    // No pre-flight "does this email exist" check: it costs a round trip and
    // still races. The unique index is the real check, so let it be the check.
    if (/unique|duplicate/i.test(String(e)))
      throw badRequest("That email is already registered.");
    throw e;
  }

  return Response.json(
    { id: user.id, email: user.email },
    { status: 201, headers: { "set-cookie": sessionCookie(await signSession(user.id)) } },
  );
});
