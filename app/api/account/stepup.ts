import { verifyPassword } from "@/lib/auth/password";
import { findUserByEmail, findUserById, logSecurityEvent } from "@/lib/db/queries";
import { HttpError, badRequest, unauthorized } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/limits";

/**
 * The password again, before taking everything out (export) or destroying it
 * (delete): a session left open on a shared computer, or a stolen cookie,
 * shouldn't be enough for either. Returns the signed-in user.
 */
export async function stepUp(req: Request, userId: string) {
  const user = await findUserById(userId);
  if (!user) throw unauthorized();
  const { password } = ((await req.json().catch(() => ({}))) ?? {}) as { password?: unknown };
  if (typeof password !== "string" || !password) throw badRequest("Enter your password.");

  // Every attempt counts, and before scrypt: limiting only the wrong ones would
  // let the sixth guess still tell right (200) from wrong (429).
  await rateLimit(`stepup:user:${userId}`, 5, 15 * 60);
  const full = await findUserByEmail(user.email);
  if (!full || !(await verifyPassword(password, full.password_hash))) {
    await logSecurityEvent("stepup_failed", userId, clientIp(req));
    // 403, not 401: the session is fine, and a 401 reads as "signed out".
    throw new HttpError(403, "That password isn't right.");
  }
  return user;
}
