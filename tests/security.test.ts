import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { DELETE as deleteAccount } from "@/app/api/account/route";
import { GET as exportAccount } from "@/app/api/account/export/route";
import { GET as exportCase } from "@/app/api/cases/[id]/export/route";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { open, seal } from "@/lib/crypto";
import { createCase, createDocument, insertChunks, insertMessage, listMessages } from "@/lib/db/queries";
import { assertSafePdf, toPdf } from "@/lib/ingest/pdf";
import { rateLimit } from "@/lib/limits";
import { fakeEmbedding, startTestDb, stopTestDb } from "./db";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let db: PGlite;
beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => stopTestDb(db));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const req = (url: string, init: { method?: string; body?: unknown; cookie?: string; ip?: string } = {}) =>
  new Request(`http://localhost${url}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.ip ? { "x-forwarded-for": init.ip } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function actor(email: string) {
  const res = await register(req("/api/auth/register", { body: { email, password: "a-long-password", consent: true }, ip: email }));
  const { id } = (await res.json()) as { id: string };
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const claim = await createCase(id, `${email} claim`);
  const doc = await createDocument(id, claim.id, "policy", `${email}.pdf`);
  await insertChunks(id, doc.id, [
    { ordinal: 0, headingPath: null, pageStart: 1, pageEnd: 1, content: `clause for ${email}`, embedding: fakeEmbedding(1) },
  ]);
  await insertMessage(id, claim.id, "user", `diagnosis of ${email}`);
  return { id, cookie, caseId: claim.id };
}

describe("field encryption", () => {
  it("round-trips, and binds a value to its owner", () => {
    const sealed = seal("user-a", "angioplasty, 2024");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("angioplasty");
    expect(open("user-a", sealed)).toBe("angioplasty, 2024");
    // Copied into another tenant's row, it doesn't decrypt.
    expect(() => open("user-b", sealed)).toThrow();
  });

  it("refuses a tampered value", () => {
    const sealed = seal("u", "x".repeat(40));
    const flipped = sealed.slice(0, -6) + (sealed.at(-6) === "A" ? "B" : "A") + sealed.slice(-5);
    expect(() => open("u", flipped)).toThrow();
  });

  it("reads rows written before encryption as they are", () => {
    expect(open("u", "plain old title")).toBe("plain old title");
  });

  it("refuses to run without a proper key", () => {
    vi.stubEnv("DATA_KEY", "too-short");
    expect(() => seal("u", "x")).toThrow(/DATA_KEY/);
  });

  it("stores ciphertext, and the app still reads plaintext", async () => {
    const u = await actor("cipher@example.com");
    const { rows } = await db.query<{ content: string; title: string }>(
      `SELECT m.content, c.title FROM messages m JOIN cases c ON c.id = m.case_id WHERE m.user_id = $1`,
      [u.id],
    );
    expect(rows[0].content.startsWith("v1:")).toBe(true);
    expect(rows[0].content).not.toContain("diagnosis");
    expect(rows[0].title).not.toContain("cipher@example.com");
    expect((await listMessages(u.id, u.caseId))[0].content).toBe("diagnosis of cipher@example.com");
  });
});

describe("rate limiting", () => {
  it("allows the limit, then answers 429", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("test:a", 3, 3600);
    await expect(rateLimit("test:a", 3, 3600)).rejects.toMatchObject({ status: 429 });
    // Another key has its own count.
    await expect(rateLimit("test:b", 3, 3600)).resolves.toBeUndefined();
  });

  it("stops password guessing on one account", async () => {
    await actor("guess@example.com");
    const attempt = () =>
      login(req("/api/auth/login", { body: { email: "guess@example.com", password: "wrong-guess-123" }, ip: "9.9.9.9" }));
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe("the bot check", () => {
  it("refuses a token Cloudflare doesn't vouch for", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetch = vi.fn(async () => Response.json({ success: false }));
    vi.stubGlobal("fetch", fetch);
    await expect(verifyTurnstile("token", "1.2.3.4")).rejects.toMatchObject({ status: 400 });
    // No token at all never reaches Cloudflare.
    await expect(verifyTurnstile(undefined, "1.2.3.4")).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts one it does", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true })));
    await expect(verifyTurnstile("token", "1.2.3.4")).resolves.toBeUndefined();
  });

  it("fails closed in production without a secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await expect(verifyTurnstile("token", "1.2.3.4")).rejects.toThrow(/TURNSTILE_SECRET_KEY/);
  });
});

describe("uploads", () => {
  it("refuses a PDF that runs JavaScript on open, even inside a compressed object stream", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const action = doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert(1)") });
    doc.catalog.set(PDFName.of("OpenAction"), doc.context.register(action));
    const bytes = await doc.save(); // object streams on: the action is compressed
    expect(Buffer.from(bytes).includes("JavaScript")).toBe(false);
    await expect(assertSafePdf(bytes)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an encrypted PDF it can't look inside", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: "Standard", V: 1, R: 2 });
    const bytes = await doc.save({ useObjectStreams: false });
    await expect(assertSafePdf(bytes)).rejects.toThrow(/encrypted/);
  });

  it("refuses a PNG whose header promises a decompression bomb", async () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 10_000);
    new DataView(png.buffer).setUint32(20, 10_000);
    await expect(toPdf([png])).rejects.toThrow(/too large/);
  });

  it("accepts the real samples, text and scanned", async () => {
    for (const f of ["shield-health-policy-wording.pdf", "letter-8-heart-nondisclosure-SCANNED.pdf"])
      await expect(assertSafePdf(readFileSync(path.join(root, "samples", f)))).resolves.toBeUndefined();
  });
});

describe("your data", () => {
  it("exports only your own cases, as JSON and as a chat PDF", async () => {
    const a = await actor("export-a@example.com");
    const b = await actor("export-b@example.com");

    const json = await (await exportAccount(req("/api/account/export", { cookie: a.cookie }))).text();
    expect(json).toContain("export-a@example.com claim");
    expect(json).toContain("diagnosis of export-a@example.com");
    expect(json).not.toContain("export-b@example.com");

    const pdf = await exportCase(req(`/api/cases/${a.caseId}/export`, { cookie: a.cookie }), ctx(a.caseId));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    // Someone else's case: the same 404 as a case that doesn't exist.
    expect((await exportCase(req(`/api/cases/${b.caseId}/export`, { cookie: a.cookie }), ctx(b.caseId))).status).toBe(404);
  });

  it("deletes the whole account, and only that account, given the password", async () => {
    const a = await actor("erase-a@example.com");
    const b = await actor("erase-b@example.com");

    const wrong = await deleteAccount(req("/api/account", { method: "DELETE", body: { password: "not-it-at-all" }, cookie: a.cookie }));
    expect(wrong.status).toBe(403);

    const ok = await deleteAccount(req("/api/account", { method: "DELETE", body: { password: "a-long-password" }, cookie: a.cookie }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("Max-Age=0");

    for (const table of ["cases", "documents", "chunks", "messages", "usage", "traces"]) {
      const count = async (id: string) =>
        Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE user_id = $1`, [id])).rows[0].n);
      expect(await count(a.id), table).toBe(0);
      if (["cases", "documents", "chunks", "messages"].includes(table)) expect(await count(b.id), table).toBe(1);
    }
    const { rows } = await db.query(`SELECT 1 FROM security_log WHERE event = 'account_deleted' AND user_id = $1`, [a.id]);
    expect(rows).toHaveLength(1);
  });
});
