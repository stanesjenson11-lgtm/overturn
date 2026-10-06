import { clearedCookie, session } from "@/lib/auth/session";
import { deleteUser, logSecurityEvent } from "@/lib/db/queries";
import { route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/limits";
import { stepUp } from "./stepup";

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
  await stepUp(req, userId);

  await deleteUser(userId);
  await logSecurityEvent("account_deleted", userId, clientIp(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
