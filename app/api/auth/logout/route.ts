import { clearedCookie, session } from "@/lib/auth/session";
import { endSession } from "@/lib/db/queries";
import { route } from "@/lib/http";

/**
 * Ends the session on the server, so a copy of the cookie stops working too,
 * then clears it. An already-dead session (expired, replaced, a stale tab)
 * still gets its cookie cleared: sign-out never fails from the user's side.
 */
export const POST = route(async (req: Request) => {
  try {
    const { userId, sessionId } = await session(req);
    await endSession(userId, sessionId, "signed_out");
  } catch {}
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
