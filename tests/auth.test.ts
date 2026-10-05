import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { COOKIE, readCookie, session, signSession } from "@/lib/auth/session";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { startTestDb, stopTestDb } from "./db";

let db: PGlite;
beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => stopTestDb(db));

const jsonReq = (body: unknown, cookie?: string) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

describe("password hashing", () => {
  it("round-trips, and rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("salts, so identical passwords do not collide in the table", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("stores its own parameters, so they can be raised later", async () => {
    const [scheme, N, r, p] = (await hashPassword("x")).split("$");
    expect([scheme, N, r, p]).toEqual(["scrypt", "32768", "8", "1"]);
  });
});

describe("sessions", () => {
  it("rejects a tampered token", async () => {
    const jwt = await signSession("11111111-1111-1111-1111-111111111111");
    const req = new Request("http://localhost/api", { headers: { cookie: `${COOKIE}=${jwt}x` } });
    await expect(session(req)).rejects.toThrow();
  });

  it("rejects a missing token", async () => {
    await expect(session(new Request("http://localhost/api"))).rejects.toThrow();
  });

  it("parses one cookie out of several", () => {
    const req = new Request("http://localhost/api", {
      headers: { cookie: `other=1; ${COOKIE}=abc; another=2` },
    });
    expect(readCookie(req, COOKIE)).toBe("abc");
  });
});

describe("the auth round trip", () => {
  const creds = { email: "Tenant@Example.com ", password: "a-long-enough-password" };

  it("registers, signs in, reads me, and signs out", async () => {
    const created = await register(jsonReq(creds));
    expect(created.status).toBe(201);
    // Normalised on the way in, so "Tenant@Example.com" and "tenant@example.com"
    // are one account rather than two.
    expect((await created.json()).email).toBe("tenant@example.com");

    const cookie = cookieFrom(created);
    const whoami = await me(new Request("http://localhost/api", { headers: { cookie } }));
    expect(whoami.status).toBe(200);

    expect((await register(jsonReq(creds))).status).toBe(400); // duplicate email
    expect((await login(jsonReq({ ...creds, password: "wrong-password" }))).status).toBe(401);
    expect((await login(jsonReq(creds))).status).toBe(200);

    const out = await logout();
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("gives the same answer whether or not the account exists", async () => {
    const missing = await login(jsonReq({ email: "nobody@example.com", password: "not-a-real-one" }));
    const wrong = await login(jsonReq({ ...creds, password: "also-not-real" }));
    expect(missing.status).toBe(401);
    // Same status and same wording: the response must not be an oracle for
    // which addresses are registered.
    expect(await missing.json()).toEqual(await wrong.json());
  });

  it("refuses a short password", async () => {
    const res = await register(jsonReq({ email: "short@example.com", password: "tiny" }));
    expect(res.status).toBe(400);
  });

  it("sets an httpOnly, same-site cookie scoped to the whole app", async () => {
    const res = await register(jsonReq({ email: "flags@example.com", password: "another-long-one" }));
    const header = res.headers.get("set-cookie")!;
    // Path=/ matters here in a way it did not in the split deploy: the browser
    // sends this on every request because there is only one origin to send to.
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });
});
