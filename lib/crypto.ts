import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Field encryption for what a user typed or was told: messages, verdicts,
 * case titles, file names, key terms.
 *
 * Neon already encrypts the disk (AES-256) and only speaks TLS, so this is the
 * layer for the cases that doesn't cover: a leaked backup, a console session,
 * a read-only SQL bug. Without DATA_KEY, those rows are ciphertext.
 *
 * The owner's user id is bound in as associated data, so a ciphertext copied
 * into another tenant's row fails to decrypt rather than showing up there.
 *
 * ponytail: chunk text stays plaintext — Postgres has to read it to search it
 * (the tsvector is generated from it). Encrypting it means a stored, stripped
 * tsvector and an eval run to confirm retrieval holds.
 */

const PREFIX = "v1:";

function key(): Buffer {
  const k = Buffer.from(process.env.DATA_KEY ?? "", "base64");
  if (k.length !== 32)
    throw new Error("DATA_KEY must be 32 random bytes, base64: `openssl rand -base64 32`");
  return k;
}

export function seal(owner: string, text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv).setAAD(Buffer.from(owner));
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function open(owner: string, value: string): string {
  // Rows written before encryption existed read as they are.
  if (!value.startsWith(PREFIX)) return value;
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12)).setAAD(Buffer.from(owner));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** For jsonb columns: the column holds one JSON string, the sealed document. */
export const sealJson = (owner: string, v: unknown) =>
  v == null ? null : JSON.stringify(seal(owner, JSON.stringify(v)));

export const openJson = (owner: string, v: unknown) =>
  typeof v === "string" && v.startsWith(PREFIX) ? JSON.parse(open(owner, v)) : v;
