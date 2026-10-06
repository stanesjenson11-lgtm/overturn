import { clearedCookie, session } from "@/lib/auth/session";
import { endSessions, logSecurityEvent } from "@/lib/db/queries";
import { route } from "@/lib/http";
import { clientIp } from "@/lib/limits";

/**
 * Signs this account out of every browser and device, this one included: for
 * "I left it signed in somewhere" or "someone else has my password". Every
 * other session's next request is refused by session().
 */
export const POST = route(async (req: Request) => {
  const { userId } = await session(req);
  await endSessions(userId, "signed_out_everywhere", null);
  await logSecurityEvent("logout_all", userId, clientIp(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
