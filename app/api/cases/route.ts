import { session } from "@/lib/auth/session";
import { createCase, deleteEmptyCases, listCases } from "@/lib/db/queries";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";

export const GET = route(async (req: Request) => {
  const { userId } = await session(req);
  return json(await listCases(userId));
});

export const POST = route(async (req: Request) => {
  const { userId } = await session(req);

  // Before adding one more, drop the ones that were never used. Ordered before
  // createCase so the case we are about to hand back is never a candidate.
  await deleteEmptyCases(userId);

  return json(await createCase(userId, null), 201);
});
