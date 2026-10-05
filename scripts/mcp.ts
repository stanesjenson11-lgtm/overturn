import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "./env";
import { required } from "./env";
import { findUserByEmail, listDocuments } from "@/lib/db/queries";
import { assertWithinDailyLimit, recordUsage } from "@/lib/limits";
import { answerQuestion } from "@/lib/rag/pipeline";
import type { Citation } from "@/lib/rag/types";

/**
 * LeaseLens as an MCP server, so Claude Desktop (or any MCP client) can ask a
 * lease questions and get the same cited answers the web app gives.
 *
 * The third consumer of answerQuestion(), after the SSE route and the eval
 * harness. It drains the same generator; there is no second pipeline.
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

const EMAIL = process.argv[2] ?? "demo@leaselens.app";
const user = await findUserByEmail(EMAIL);
if (!user) throw new Error(`No account for ${EMAIL}. Register in the app, or run: npm run seed`);

const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  isError,
});

const cite = (c: Citation) => {
  const pages = c.pageEnd !== c.pageStart ? `pp.${c.pageStart}-${c.pageEnd}` : `p.${c.pageStart}`;
  const quote = c.text.replace(/\s+/g, " ");
  return `[${c.id}] ${c.heading ?? "Clause"}, ${pages}: "${quote.slice(0, 300)}${quote.length > 300 ? "…" : ""}"`;
};

const server = new McpServer({ name: "leaselens", version: "1.0.0" });

server.registerTool(
  "list_documents",
  {
    title: "List leases",
    description:
      "The leases on this LeaseLens account, with their key terms (rent, deposit, notice and so on) and the page each one comes from.",
  },
  async () => {
    const docs = await listDocuments(user.id);
    if (!docs.length) return text("No documents uploaded yet.");
    return text(
      docs
        .map((d) =>
          [
            `${d.filename} (${d.status}${d.page_count ? `, ${d.page_count} pages` : ""})`,
            ...(d.key_terms ?? []).map((t) => `  ${t.label}: ${t.value} (p.${t.page})`),
          ].join("\n"),
        )
        .join("\n\n"),
    );
  },
);

server.registerTool(
  "ask_lease",
  {
    title: "Ask a lease",
    description:
      "Answers a question from one lease, citing its clauses by page. Says plainly when the lease doesn't cover something instead of guessing. Get filenames from list_documents.",
    inputSchema: {
      document: z.string().describe("A filename from list_documents, e.g. maple-court.pdf"),
      question: z.string().trim().min(3).max(2000),
    },
  },
  async ({ document, question }) => {
    const want = document.replace(/\.pdf$/i, "").toLowerCase();
    const doc = (await listDocuments(user.id)).find(
      (d) => d.id === document || d.filename.replace(/\.pdf$/i, "").toLowerCase() === want,
    );
    if (!doc) return text(`No document called "${document}". Use list_documents for the filenames.`, true);
    if (doc.status !== "ready") return text(`${doc.filename} is still ${doc.status}.`, true);

    try {
      await assertWithinDailyLimit(user.id);
    } catch (e) {
      return text((e as Error).message, true);
    }

    for await (const event of answerQuestion({
      userId: user.id,
      documentId: doc.id,
      question,
      history: [],
    })) {
      if (event.type === "error") return text(event.message, true);
      if (event.type === "done") {
        await recordUsage(user.id, event.usage);
        return text([event.content, "", ...event.citations.map(cite)].join("\n").trim());
      }
    }
    return text("The pipeline ended without an answer.", true);
  },
);

await server.connect(new StdioServerTransport());
