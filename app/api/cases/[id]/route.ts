import { session } from "@/lib/auth/session";
import { deleteCase, getCase, listCaseDocuments, listMessages } from "@/lib/db/queries";
import { json, notFound, route } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;

  const found = await getCase(userId, id);
  if (!found) throw notFound();

  const [documents, messages] = await Promise.all([
    listCaseDocuments(userId, id),
    listMessages(userId, id),
  ]);
  return json({ case: found, documents, messages });
});

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;
  if (!(await deleteCase(userId, id))) throw notFound();
  return json({ ok: true });
});
