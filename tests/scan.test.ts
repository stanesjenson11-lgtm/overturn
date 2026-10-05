import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { cer } from "@/scripts/cer";
import { renderScan, SHIELD_REJECTION } from "@/scripts/fixtures";

describe("character error rate", () => {
  it("counts edits over the truth's length, ignoring how lines wrap", () => {
    expect(cer("Claim SH/CLM/2025", "Claim SH/CLM/2025")).toBe(0);
    expect(cer("Claim no 123", "Claim  no\n123")).toBe(0);
    expect(cer("abcd", "abxd")).toBe(0.25);
    expect(cer("abcd", "")).toBe(1);
  });
});

describe("a rendered scan", () => {
  it("has no text layer, so ingest has to read it as a scan", async () => {
    const { text } = await extractText(new Uint8Array(await renderScan(SHIELD_REJECTION)), {
      mergePages: true,
    });
    expect(text.trim()).toBe("");
  });

  it("is the same scan every time for the same seed", async () => {
    const [a, b] = await Promise.all([renderScan(SHIELD_REJECTION, 7), renderScan(SHIELD_REJECTION, 7)]);
    expect(a.byteLength).toBe(b.byteLength);
  });
});
