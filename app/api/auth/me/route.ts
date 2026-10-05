import { session } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/queries";
import { json, route, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export const GET = route(async (req: Request) => {
  const { userId } = await session(req);
  const user = await findUserById(userId);
  // A validly signed token for a deleted account is not a session.
  if (!user) throw unauthorized();
  return json(user);
});
