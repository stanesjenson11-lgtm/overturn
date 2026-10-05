import { z } from "zod";
import { session } from "@/lib/auth/session";
import { createChat, deleteEmptyChats, getDocument, listChats } from "@/lib/db/queries";
import { badRequest, json, notFound, route } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ documentId: z.string().uuid() });

export const GET = route(async (req: Request) => {
  const { userId } = await session(req);
  return json(await listChats(userId));
});

export const POST = route(async (req: Request) => {
  const { userId } = await session(req);

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw badRequest("Pick a document to ask about.");

  // The documentId arrives from the client, so it is checked against this
  // tenant before it is stored — otherwise a chat could be created pointing at
  // someone else's lease, and every later query would inherit that pointer.
  const doc = await getDocument(userId, parsed.data.documentId);
  if (!doc) throw notFound();
  if (doc.status !== "ready") throw badRequest("That document is still being processed.");

  // Before adding one more, drop the ones that were never used. Ordered before
  // createChat so the chat we are about to hand back is never a candidate.
  await deleteEmptyChats(userId);

  return json(await createChat(userId, doc.id, null), 201);
});
