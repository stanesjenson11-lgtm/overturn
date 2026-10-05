import { z } from "zod";
import { after } from "next/server";
import { session } from "@/lib/auth/session";
import {
  getChat,
  insertMessage,
  insertTrace,
  listMessages,
  setChatTitle,
} from "@/lib/db/queries";
import { assertWithinDailyLimit, recordUsage } from "@/lib/limits";
import { badRequest, notFound, route } from "@/lib/http";
import { answerQuestion, type Turn } from "@/lib/rag/pipeline";
import { titleFor } from "@/lib/rag/rewrite";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(3).max(2000) });

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;

  const chat = await getChat(userId, id);
  if (!chat) throw notFound();
  if (!chat.document_id) throw badRequest("This chat has no document attached.");

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw badRequest("Ask a question of at least a few words.");
  const question = parsed.data.question;

  await assertWithinDailyLimit(userId);

  const history: Turn[] = (await listMessages(userId, id)).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  await insertMessage(userId, id, "user", question);
  if (!chat.title) after(async () => setChatTitle(userId, id, await titleFor(question)));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        for await (const event of answerQuestion({
          userId,
          documentId: chat.document_id!,
          question,
          history,
        })) {
          send(event);

          if (event.type === "done") {
            // Persist inside the stream, not after it: once the response
            // closes on a serverless runtime there is no "later".
            await insertMessage(userId, id, "assistant", event.content, event.citations);
            await recordUsage(userId, event.usage);
            await insertTrace(userId, id, event.spans);
          }
        }
      } catch (e) {
        console.error("stream failed:", e);
        send({ type: "error", message: "The connection dropped mid-answer." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform stops proxies from buffering the whole stream and
      // delivering it as one lump, which looks exactly like a hang.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
});
