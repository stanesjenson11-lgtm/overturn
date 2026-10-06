import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { POST as register } from "@/app/api/auth/register/route";
import { DELETE as deleteAccount } from "@/app/api/account/route";
import { POST as exportAccount } from "@/app/api/account/export/route";
import { findUserById } from "@/lib/db/queries";
import { startTestDb, stopTestDb } from "./db";

/** A session alone isn't enough to take or destroy an account: the password, again. */

let db: PGlite;
beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => stopTestDb(db));

const PASSWORD = "a-long-password";

const req = (url: string, method: string, cookie: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const exportAs = (cookie: string, body?: unknown) => exportAccount(req("/api/account/export", "POST", cookie, body));
const deleteAs = (cookie: string, body?: unknown) => deleteAccount(req("/api/account", "DELETE", cookie, body));

async function signUp(email: string) {
  const res = await register(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": email },
      body: JSON.stringify({ email, password: PASSWORD, consent: true }),
    }),
  );
  const { id } = (await res.json()) as { id: string };
  return { id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

const failures = async (id: string) =>
  Number(
    (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM security_log WHERE event = 'stepup_failed' AND user_id = $1`, [id]))
      .rows[0].n,
  );

describe("step-up re-authentication", () => {
  it("export: no password 400, a wrong one 403 and logged, the right one the data", async () => {
    const me = await signUp("stepup-export@example.com");

    expect((await exportAs(me.cookie)).status).toBe(400);
    const wrong = await exportAs(me.cookie, { password: "not-it-at-all" });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "That password isn't right." });
    expect(await failures(me.id)).toBe(1);

    const ok = await exportAs(me.cookie, { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { account: { email: string } }).account.email).toBe("stepup-export@example.com");
  });

  it("delete: no password 400, a wrong one 403, the right one deletes the user", async () => {
    const me = await signUp("stepup-delete@example.com");

    expect((await deleteAs(me.cookie, {})).status).toBe(400);
    expect((await deleteAs(me.cookie, { password: "not-it-at-all" })).status).toBe(403);
    expect(await findUserById(me.id)).toBeDefined();

    expect((await deleteAs(me.cookie, { password: PASSWORD })).status).toBe(200);
    expect(await findUserById(me.id)).toBeUndefined();
  });

  it("caps guesses across both routes, and then refuses even the right password", async () => {
    const me = await signUp("stepup-guess@example.com");
    for (let i = 0; i < 3; i++) expect((await deleteAs(me.cookie, { password: `guess-${i}` })).status).toBe(403);
    for (let i = 0; i < 2; i++) expect((await exportAs(me.cookie, { password: `guess-x${i}` })).status).toBe(403);

    // Without the cap before scrypt, a 200 here would confirm the sixth guess.
    expect((await deleteAs(me.cookie, { password: PASSWORD })).status).toBe(429);
    expect(await findUserById(me.id)).toBeDefined();
  });
});
