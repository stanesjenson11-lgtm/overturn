import { createHash } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { decodeJwt, SignJWT } from "jose";
import { COOKIE, readCookie, session, signSession } from "@/lib/auth/session";
import {
  IDLE_SECONDS,
  MAX_SESSION_SECONDS,
  PING_EVERY_SECONDS,
  SIGNED_IN_ELSEWHERE,
  remainingSeconds,
} from "@/lib/auth/idle";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { POST as register } from "@/app/api/auth/register/route";
import { createSession, findUserById } from "@/lib/db/queries";
import { CONSENT_VERSION } from "@/lib/legal";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as logoutAll } from "@/app/api/auth/logout-all/route";
import { GET as me } from "@/app/api/auth/me/route";
import { startTestDb, stopTestDb } from "./db";

let db: PGlite;
beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => stopTestDb(db));

// `ip` gives a test its own rate-limit bucket: registration allows 5 an hour per IP.
const jsonReq = (body: unknown, cookie?: string, ip?: string) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify(body),
  });

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];
const withCookie = (cookie: string) =>
  new Request("http://localhost/api", { method: "POST", headers: { cookie } });

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

  it("has a dummy hash that costs a real one and matches nothing", async () => {
    // Sign-in for an unknown email verifies against this, so its parameters
    // must be the live ones or "no account" answers measurably faster.
    const real = (await hashPassword("x")).split("$");
    const dummy = DUMMY_HASH.split("$");
    expect(dummy.slice(0, 4)).toEqual(real.slice(0, 4));
    expect(dummy.map((s) => s.length)).toEqual(real.map((s) => s.length));
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });
});

describe("sessions", () => {
  it("rejects a tampered token", async () => {
    const jwt = await signSession("11111111-1111-1111-1111-111111111111", crypto.randomUUID());
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

    const out = await logout(withCookie(cookie));
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("says the same thing for an unknown email and a wrong password", async () => {
    // Anything that differs (status, words) tells a caller which emails are
    // registered. Timing is DUMMY_HASH's job, checked above.
    const missing = await login(jsonReq({ email: "nobody@example.com", password: "not-a-real-one" }));
    const wrong = await login(jsonReq({ ...creds, password: "also-not-real" }));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    const said = await missing.json();
    expect(said).toEqual(await wrong.json());
    expect(said.error).toBe("Email or password is incorrect.");
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
    expect(after.status).toBe(401);
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
    const { iat, exp } = decodeJwt(await signSession(userId, crypto.randomUUID()));
    expect(exp! - iat!).toBe(IDLE_SECONDS + PING_EVERY_SECONDS);
  });

  it("refresh re-signs a live session and refuses a missing one", async () => {
    const created = await register(
      jsonReq({ email: "refresh@example.com", password: "refresh-long-password", consent: true }, undefined, "10.0.0.9"),
    );
    const ok = await refresh(withCookie(cookieFrom(created)));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(new RegExp(`^${COOKIE}=[^;]+;`));

    expect((await refresh(new Request("http://localhost/api", { method: "POST" }))).status).toBe(401);
  });

  it("counts down whole seconds from the last activity, stopping at zero", () => {
    expect(remainingSeconds(0, 280_500)).toBe(20);
    expect(remainingSeconds(0, 10 * 60_000)).toBe(0);
  });
});

describe("server-side sessions", () => {
  const creds = { email: "sessions@example.com", password: "sessions-long-password", consent: true };
  const whoami = (cookie: string) => me(new Request("http://localhost/api", { headers: { cookie } }));
  const signIn = async () => cookieFrom(await login(jsonReq(creds)));
  const sessionIdOf = (cookie: string) => decodeJwt(cookie.slice(COOKIE.length + 1)).jti!;
  let userId: string;

  beforeAll(async () => {
    userId = (await (await register(jsonReq(creds, undefined, "10.0.0.1"))).json()).id;
  });

  it("puts the session id in the token, and a new sign-in ends the old one", async () => {
    const first = await signIn();
    expect((await whoami(first)).status).toBe(200);

    const second = await signIn();
    expect(sessionIdOf(second)).not.toBe(sessionIdOf(first));
    expect((await whoami(second)).status).toBe(200);

    // The old browser is refused, and told why, so it can say so.
    const kicked = await whoami(first);
    expect(kicked.status).toBe(401);
    expect((await kicked.json()).error).toBe(SIGNED_IN_ELSEWHERE);

    const { rows } = await db.query<{ ended_reason: string }>(
      `SELECT ended_reason FROM sessions WHERE id = $1`,
      [sessionIdOf(first)],
    );
    expect(rows[0].ended_reason).toBe("replaced");
    const log = await db.query(
      `SELECT 1 FROM security_log WHERE event = 'session_replaced' AND user_id = $1`,
      [userId],
    );
    expect(log.rows.length).toBeGreaterThan(0);
  });

  it("sign-out ends the session on the server, not just the cookie", async () => {
    const cookie = await signIn();
    expect((await logout(withCookie(cookie))).headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await whoami(cookie);
    expect(after.status).toBe(401);
    expect((await after.json()).error).not.toBe(SIGNED_IN_ELSEWHERE);
    // Signing out of a dead or garbage session still clears the cookie.
    expect((await logout(withCookie(cookie))).headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await logout(withCookie(`${COOKIE}=junk`))).headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("sign-out-everywhere ends every session", async () => {
    const cookie = await signIn();
    // A second live session (a sign-in would end the first, so make it directly).
    const other = `${COOKIE}=${await signSession(userId, await createSession(userId))}`;
    expect((await whoami(other)).status).toBe(200);

    const out = await logoutAll(withCookie(cookie));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await whoami(cookie)).status).toBe(401);
    expect((await whoami(other)).status).toBe(401);
    const log = await db.query(
      `SELECT 1 FROM security_log WHERE event = 'logout_all' AND user_id = $1`,
      [userId],
    );
    expect(log.rows).toHaveLength(1);
    // And it needs a live session to act on.
    expect((await logoutAll(withCookie(cookie))).status).toBe(401);
  });

  it("refresh marks the session seen, and no amount of it outlasts 12 hours", async () => {
    const cookie = await signIn();
    const id = sessionIdOf(cookie);
    await db.query(`UPDATE sessions SET last_seen = now() - interval '1 hour' WHERE id = $1`, [id]);
    expect((await refresh(withCookie(cookie))).status).toBe(200);
    const seen = await db.query<{ fresh: boolean }>(
      `SELECT last_seen > now() - interval '1 minute' AS fresh FROM sessions WHERE id = $1`,
      [id],
    );
    expect(seen.rows[0].fresh).toBe(true);

    await db.query(`UPDATE sessions SET created_at = now() - make_interval(secs => $2) WHERE id = $1`, [
      id,
      MAX_SESSION_SECONDS + 60,
    ]);
    expect((await refresh(withCookie(cookie))).status).toBe(401);
    expect((await whoami(cookie)).status).toBe(401);
  });

  it("refuses a validly signed token with no session id (issued before sessions existed)", async () => {
    const legacy = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    expect((await whoami(`${COOKIE}=${legacy}`)).status).toBe(401);
  });

  it("refuses a session id presented under another user", async () => {
    const cookie = await signIn();
    const other = `${COOKIE}=${await signSession("11111111-1111-1111-1111-111111111111", sessionIdOf(cookie))}`;
    expect((await whoami(other)).status).toBe(401);
  });
});

describe("leaked-password check", () => {
  // Skipped under test so no suite touches the network; switched on here,
  // against a stubbed fetch.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const leaked = "correct-horse-battery-staple";
  const sha1 = createHash("sha1").update(leaked).digest("hex").toUpperCase();
  const signUp = (email: string, ip: string) =>
    register(jsonReq({ email, password: leaked, consent: true }, undefined, ip));

  it("refuses a breached password, sending only the first 5 hash characters", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      // A padding decoy (count 0), then the hit, with the API's CRLF line endings.
      new Response(`${"0".repeat(35)}:0\r\n${sha1.slice(5)}:3861493\r\n`),
    );
    vi.stubGlobal("fetch", fetch);

    const res = await signUp("leaked@example.com", "10.0.0.2");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "This password has appeared in a data breach. Please choose a different one.",
    );
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    expect(new Headers(init?.headers).get("add-padding")).toBe("true");
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(sha1.slice(5));
  });

  it("does not count a padding decoy (count 0) as a match", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`${sha1.slice(5)}:0\r\n`)));
    expect((await signUp("decoy@example.com", "10.0.0.3")).status).toBe(201);
  });

  it("lets registration through when the API can't be reached", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    expect((await signUp("offline@example.com", "10.0.0.4")).status).toBe(201);
    expect(warn).toHaveBeenCalled();
  });
});
