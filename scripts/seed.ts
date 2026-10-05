import { readFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { hashPassword } from "@/lib/auth/password";
import { applySchema } from "@/lib/db/migrate";
import {
  createDocument,
  createUser,
  findUserByEmail,
  listChunks,
  listDocuments,
  setDocumentStatus,
} from "@/lib/db/queries";
import { ingest } from "@/lib/ingest";
import { extractKeyTerms } from "@/lib/ingest/terms";
import { writeFixtures } from "./fixtures";

/**
 * Seeds the demo account. Uses the SAME ingest() the upload route uses, so a
 * seeded lease and an uploaded one are byte-identical in the database — there
 * is no second embedding path to drift.
 *
 *   npm run seed -- demo@leaselens.app "a-long-demo-password"
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

const [email = "demo@leaselens.app", password = "leaselens-demo-password"] = process.argv.slice(2);

await applySchema();

const user =
  (await findUserByEmail(email)) ?? (await createUser(email, await hashPassword(password)));
console.log(`user ${user.email}`);

const fixtures = await writeFixtures(path.join(process.cwd(), "eval/fixtures"));
const existing = new Map((await listDocuments(user.id)).map((d) => [d.filename, d]));

for (const [name, file] of Object.entries(fixtures)) {
  const filename = `${name}.pdf`;
  const seeded = existing.get(filename);
  if (seeded) {
    // Seeded before key terms existed: fill them in from the stored chunks
    // rather than re-ingesting, which would orphan the demo account's chats.
    if (seeded.status === "ready" && seeded.key_terms == null) {
      const { terms } = await extractKeyTerms(await listChunks(user.id, seeded.id));
      await setDocumentStatus(user.id, seeded.id, "ready", { keyTerms: terms });
      console.log(`${filename} — already seeded, backfilled ${terms.length} key terms`);
    } else console.log(`${filename} — already seeded, skipping`);
    continue;
  }

  const doc = await createDocument(user.id, filename);
  const { pages, chunks } = await ingest(user.id, doc.id, readFileSync(file));
  console.log(`${filename} — ${pages} pages, ${chunks} chunks`);
}

console.log(`\nsign in as ${email}`);
