import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
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
