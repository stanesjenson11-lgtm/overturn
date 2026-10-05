import { session } from "@/lib/auth/session";
import {
  findUserById,
  listCaseDocuments,
  listCases,
  listMessages,
  logSecurityEvent,
} from "@/lib/db/queries";
import { route, unauthorized } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/limits";

export const runtime = "nodejs";

/**
 * Everything Overturn holds about you, as JSON (DPDP Act s.11, the right to
 * access): the account, every case, what was read from each document, and
 * every message with its citations and verdict. Not the documents' full text:
 * that's the file you uploaded, and you already have it.
 */
export const GET = route(async (req: Request) => {
  const { userId } = await session(req);
  await rateLimit(`export:user:${userId}`, 5, 60 * 60);

  const user = await findUserById(userId);
  if (!user) throw unauthorized();

  const cases = await Promise.all(
    (await listCases(userId)).map(async (c) => ({
      title: c.title,
      created_at: c.created_at,
      documents: (await listCaseDocuments(userId, c.id)).map((d) => ({
        kind: d.kind,
        filename: d.filename,
        pages: d.page_count,
        status: d.status,
        key_terms: d.key_terms,
        uploaded_at: d.created_at,
      })),
      messages: (await listMessages(userId, c.id)).map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations,
        verdict: m.meta,
        at: m.created_at,
      })),
    })),
  );

  await logSecurityEvent("data_exported", userId, clientIp(req));
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    exported_at: new Date().toISOString(),
    account: {
      email: user.email,
      created_at: user.created_at,
      consented_at: user.consented_at,
      consent_version: user.consent_version,
    },
    cases,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="overturn-data-${today}.json"`,
    },
  });
});
