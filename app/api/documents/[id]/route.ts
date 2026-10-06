import { session } from "@/lib/auth/session";
import { countChunks, deleteDocument, getDocument, logSecurityEvent } from "@/lib/db/queries";
import { json, notFound, route } from "@/lib/http";
import { clientIp } from "@/lib/limits";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;

  // `id` selects within the tenant; it does not choose the tenant. getDocument
  // filters on user_id, so someone else's id matches nothing and lands on 404 —
  // which is also all a stranger learns from the response.
  const doc = await getDocument(userId, id);
  if (!doc) throw notFound();

  return json({ ...doc, chunks: doc.status === "ready" ? await countChunks(userId, id) : 0 });
});

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;
  if (!(await deleteDocument(userId, id))) throw notFound();
  await logSecurityEvent(`document_deleted:${id}`, userId, clientIp(req)).catch(console.error);
  return json({ ok: true });
});
