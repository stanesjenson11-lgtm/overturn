import { afterEach, describe, expect, it, vi } from "vitest";
import { setFallback, withFallback } from "@/lib/llm";

// A daily-quota 429: the retryDelay is past the cap, so withRetry throws at once instead of sleeping.
const exhausted = () => Object.assign(new Error('{"retryDelay": "60000s"}'), { status: 429 });

function stub(fail: (model: string) => unknown) {
  const tried: string[] = [];
  const fn = async (model: string) => {
    tried.push(model);
    const err = fail(model);
    if (err) throw err;
    return `answer from ${model}`;
  };
  return { fn, tried };
}

describe("withFallback", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => setFallback(true));

  it("moves to the next model when the first is out of quota", async () => {
    const s = stub((m) => (m === "gemini-3.1-flash-lite" ? exhausted() : null));
    await expect(withFallback("gemini-3.1-flash-lite", s.fn)).resolves.toBe("answer from gemini-3.5-flash-lite");
    expect(s.tried).toEqual(["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]);
  });

  it("does not try another model for an error a model swap won't fix", async () => {
    const s = stub(() => Object.assign(new Error("bad request"), { status: 400 }));
    await expect(withFallback("gemini-3.5-flash-lite", s.fn)).rejects.toThrow("bad request");
    expect(s.tried).toEqual(["gemini-3.5-flash-lite"]);
  });

  it("stays on the named model when fallback is off", async () => {
    setFallback(false);
    const s = stub(() => exhausted());
    await expect(withFallback("gemini-3.5-flash-lite", s.fn)).rejects.toMatchObject({ status: 429 });
    expect(s.tried).toEqual(["gemini-3.5-flash-lite"]);
  });
});
