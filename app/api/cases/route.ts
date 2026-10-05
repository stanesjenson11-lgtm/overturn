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

  // Numbered after everything the user has, then bumped past any name still
  // taken, so two drafts never share one.
  const titles = new Set((await listCases(userId)).map((c) => c.title));
  let n = titles.size + 1;
  while (titles.has(`Draft case ${n}`)) n++;

  return json(await createCase(userId, `Draft case ${n}`), 201);
});
