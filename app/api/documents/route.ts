import { after } from "next/server";
import { session } from "@/lib/auth/session";
import { countDocuments, createDocument, listDocuments } from "@/lib/db/queries";
import { ingest } from "@/lib/ingest";
import { MAX_DOCS_PER_USER, validateUpload } from "@/lib/ingest/pdf";
import { badRequest, json, route } from "@/lib/http";
import { assertWithinDailyLimit } from "@/lib/limits";

export const runtime = "nodejs";
// Parse (or transcribe a scan) + chunk + embed + key terms has to finish inside
// one invocation. 300s is the Vercel Hobby ceiling; a 15-page scan is the slow
// path at well under a minute, so this is headroom, not a target.
export const maxDuration = 300;

export const GET = route(async (req: Request) => {
  const { userId } = await session(req);
  return json(await listDocuments(userId));
});

export const POST = route(async (req: Request) => {
  const { userId } = await session(req);

  if ((await countDocuments(userId)) >= MAX_DOCS_PER_USER)
    throw badRequest(`You can keep ${MAX_DOCS_PER_USER} documents. Delete one to upload another.`);
  // Reading a scan and pulling key terms spend model tokens; same cap as questions.
  await assertWithinDailyLimit(userId);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file was uploaded.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  validateUpload(bytes, file.name); // magic bytes and size, before parsing anything

  const doc = await createDocument(userId, file.name);

  // after() keeps the invocation alive past the response, so the client gets an
  // id to poll immediately instead of holding a request open for 30 seconds.
  // Note this still runs inside maxDuration — it defers the work, not the cap.
  after(async () => {
    try {
      await ingest(userId, doc.id, bytes);
    } catch (e) {
      // ingest() already wrote the reason to documents.error, which is what the
      // UI shows. Nothing is listening to this throw.
      console.error("ingest failed:", e);
    }
  });

  return json(doc, 201);
});
