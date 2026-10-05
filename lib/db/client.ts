/**
 * The single door to the database, and the second of three tenancy mechanisms.
 *
 *   1. session()          — the only place a user identity enters the system
 *   2. tq()               — this file: refuses, at runtime, to run a statement
 *                           that touches a tenant table without scoping it
 *   3. tenant-guard.test  — scans queries.ts as source text and fails CI on the
 *                           same rule, without needing a database
 *
 * Three overlapping mechanisms rather than one, because the cost of missing a
 * tenant filter is every user's lease.
 */

// The HTTP driver, not the pooled TCP one: a serverless function that opens a
// socket per invocation exhausts Postgres' connection limit long before it
// exhausts anything else.
import { neon } from "@neondatabase/serverless";

export type Row = Record<string, any>;
export type Executor = (text: string, params: unknown[]) => Promise<Row[]>;

export class TenancyViolation extends Error {
  constructor(detail: string) {
    super(`TenancyViolation — unscoped statement against ${detail}`);
    this.name = "TenancyViolation";
  }
}

/** Tables whose rows belong to exactly one user. `users` is not one of them:
 *  a user row *is* the tenant, and is looked up by id or email. */
const TENANT_TABLE =
  /\b(?:from|join|into|update)\s+(documents|chunks|chats|messages|usage|traces)\b/i;

/**
 * Returns a description of the violation, or null if the statement is safe.
 * Exported so the CI scan applies the identical rule to the source text — one
 * definition, checked in two places, rather than two that can drift.
 */
export function tenancyViolation(text: string): string | null {
  const m = TENANT_TABLE.exec(text);
  if (!m) return null;

  const scoped = /^\s*insert\s+into/i.test(text)
    ? // On an INSERT the tenant is asserted by writing the column, not filtering
      // it: look for user_id inside the first parenthesised column list.
      /\(\s*[^)]*\buser_id\b[^)]*\)/i.test(text)
    : /\buser_id\s*=\s*\$\d+/i.test(text);

  return scoped ? null : `${m[1]}: ${text.trim().replace(/\s+/g, " ").slice(0, 120)}`;
}

let executor: Executor | undefined;
let lazy: Executor | undefined;

/** Tests swap in PGlite here; nothing else should call it. */
export function setExecutor(e: Executor | undefined): void {
  executor = e;
  lazy = undefined;
}

function neonExecutor(): Executor {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  return (text, params) => sql.query(text, params as any[]) as Promise<Row[]>;
}

/** Tenant-scoped query. Every statement in queries.ts goes through this. */
export async function tq<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const violation = tenancyViolation(text);
  if (violation) throw new TenancyViolation(violation);
  return raw<T>(text, params);
}

/** Escape hatch for statements with no tenant to scope to: schema DDL, and
 *  `users` lookups during login (there is no session yet to scope by). */
export async function raw<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!executor) lazy ??= neonExecutor();
  return (executor ?? lazy!)(text, params) as Promise<T[]>;
}

/** pgvector accepts a bracketed literal; the driver has no native vector type. */
export const toVector = (v: number[]): string => `[${v.join(",")}]`;
