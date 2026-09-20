import { describe, expect, it } from "vitest";
import { ApiError, parseRetryAfter, retryAfterSecs, waitingNeverHelps } from "./api-error.ts";

/**
 * Two APIs, two places for the same fact: one states the wait in the `Retry-After` header (the
 * standard one), the other in `details.retryAfterSecs`. A caller asking "how long" should not
 * have to know which server answered.
 */
describe("retryAfterSecs", () => {
  it("reads the header the client captured", () => {
    expect(retryAfterSecs(new ApiError(429, null, { retryAfterSecs: 60 }))).toBe(60);
    // Zero is a real answer — "now" — and must not read as "did not say".
    expect(retryAfterSecs(new ApiError(429, null, { retryAfterSecs: 0 }))).toBe(0);
  });

  it("prefers the header to the body", () => {
    const both = new ApiError(
      429,
      { code: "X", message: "", details: { retryAfterSecs: 30 } },
      {
        retryAfterSecs: 60,
      },
    );
    expect(retryAfterSecs(both)).toBe(60);
  });

  it("reads the number out of details, and refuses anything else", () => {
    expect(
      retryAfterSecs(
        new ApiError(429, { code: "X", message: "", details: { retryAfterSecs: 30 } }),
      ),
    ).toBe(30);
    expect(
      retryAfterSecs(
        new ApiError(429, { code: "X", message: "", details: { retryAfterSecs: "30" } }),
      ),
    ).toBeNull();
    expect(retryAfterSecs(new ApiError(429, { code: "X", message: "", details: null }))).toBeNull();
    expect(retryAfterSecs(new ApiError(429, null))).toBeNull();
  });

  // And it keeps answering `null` for a stated never, which is what its callers want: there is
  // no countdown to show. The claim is a separate question, asked separately.
  it("answers null for a stated never, same as for silence", () => {
    const stated = new ApiError(429, {
      code: "X",
      message: "",
      details: { retryAfterSecs: null },
    });
    expect(retryAfterSecs(stated)).toBeNull();
    expect(retryAfterSecs(new ApiError(429, null))).toBeNull();
  });
});

/**
 * The claim `retryAfterSecs` cannot carry: an explicit `null` in the body, meaning waiting will
 * never fix this. It has to be told apart from an absent key, which is silence.
 */
describe("waitingNeverHelps", () => {
  const withDetails = (details: unknown) => new ApiError(429, { code: "X", message: "", details });

  it("reads a present null as the claim", () => {
    expect(waitingNeverHelps(withDetails({ retryAfterSecs: null }))).toBe(true);
  });

  it("reads silence as no claim", () => {
    expect(waitingNeverHelps(withDetails({ scope: "account" }))).toBe(false);
    expect(waitingNeverHelps(withDetails({}))).toBe(false);
    expect(waitingNeverHelps(new ApiError(429, null))).toBe(false);
  });

  it("reads a stated wait as no claim", () => {
    expect(waitingNeverHelps(withDetails({ retryAfterSecs: 30 }))).toBe(false);
    // The header is not a channel for this — there is no `Retry-After` that says "never".
    expect(waitingNeverHelps(new ApiError(429, null, { retryAfterSecs: 30 }))).toBe(false);
  });

  // `details` is whatever the server put there, so the shape is a trust boundary. A JSON `null`
  // is the one that bites: `typeof null` is `"object"`, so a missing guard reads a property off
  // it and throws inside a retry rule.
  it("survives a details that is not an object", () => {
    expect(waitingNeverHelps(withDetails(null))).toBe(false);
    expect(waitingNeverHelps(withDetails("nope"))).toBe(false);
    expect(waitingNeverHelps(withDetails(7))).toBe(false);
  });
});

/**
 * Both spec forms are real — RFC 9110 allows delay-seconds or an HTTP-date, and servers pick
 * differently. The date half is the one that gets skipped, which silently turns a stated wait
 * into no wait at all.
 */
describe("parseRetryAfter", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter("  60  ")).toBe(60);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("reads an HTTP-date", () => {
    const at = new Date(Date.now() + 120_000).toUTCString();
    expect(parseRetryAfter(at)).toBeGreaterThanOrEqual(119);
    expect(parseRetryAfter(at)).toBeLessThanOrEqual(120);
  });

  // A date already gone means "now", not a negative delay that would run the backoff backwards.
  it("clamps a date in the past to zero", () => {
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it("answers nothing for a header that is missing or not a wait", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter("-5")).toBeUndefined();
    expect(parseRetryAfter("9007199254740993")).toBeUndefined();
  });
});
