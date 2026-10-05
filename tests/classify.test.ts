import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { extractText } from "unpdf";
import { classify } from "@/lib/ingest/classify";
import { createCase, createDocument, createUser, listCaseDocuments, setDocumentKind } from "@/lib/db/queries";
import { startTestDb, stopTestDb } from "./db";

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../samples");
const pagesOf = async (file: string) => {
  const { text } = await extractText(new Uint8Array(readFileSync(path.join(samples, file))), { mergePages: false });
  return text.map((t, i) => ({ number: i + 1, text: t }));
};
const page = (text: string) => [{ number: 1, text }];

describe("which document is this", () => {
  // Every sample with a text layer (the scanned letter is letter 1 again).
  const files = readdirSync(samples).filter((f) => f.endsWith(".pdf") && !f.includes("SCANNED"));

  it.each(files)("%s", async (file) => {
    expect(classify(await pagesOf(file))).toBe(file.startsWith("letter-") ? "rejection" : "policy");
  });

  it("knows a discharge summary", () => {
    const summary = `CITY CARE HOSPITAL, PUNE — DISCHARGE SUMMARY
      Patient: R. Sharma  Date of admission: 02/10/2025  Date of discharge: 06/10/2025
      Chief complaints: chest pain on exertion for two weeks.
      Final diagnosis: coronary artery disease, triple vessel.
      Course in hospital: underwent coronary angioplasty with two stents.
      Condition at discharge: stable. Advice on discharge: review in one week.`;
    expect(classify(page(summary))).toBe("medical");
  });

  it("isn't fooled by a policy that explains repudiation, or a letter that quotes the policy", () => {
    const policy = `POLICY WORDING. 1. DEFINITIONS. "Hospital" means any institution... 4. EXCLUSIONS.
      The Company may repudiate a claim found to be fraudulent.`;
    const letter = `Dear Policyholder, we regret to inform you that your claim is not payable under
      Clause 4.1 (Exclusions) of the policy wording.`;
    expect(classify(page(policy))).toBe("policy");
    expect(classify(page(letter))).toBe("rejection");
  });

  it("files anything unrecognisable as a supporting medical document", () => {
    expect(classify(page("Pharmacy receipt: paracetamol 500mg x 10"))).toBe("medical");
    expect(classify(page(""))).toBe("medical");
  });
});

describe("filing it", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => stopTestDb(db));

  it("holds one of each kind per case: a second letter is refused", async () => {
    const user = await createUser("kinds@example.com", "x", "test");
    const claim = await createCase(user.id, "claim");
    const first = await createDocument(user.id, claim.id, null, "letter.pdf");
    const second = await createDocument(user.id, claim.id, null, "letter-again.pdf");
    // Unread documents don't collide: their kind is null.
    expect((await listCaseDocuments(user.id, claim.id)).map((d) => d.kind)).toEqual([null, null]);

    await setDocumentKind(user.id, first.id, "rejection");
    await expect(setDocumentKind(user.id, second.id, "rejection")).rejects.toThrow(/unique|duplicate/i);
    await expect(setDocumentKind(user.id, second.id, "policy")).resolves.toBeUndefined();
  });
});
