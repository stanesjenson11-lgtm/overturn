import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "./env";
import { required } from "./env";
import { reviewCase } from "@/lib/agent";
import { findUserByEmail, listCaseDocuments, listCases } from "@/lib/db/queries";
import { assertWithinDailyLimit, recordUsage } from "@/lib/limits";
import type { Citation } from "@/lib/rag/types";

/**
 * Overturn as an MCP server, so Claude Desktop (or any MCP client) can review
 * a rejected claim and get the same cited verdict the web app gives.
 *
 * It drains the same reviewCase() generator as the SSE route and the eval:
 * there is no second agent.
 *
 * Identity is the account named on the command line, the same trust model as
 * `npm run eval`: whoever can run this already holds DATABASE_URL. The daily
 * caps still apply.
 * ponytail: local stdio only. A remote HTTP server with per-user tokens is the
 * upgrade when someone other than the account owner needs it.
 *
 *   npm run mcp -- you@example.com
 */

// stdout IS the protocol channel; one stray console.log anywhere corrupts it.
console.log = console.error;

required("DATABASE_URL");
required("GOOGLE_API_KEY");

const EMAIL = process.argv[2] ?? "demo@overturn.app";
const user = await findUserByEmail(EMAIL);
if (!user) throw new Error(`No account for ${EMAIL}. Register in the app, or run: npm run seed`);

const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  isError,
});

const cite = (c: Citation) => {
  const pages = c.pageEnd !== c.pageStart ? `pp.${c.pageStart}-${c.pageEnd}` : `p.${c.pageStart}`;
  const where = c.source === "regulation" ? `${c.document ?? "IRDAI"}, ${c.heading ?? "clause"}` : c.heading ?? "Clause";
  const quote = c.text.replace(/\s+/g, " ");
  return `[${c.id}] ${where}, ${pages}: "${quote.slice(0, 300)}${quote.length > 300 ? "…" : ""}"`;
};

const server = new McpServer({ name: "overturn", version: "1.0.0" });

server.registerTool(
  "list_cases",
  {
    title: "List cases",
    description:
      "The rejected claims on this Overturn account, with what each rejection letter says (claim number, reason, clauses cited) and the documents uploaded.",
  },
  async () => {
    const cases = await listCases(user.id);
    if (!cases.length) return text("No cases yet.");
    const blocks = await Promise.all(
      cases.map(async (c) => {
        const docs = await listCaseDocuments(user.id, c.id);
        return [
          `${c.title ?? "Untitled case"} (id ${c.id})`,
          ...docs.map((d) => `  ${d.kind}: ${d.filename} (${d.status})`),
          ...(docs.find((d) => d.kind === "rejection")?.key_terms ?? []).map(
            (t) => `    ${t.label}: ${t.value} (p.${t.page})`,
          ),
        ].join("\n");
      }),
    );
    return text(blocks.join("\n\n"));
  },
);

server.registerTool(
  "review_case",
  {
    title: "Review a rejected claim",
    description:
      "Checks a rejection against the policy, IRDAI's rules and deterministic rule checks, and returns a verdict (challengeable, valid or needs more information) with every point cited. Pass a question to ask about one thing instead of a full review.",
    inputSchema: {
      case: z.string().describe("A case id, or part of its title, from list_cases"),
      question: z.string().trim().min(3).max(2000).optional(),
    },
  },
  async ({ case: wanted, question }) => {
    const needle = wanted.toLowerCase();
    const found = (await listCases(user.id)).find(
      (c) => c.id === wanted || (c.title ?? "").toLowerCase().includes(needle),
    );
    if (!found) return text(`No case matching "${wanted}". Use list_cases.`, true);

    const ready = (await listCaseDocuments(user.id, found.id)).filter((d) => d.status === "ready");
    if (!ready.length) return text("That case has no processed documents yet.", true);
    const termsOf = (kind: string) => ready.find((d) => d.kind === kind)?.key_terms ?? [];

    try {
      await assertWithinDailyLimit(user.id);
    } catch (e) {
      return text((e as Error).message, true);
    }

    for await (const event of reviewCase({
      userId: user.id,
      documentIds: ready.map((d) => d.id),
      question: question ?? "Review this rejection: does the reason the insurer gave hold up?",
      history: [],
      review: true,
      facts: { letter: termsOf("rejection"), policy: termsOf("policy") },
    })) {
      if (event.type === "error") return text(event.message, true);
      if (event.type === "done") {
        await recordUsage(user.id, event.usage);
        const head = event.verdict ? `VERDICT: ${event.verdict.verdict.replace("_", " ")}\n\n` : "";
        const asks = event.questionnaire
          ? `\n\nTo decide, the agent needs:\n${event.questionnaire.questions.map((q) => `- ${q.text}`).join("\n")}`
          : "";
        return text([`${head}${event.content}${asks}`, "", ...event.citations.map(cite)].join("\n").trim());
      }
    }
    return text("The review ended without a result.", true);
  },
);

await server.connect(new StdioServerTransport());
