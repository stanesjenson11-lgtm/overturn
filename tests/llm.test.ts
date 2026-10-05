import { describe, expect, it } from "vitest";
import { retryDelayMs, withRetry } from "@/lib/llm";

// Shape copied from a live free-tier 429: the API's JSON nested, escaped, inside
// the SDK's message. A regex written against plain JSON never matches this.
const quota = (delay: string) =>
  Object.assign(
    new Error(
      `{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 429,\\n    \\"details\\": [{\\"@type\\": \\"type.googleapis.com/google.rpc.RetryInfo\\", \\"retryDelay\\": \\"${delay}\\"}]}}","code":429}}`,
    ),
    { status: 429 },
  );

function flaky(errors: unknown[]) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (errors.length) throw errors.shift();
    return "ok";
  };
  return { fn, calls: () => calls };
}

describe("retryDelayMs", () => {
  it("reads the delay out of the escaped SDK message and plain JSON alike", () => {
    expect(retryDelayMs(quota("3s"))).toBe(3250);
    expect(retryDelayMs(new Error('{"retryDelay": "2.5s"}'))).toBe(2750);
  });

  it("refuses to wait longer than the cap", () => {
    expect(retryDelayMs(quota("52s"))).toBeNull();
  });
});

describe("withRetry", () => {
  it("retries a 429 once, after the delay the API asked for", async () => {
    const f = flaky([quota("0s")]);
    await expect(withRetry(f.fn)).resolves.toBe("ok");
    expect(f.calls()).toBe(2);
  });

  it("only once: a second 429 is thrown", async () => {
    const f = flaky([quota("0s"), quota("0s")]);
    await expect(withRetry(f.fn)).rejects.toMatchObject({ status: 429 });
    expect(f.calls()).toBe(2);
  });

  it("throws at once when the wait would outlast the request", async () => {
    const f = flaky([quota("52s")]);
    await expect(withRetry(f.fn)).rejects.toMatchObject({ status: 429 });
    expect(f.calls()).toBe(1);
  });

  it("does not retry errors a retry can't fix", async () => {
    const f = flaky([Object.assign(new Error("bad request"), { status: 400 })]);
    await expect(withRetry(f.fn)).rejects.toThrow("bad request");
    expect(f.calls()).toBe(1);
  });
});
