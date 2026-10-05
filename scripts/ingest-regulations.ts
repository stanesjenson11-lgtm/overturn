import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { replaceRegulation } from "@/lib/db/queries";
import { chunkPages } from "@/lib/ingest/chunk";
import { extractPages } from "@/lib/ingest/pdf";
import { embed } from "@/lib/rag/embed";

/**
 * Loads the public regulations every case is checked against, from IRDAI and
 * the Council for Insurance Ombudsmen, into reg_chunks.
 *
 * Primary documents only. Secondary coverage gets details wrong: the 36-month
 * pre-existing-disease cap is widely attributed to the Master Circular, but it
 * lives in the Insurance Products Regulations. PDFs are cached in corpus/
 * (gitignored); delete one to re-download it. Re-running replaces each
 * source's rows, so it is safe to repeat.
 *
 *   npm run ingest-regulations
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

// The free tier embeds 100 texts a minute and the regulations run past that,
// so a 429 here asks for a ~30s wait. A chat request can't afford it; this
// script can.
process.env.RETRY_429_MAX_S ??= "65";

const IRDAI = "https://irdai.gov.in/documents/37343";

const SOURCES = [
  {
    source: "master-circular-health-2024",
    title: "IRDAI Master Circular on Health Insurance Business (29.05.2024)",
    url: `${IRDAI}/991022/%E0%A4%B8%E0%A5%8D%E0%A4%B5%E0%A4%BE%E0%A4%B8%E0%A5%8D%E0%A4%A5%E0%A5%8D%E0%A4%AF+%E0%A4%AC%E0%A5%80%E0%A4%AE%E0%A4%BE+%E0%A4%B5%E0%A5%8D%E0%A4%AF%E0%A4%B5%E0%A4%B8%E0%A4%BE%E0%A4%AF+%E0%A4%AA%E0%A4%B0+%E0%A4%AE%E0%A4%BE%E0%A4%B8%E0%A5%8D%E0%A4%9F%E0%A4%B0+%E0%A4%AA%E0%A4%B0%E0%A4%BF%E0%A4%AA%E0%A4%A4%E0%A5%8D%E0%A4%B0-%E0%A4%85%E0%A4%82%E0%A4%97%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%9C%E0%A5%80+_+Master+Circular+on+Health+Insurance+Business+-English.pdf/08a32828-dc1d-116f-0549-6db86d448651`,
  },
  {
    source: "insurance-products-regulations-2024",
    title: "IRDAI (Insurance Products) Regulations, 2024",
    url: `${IRDAI}/366405/%E0%A4%86%E0%A4%88%E0%A4%86%E0%A4%B0%E0%A4%A1%E0%A5%80%E0%A4%8F%E0%A4%86%E0%A4%88+%28%E0%A4%AC%E0%A5%80%E0%A4%AE%E0%A4%BE+%E0%A4%89%E0%A4%A4%E0%A5%8D%E0%A4%AA%E0%A4%BE%E0%A4%A6%29+%E0%A4%B5%E0%A4%BF%E0%A4%A8%E0%A4%BF%E0%A4%AF%E0%A4%AE%2C+2024+_+IRDAI+%28Insurance+Products%29+Regulations%2C+2024.pdf/eb55db8a-a617-d492-b313-f13cfb11afeb?version=1.2&t=1712320142367&download=true`,
  },
  {
    source: "insurance-ombudsman-rules-2017",
    title: "Insurance Ombudsman Rules, 2017 (as amended to 18.05.2021)",
    url: "https://www.cioins.co.in/notification/INSURANCE%20OMBUDSMAN%20RULES,%202017%20AS%20AMENDED%20TILL%2018.05.2021%20(1).pdf",
  },
];

const corpus = path.join(process.cwd(), "corpus");
mkdirSync(corpus, { recursive: true });

for (const s of SOURCES) {
  const file = path.join(corpus, `${s.source}.pdf`);
  if (!existsSync(file)) {
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`${s.source}: download failed (${res.status}). Fetch it by hand into ${file}.`);
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  }

  const bytes = new Uint8Array(readFileSync(file));
  // A government site that answers a moved document with an HTML page would
  // otherwise be ingested as a regulation.
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw new Error(`${s.source}: ${file} isn't a PDF. Delete it and re-run, or fetch it by hand.`);

  const chunks = chunkPages(await extractPages(bytes));
  const vectors = await embed(
    chunks.map((c) => c.content),
    "RETRIEVAL_DOCUMENT",
  );
  await replaceRegulation(
    s.source,
    s.title,
    chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
  );
  console.log(`${s.source}: ${chunks.length} clauses`);
}
