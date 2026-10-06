import { session, sessionCookie, signSession } from "@/lib/auth/session";
import { touchSession } from "@/lib/db/queries";
import { route } from "@/lib/http";

/**
 * Slides the idle window. The browser calls this at most once a minute while
 * someone is actually using it; an expired or missing session is session()'s
 * 401, and the browser treats that as signed out.
 */
export const POST = route(async (req: Request) => {
  const { userId, sessionId } = await session(req);
  await touchSession(userId, sessionId);
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie(await signSession(userId, sessionId)) } },
  );
});
