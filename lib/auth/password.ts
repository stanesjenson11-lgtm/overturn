import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: object,
) => Promise<Buffer>;

/**
 * scrypt (RFC 7914) out of the standard library, rather than argon2id out of a
 * native module. argon2 is the better primitive on paper; scrypt is memory-hard,
 * built in, and cannot break a serverless build the way a node-gyp dependency
 * can. The parameters are stored alongside each hash so they can be raised
 * later without invalidating existing passwords.
 */
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEYLEN = 64;

// scrypt's default maxmem is 32 MB and 128*N*r is exactly 32 MB, so the default
// throws. This is a runtime-only failure — nothing about the call looks wrong.
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, sN, sR, sP, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt") return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(sN),
    r: Number(sR),
    p: Number(sP),
    maxmem: MAXMEM,
  });
  // Constant-time: a length check first, because timingSafeEqual throws on a
  // length mismatch and a thrown error is itself a timing signal.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * What sign-in checks the password against when there is no such account: the
 * live parameters, so it costs exactly one real scrypt, and a stored key of
 * zeros that no password produces. Without it, "no account" answers in
 * microseconds and "wrong password" in a hundred milliseconds, and the
 * difference tells anyone which emails are registered.
 */
export const DUMMY_HASH = `scrypt$${N}$${r}$${p}$${"00".repeat(16)}$${"00".repeat(KEYLEN)}`;

/**
 * Has this password appeared in a known data breach? Asks Have I Been Pwned's
 * range API (https://haveibeenpwned.com/API/v3#PwnedPasswords): only the first
 * 5 hex chars of the password's SHA-1 leave this server (k-anonymity), and the
 * reply is every "SUFFIX:COUNT" line under that prefix. `Add-Padding: true`
 * mixes in 800–1,000 decoy lines with a count of 0, so the response size says
 * nothing about the prefix; a 0 count is therefore never a match. Free, no API
 * key, no rate limit.
 *
 * Fails open: if the API is down or slower than 3 s, registration goes ahead.
 * A breach list being unreachable is not a reason to lock people out.
 * Skipped under test, so no suite depends on the network.
 */
export async function isPwned(password: string): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return false;
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const line of (await res.text()).split("\n")) {
      const [suffix, count] = line.trim().split(":");
      if (suffix?.toUpperCase() === sha1.slice(5)) return Number(count) > 0;
    }
    return false;
  } catch (e) {
    console.warn("Pwned Passwords check skipped:", e);
    return false;
  }
}
