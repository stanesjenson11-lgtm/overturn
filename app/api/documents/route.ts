import { after } from "next/server";
import { session } from "@/lib/auth/session";
import {
  countDocuments,
  createDocument,
  DOC_KINDS,
  getCase,
  listCaseDocuments,
  listDocuments,
} from "@/lib/db/queries";
import { ingest } from "@/lib/ingest";
import { MAX_DOCS_PER_USER, toPdf } from "@/lib/ingest/pdf";
import { badRequest, json, notFound, route } from "@/lib/http";
import { assertWithinDailyLimit, rateLimit } from "@/lib/limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  await rateLimit(`upload:user:${userId}`, 20, 60 * 60);

  const form = await req.formData();
  // One PDF, or several photos of one document, a page each. Nobody says which
  // document it is: ingest reads it and files it.
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest("No file was uploaded.");

  // The case id arrives from the client, so it is checked against this tenant
  // before anything is stored: otherwise a document could be filed into
  // someone else's case, and their next answer would quote it. A malformed id
  // gets the same 404 as someone else's.
  const caseId = String(form.get("caseId") ?? "");
  if (!UUID.test(caseId) || !(await getCase(userId, caseId))) throw notFound();
  // One of each kind per case, so a fourth document can only be a duplicate.
  // Failed ones don't count: they're on screen with their reason, to delete.
  const held = (await listCaseDocuments(userId, caseId)).filter((d) => d.status !== "failed");
  if (held.length >= DOC_KINDS.length)
    throw badRequest("This case already has its three documents. Delete one to add another.");

  // Size, count, magic bytes and active content are all checked before
  // anything is parsed; photos come back as one PDF, a page each.
  const bytes = await toPdf(
    await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))),
  );

  // Shown back in the UI and the chat export: no control characters, bounded.
  const name = files[0].name.replace(/\p{Cc}/gu, "").trim().slice(0, 160) || "document";
  const filename = files.length > 1 ? `${files.length} photos (${name}, …)` : name;
  const doc = await createDocument(userId, caseId, null, filename);

  // after() keeps the invocation alive past the response, so the client gets an
  // id to poll immediately instead of holding a request open for 30 seconds.
  // Note this still runs inside maxDuration — it defers the work, not the cap.
  after(async () => {
    try {
      await ingest(userId, doc.id, null, bytes);
    } catch (e) {
      // ingest() already wrote the reason to documents.error, which is what the
      // UI shows. Nothing is listening to this throw.
      console.error("ingest failed:", e);
    }
  });

  return json(doc, 201);
});
