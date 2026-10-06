import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as uploadDoc } from "@/app/api/documents/route";
import { DELETE as deleteDoc } from "@/app/api/documents/[id]/route";
import { DELETE as deleteCaseRoute } from "@/app/api/cases/[id]/route";
import { GET as exportCase } from "@/app/api/cases/[id]/export/route";
import { createCase } from "@/lib/db/queries";
import { startTestDb, stopTestDb } from "./db";

// The upload's background read (parse, embed, model calls) is not what's under
// test, and after() needs a live Next request around it.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IP = "203.0.113.7";

let db: PGlite;
beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => stopTestDb(db));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, cookie: string, body?: BodyInit) =>
  new Request(`http://localhost${url}`, { method, headers: { cookie, "x-forwarded-for": IP }, body });

describe("per-document audit trail", () => {
  it("logs upload, delete, chat export and case delete: ids and IP, never names", async () => {
    const res = await register(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "audit" },
        body: JSON.stringify({ email: "audit@example.com", password: "a-long-password", consent: true }),
      }),
    );
    const { id: userId } = (await res.json()) as { id: string };
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const claim = await createCase(userId, "audit claim");

    const form = new FormData();
    const pdf = readFileSync(path.join(root, "samples", "letter-1-heart-nondisclosure.pdf"));
    form.append("file", new File([pdf], "letter-1-heart-nondisclosure.pdf", { type: "application/pdf" }));
    form.append("caseId", claim.id);
    const up = await uploadDoc(req("/api/documents", "POST", cookie, form));
    expect(up.status).toBe(201);
    const doc = (await up.json()) as { id: string };

    expect((await deleteDoc(req(`/api/documents/${doc.id}`, "DELETE", cookie), ctx(doc.id))).status).toBe(200);
    expect((await exportCase(req(`/api/cases/${claim.id}/export`, "GET", cookie), ctx(claim.id))).status).toBe(200);
    expect((await deleteCaseRoute(req(`/api/cases/${claim.id}`, "DELETE", cookie), ctx(claim.id))).status).toBe(200);

    const { rows } = await db.query<{ event: string; ip: string }>(
      `SELECT event, ip FROM security_log
        WHERE user_id = $1 AND (event LIKE 'document\\_%' OR event LIKE 'case\\_%') ORDER BY id`,
      [userId],
    );
    expect(rows.map((r) => r.event)).toEqual([
      `document_uploaded:${doc.id}`,
      `document_deleted:${doc.id}`,
      `case_exported:${claim.id}`,
      `case_deleted:${claim.id}`,
    ]);
    expect(rows.every((r) => r.ip === IP)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("heart");
  });
});
