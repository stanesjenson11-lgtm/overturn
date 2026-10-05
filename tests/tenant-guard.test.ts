import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setExecutor, TenancyViolation, tenancyViolation, tq } from "@/lib/db/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "lib/db/queries.ts"), "utf8");

/** Every backticked literal that looks like a SQL statement. */
const statements = [...source.matchAll(/`([^`]*)`/g)]
  .map((m) => m[1].trim())
  .filter((s) => /^(select|insert|update|delete|with)\b/i.test(s));

describe("the tenant guard", () => {
  it("finds the statements it claims to be checking", () => {
    // Without this, a regex that stopped matching would make the whole suite
    // pass by checking nothing at all — the classic vacuous green.
    expect(statements.length).toBeGreaterThanOrEqual(20);
  });

  it("flags an unscoped statement", () => {
    // The negative control. If this ever returns null, the check below is
    // meaningless no matter how green it is.
    expect(tenancyViolation("SELECT * FROM chats WHERE id = $1")).toContain("chats");
    expect(tenancyViolation("INSERT INTO messages (chat_id, role) VALUES ($1, $2)")).toContain(
      "messages",
    );
    expect(tenancyViolation("DELETE FROM documents WHERE id = $1")).toContain("documents");
  });

  it("does not flag statements against non-tenant tables", () => {
    expect(tenancyViolation("SELECT id FROM users WHERE email = $1")).toBeNull();
  });

  describe("at runtime", () => {
    afterEach(() => setExecutor(undefined));

    it("throws instead of returning another tenant's rows", async () => {
      // An executor that would happily leak. The guard is what stops it, not
      // the database and not the caller's discipline.
      setExecutor(async () => [{ someone_elses: "lease" }]);

      await expect(tq("SELECT * FROM chats WHERE id = $1", ["x"])).rejects.toThrow(
        TenancyViolation,
      );
      await expect(tq("SELECT * FROM chats WHERE user_id = $1", ["x"])).resolves.toHaveLength(1);
    });
  });

  it.each(statements.map((s) => [s.replace(/\s+/g, " ").slice(0, 70), s] as const))(
    "scopes: %s",
    (_label, statement) => {
      // This is the assertion that fails the build if anyone deletes an
      // `AND user_id = $1` — before a database is even reachable.
      expect(tenancyViolation(statement)).toBeNull();
    },
  );
});
