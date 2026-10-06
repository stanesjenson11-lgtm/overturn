import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { decodeJwt } from "jose";
import { COOKIE, readCookie, session, signSession } from "@/lib/auth/session";
import { IDLE_SECONDS, PING_EVERY_SECONDS, remainingSeconds } from "@/lib/auth/idle";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { POST as register } from "@/app/api/auth/register/route";
import { findUserById } from "@/lib/db/queries";
import { CONSENT_VERSION } from "@/lib/legal";
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
  const creds = { email: "Tenant@Example.com ", password: "a-long-enough-password", consent: true };

  it("registers, signs in, reads me, and signs out", async () => {
    const created = await register(jsonReq(creds));
    expect(created.status).toBe(201);
    // Normalised on the way in, so "Tenant@Example.com" and "tenant@example.com"
    // are one account rather than two.
    const body = await created.json();
    expect(body.email).toBe("tenant@example.com");
    // Consent is recorded with the notice version it was given against.
    const stored = await findUserById(body.id);
    expect(stored.consented_at).not.toBeNull();
    expect(stored.consent_version).toBe(CONSENT_VERSION);

    const cookie = cookieFrom(created);
    const whoami = await me(new Request("http://localhost/api", { headers: { cookie } }));
    expect(whoami.status).toBe(200);

    expect((await register(jsonReq(creds))).status).toBe(409); // duplicate email
    expect((await login(jsonReq({ ...creds, password: "wrong-password" }))).status).toBe(401);
    expect((await login(jsonReq(creds))).status).toBe(200);

    const out = await logout();
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("tells a missing account from a wrong password, so the form can offer sign-up", async () => {
    // A deliberate product choice (see the login route): registration already
    // reveals whether an email exists, so a vague login message hid nothing.
    const missing = await login(jsonReq({ email: "nobody@example.com", password: "not-a-real-one" }));
    const wrong = await login(jsonReq({ ...creds, password: "also-not-real" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/no account/i);
    expect(wrong.status).toBe(401);
    // And neither one sets a session.
    expect(missing.headers.get("set-cookie")).toBeNull();
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("refuses to register without consent, and creates nothing", async () => {
    for (const consent of [undefined, false, "true"]) {
      const res = await register(jsonReq({ email: "noconsent@example.com", password: "long-enough-pass", consent }));
      expect(res.status).toBe(400);
    }
    const after = await login(jsonReq({ email: "noconsent@example.com", password: "long-enough-pass" }));
    expect(after.status).toBe(404);
  });

  it("refuses a short password", async () => {
    const res = await register(jsonReq({ email: "short@example.com", password: "tiny" }));
    expect(res.status).toBe(400);
  });

  it("sets an httpOnly, same-site cookie scoped to the whole app", async () => {
    const res = await register(jsonReq({ email: "flags@example.com", password: "another-long-one", consent: true }));
    const header = res.headers.get("set-cookie")!;
    // Path=/ matters here in a way it did not in the split deploy: the browser
    // sends this on every request because there is only one origin to send to.
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    // A browser-session cookie: never written to disk, gone when the browser closes.
    expect(header).not.toMatch(/max-age|expires/i);
  });
});

describe("idle sign-out", () => {
  const userId = "11111111-1111-1111-1111-111111111111";

  it("outlives the browser's idle timer by exactly one renewal interval", async () => {
    const { iat, exp } = decodeJwt(await signSession(userId));
    expect(exp! - iat!).toBe(IDLE_SECONDS + PING_EVERY_SECONDS);
  });

  it("refresh re-signs a live session and refuses a missing one", async () => {
    const live = new Request("http://localhost/api", {
      method: "POST",
      headers: { cookie: `${COOKIE}=${await signSession(userId)}` },
    });
    const ok = await refresh(live);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(new RegExp(`^${COOKIE}=[^;]+;`));

    expect((await refresh(new Request("http://localhost/api", { method: "POST" }))).status).toBe(401);
  });

  it("counts down whole seconds from the last activity, stopping at zero", () => {
    expect(remainingSeconds(0, 280_500)).toBe(20);
    expect(remainingSeconds(0, 10 * 60_000)).toBe(0);
  });
});
