import { readFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { hashPassword } from "@/lib/auth/password";
import { applySchema } from "@/lib/db/migrate";
import {
  createCase,
  createDocument,
  createUser,
  findUserByEmail,
  listCases,
} from "@/lib/db/queries";
import { ingest } from "@/lib/ingest";
import { writeFixtures } from "./fixtures";

/**
 * Seeds the demo account with one case: a synthetic policy wording and the
 * rejection letter the moratorium should overturn. Uses the SAME ingest() the
 * upload route uses, so seeded documents and uploaded ones are byte-identical
 * in the database: there is no second embedding path to drift.
 *
 *   npm run seed -- demo@overturn.app "a-long-demo-password"
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

const [email = "demo@overturn.app", password = "overturn-demo-password"] = process.argv.slice(2);
const DEMO = "Shield Health: heart treatment claim";

await applySchema();

const user =
  (await findUserByEmail(email)) ?? (await createUser(email, await hashPassword(password)));
console.log(`user ${user.email}`);

if ((await listCases(user.id)).some((c) => c.title === DEMO)) {
  console.log(`"${DEMO}" already seeded, skipping`);
} else {
  const fixtures = await writeFixtures(path.join(process.cwd(), "eval/fixtures"));
  const demo = await createCase(user.id, DEMO);
  for (const [name, kind] of [
    ["shield-policy", "policy"],
    ["shield-rejection", "rejection"],
  ] as const) {
    const doc = await createDocument(user.id, demo.id, kind, `${name}.pdf`);
    const { pages, chunks } = await ingest(user.id, doc.id, kind, readFileSync(fixtures[name]));
    console.log(`${name}.pdf (${kind}) — ${pages} pages, ${chunks} chunks`);
  }
}

console.log(`\nsign in as ${email}`);
