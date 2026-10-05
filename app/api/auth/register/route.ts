import { parseCredentials } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { createUser, logSecurityEvent } from "@/lib/db/queries";
import { badRequest, HttpError, route } from "@/lib/http";
import { CONSENT_VERSION } from "@/lib/legal";
import { clientIp, rateLimit } from "@/lib/limits";

export const runtime = "nodejs"; // scrypt is node:crypto, not Web Crypto

export const POST = route(async (req: Request) => {
  const body = await req.json();
  const { email, password } = parseCredentials(body);
  // Consent is an affirmative act (DPDP Act s.6): a ticked box, sent as true,
  // never a default. Checked server-side, because the form is only a request.
  if (body?.consent !== true)
    throw badRequest("Please agree to the Terms and the Privacy Policy to create an account.");

  const ip = clientIp(req);
  await rateLimit(`register:ip:${ip}`, 5, 60 * 60);
  await verifyTurnstile(body?.turnstileToken, ip);

  let user;
  try {
    user = await createUser(email, await hashPassword(password), CONSENT_VERSION);
  } catch (e) {
    // No pre-flight "does this email exist" check: it costs a round trip and
    // still races. The unique index is the real check, so let it be the check.
    if (/unique|duplicate/i.test(String(e)))
      throw new HttpError(409, "That email is already registered.");
    throw e;
  }

  await logSecurityEvent("register", user.id, ip);
  return Response.json(
    { id: user.id, email: user.email },
    { status: 201, headers: { "set-cookie": sessionCookie(await signSession(user.id)) } },
  );
});
