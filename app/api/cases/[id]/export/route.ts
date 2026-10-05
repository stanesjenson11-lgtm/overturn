import { session } from "@/lib/auth/session";
import { getCase, listCaseDocuments, listMessages } from "@/lib/db/queries";
import { notFound, route } from "@/lib/http";
import { renderPdf } from "@/lib/letter";
import { rateLimit } from "@/lib/limits";
import type { Citation } from "@/lib/rag/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const KIND = { policy: "Policy wording", rejection: "Rejection letter", medical: "Medical document" };
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/**
 * The case's conversation as a PDF: every question, every answer, and the
 * exact passage behind each [P#]/[R#] citation, so the copy stands on its own
 * in front of a grievance officer or a lawyer without the app.
 */
export const GET = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  await rateLimit(`export:user:${userId}`, 20, 60 * 60);
  const { id } = await ctx.params;
  const found = await getCase(userId, id);
  if (!found) throw notFound();

  const [docs, messages] = await Promise.all([listCaseDocuments(userId, id), listMessages(userId, id)]);
  const today = new Date().toISOString().slice(0, 10);

  const out = [
    found.title ?? "Untitled case",
    `Exported from Overturn on ${when(new Date().toISOString())} IST`,
    "",
    "Documents",
    ...(docs.length ? docs.map((d) => `- ${d.kind ? KIND[d.kind] : "Document"}: ${d.filename}`) : ["- none"]),
  ];

  for (const m of messages) {
    out.push("", "", `${m.role === "user" ? "You" : "Overturn"}, ${when(m.created_at)}`, "", m.content);
    const cites = (m.citations as Citation[] | null) ?? [];
    if (cites.length) {
      out.push("", "Sources");
      for (const c of cites) {
        const pages = c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `pp. ${c.pageStart}-${c.pageEnd}`;
        out.push(`[${c.id}] ${c.document ?? (c.source === "regulation" ? "IRDAI" : "Your document")}${c.heading ? `, ${c.heading}` : ""}, ${pages}: "${c.text.replace(/\s+/g, " ").trim()}"`);
      }
    }
  }

  out.push("", "", "Information from your documents and IRDAI's rules, not legal or medical advice.");

  // A fixed filename: nothing the user typed reaches a response header.
  return new Response((await renderPdf(out.join("\n"))) as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="overturn-case-${today}.pdf"`,
    },
  });
});
