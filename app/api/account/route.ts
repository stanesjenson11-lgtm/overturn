import { verifyPassword } from "@/lib/auth/password";
import { clearedCookie, session } from "@/lib/auth/session";
import { deleteUser, findUserByEmail, findUserById, logSecurityEvent } from "@/lib/db/queries";
import { HttpError, route, unauthorized } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/limits";

export const runtime = "nodejs";

/**
 * Erasure, and withdrawal of consent (DPDP Act ss.6(4), 12): the account and
 * everything in it, now. Every tenant table cascades on users, so it's one
 * statement. Asks for the password again, because a session left open on a
 * shared computer shouldn't be enough to destroy someone's case.
 */
export const DELETE = route(async (req: Request) => {
  const { userId } = await session(req);
  await rateLimit(`account:user:${userId}`, 5, 60 * 60);

  const user = await findUserById(userId);
  if (!user) throw unauthorized();
  const { password } = ((await req.json().catch(() => ({}))) ?? {}) as { password?: unknown };
  const full = await findUserByEmail(user.email);
  // 403, not 401: the session is fine, and a 401 reads as "signed out".
  if (typeof password !== "string" || !full || !(await verifyPassword(password, full.password_hash)))
    throw new HttpError(403, "That password isn't right.");

  await deleteUser(userId);
  await logSecurityEvent("account_deleted", userId, clientIp(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
