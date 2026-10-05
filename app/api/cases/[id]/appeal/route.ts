import { session } from "@/lib/auth/session";
import { getCase, listCaseDocuments, listMessages } from "@/lib/db/queries";
import { badRequest, notFound, route } from "@/lib/http";
import { appealLetter, nextSteps, renderPdf } from "@/lib/letter";
import type { Citation } from "@/lib/rag/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type Meta = { verdict?: { verdict: string; summary: string; grounds: { point: string; cites: string[] }[] } };

/**
 * The appeal letter as a PDF, built from the case's latest verdict. GET,
 * because it only reads: nothing is stored, and asking twice gives the same
 * letter (dated today).
 */
export const GET = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;
  if (!(await getCase(userId, id))) throw notFound();

  // The latest verdict decides, not any verdict: a later review that found the
  // rejection valid must not be overridden by an earlier, hopeful one.
  const latest = (await listMessages(userId, id))
    .filter((m) => (m.meta as Meta | null)?.verdict)
    .at(-1);
  const verdict = (latest?.meta as Meta | undefined)?.verdict;
  if (!latest || verdict?.verdict !== "challengeable")
    throw badRequest("There's no challengeable verdict on this case to build an appeal from.");

  const facts =
    (await listCaseDocuments(userId, id)).find((d) => d.kind === "rejection")?.key_terms ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const pdf = await renderPdf(
    appealLetter({ facts, verdict, citations: (latest.citations as Citation[]) ?? [], today }),
    [nextSteps(today)],
  );

  return new Response(pdf as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="appeal-${today}.pdf"`,
    },
  });
});
