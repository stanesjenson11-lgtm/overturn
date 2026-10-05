import "./env";
import { required } from "./env";
import { applySchema } from "@/lib/db/migrate";
import { raw } from "@/lib/db/client";

required("DATABASE_URL");

await applySchema();

const [{ tables }] = await raw<{ tables: string }>(
  `SELECT count(*)::text AS tables FROM information_schema.tables WHERE table_schema = 'public'`,
);
console.log(`schema applied — ${tables} tables`);
