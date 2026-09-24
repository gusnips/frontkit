import { describe, expect, it, vi } from "vitest";
import { parseRetryAfter, retryAfterSecs, retryDelayMs, shouldRetry } from "./retry.ts";

// Plain objects on purpose: the rule reads fields, never a class, so an SDK's own error type and
// a react client's `ApiError` get the same answer.
const answer = (status: number, extra: Record<string, unknown> = {}) => ({ status, ...extra });
const waited = (status: number, secs: number) => answer(status, { retryAfterSecs: secs });
const never = (status: number) => answer(status, { details: { retryAfterSecs: null } });

const read = { repeatable: true };
const write = { repeatable: false };

describe("shouldRetry", () => {
  // Offline, DNS, a dropped connection. A read runs again; a write may already have landed.
  it("retries no answer only when the request may run twice", () => {
    expect(shouldRetry(new TypeError("Failed to fetch"), read)).toBe(true);
    expect(shouldRetry(new TypeError("Failed to fetch"), write)).toBe(false);
  });

  // auth-js reports "nothing came back" as status 0, and a missing status is the same thing.
  it("reads a status below 100 as no answer", () => {
    expect(shouldRetry(answer(0), read)).toBe(true);
    expect(shouldRetry(answer(0), write)).toBe(false);
    expect(shouldRetry(answer(Number.NaN), write)).toBe(false);
  });

  it("retries a 5xx only when the request may run twice", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(shouldRetry(answer(status), read)).toBe(true);
      // The write may have run before the gateway gave up: a second one charges twice.
      expect(shouldRetry(answer(status), write)).toBe(false);
    }
  });

  // These three say the request was not run, so even a write is safe to send again. 408 is the
  // one no SDK in the fleet retried; 425 is "too early" for data sent in a TLS handshake.
  it("retries 408, 425 and 429 either way", () => {
    for (const status of [408, 425, 429]) {
      expect(shouldRetry(answer(status), read)).toBe(true);
      expect(shouldRetry(answer(status), write)).toBe(true);
    }
  });

  it("does not retry a 4xx that is an answer", () => {
    for (const status of [400, 401, 402, 403, 404, 409, 422, 451]) {
      expect(shouldRetry(answer(status), read)).toBe(false);
    }
  });

  it("does not retry a code the caller says does not clear by waiting", () => {
    const options = { ...read, durableCodes: ["QUOTA_EXCEEDED"] };
    expect(shouldRetry(answer(429, { code: "QUOTA_EXCEEDED" }), options)).toBe(false);
    expect(shouldRetry(answer(503, { code: "QUOTA_EXCEEDED" }), options)).toBe(false);
    // The burst limit next to it still retries, which is the whole point of naming codes.
    expect(shouldRetry(answer(429, { code: "RATE_LIMITED" }), options)).toBe(true);
  });

  // No SDK in the fleet read this. The server sends it for a limit no wait clears.
  it("does not retry a refusal whose body says waiting never helps", () => {
    expect(shouldRetry(never(429), read)).toBe(false);
    expect(shouldRetry(never(503), read)).toBe(false);
    // An absent key is silence, not the claim.
    expect(shouldRetry(answer(429, { details: { scope: "account" } }), read)).toBe(true);
    // `details` comes off the wire, so a JSON null there must not throw inside the rule.
    expect(shouldRetry(answer(429, { details: null }), read)).toBe(true);
  });

  // A limiter can put a number on every 429; the null came from whoever raised this refusal.
  it("takes an explicit never over a stated wait", () => {
    const both = answer(429, { retryAfterSecs: 2, details: { retryAfterSecs: null } });
    expect(shouldRetry(both, read)).toBe(false);
  });

  it("does not retry a stated wait longer than the ceiling, which is inclusive", () => {
    expect(shouldRetry(waited(429, 10), read)).toBe(true);
    expect(shouldRetry(waited(429, 11), read)).toBe(false);
    expect(shouldRetry(waited(503, 300), read)).toBe(false);
    expect(shouldRetry(waited(429, 60), { ...read, maxWaitSecs: 90 })).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially, capped, when nothing said how long", () => {
    expect(retryDelayMs(0, answer(500))).toBe(1000);
    expect(retryDelayMs(1, answer(500))).toBe(2000);
    expect(retryDelayMs(20, answer(500))).toBe(30_000);
  });

  it("waits what the server asked for, never less than the backoff", () => {
    expect(retryDelayMs(0, waited(429, 5))).toBe(5000);
    expect(retryDelayMs(2, waited(429, 0))).toBe(4000);
  });

  // A thrown fetch carries no answer, so any field on it is not the server speaking.
  it("ignores a wait on an error that got no answer", () => {
    expect(retryDelayMs(0, { retryAfterSecs: 5 })).toBe(1000);
  });
});

describe("retryAfterSecs", () => {
  it("reads the header before the body", () => {
    expect(retryAfterSecs(answer(429, { retryAfterSecs: 60 }))).toBe(60);
    expect(retryAfterSecs(answer(429, { details: { retryAfterSecs: 30 } }))).toBe(30);
    const both = answer(429, { retryAfterSecs: 60, details: { retryAfterSecs: 30 } });
    expect(retryAfterSecs(both)).toBe(60);
    // Zero is a real answer, "now", and must not read as silence.
    expect(retryAfterSecs(waited(429, 0))).toBe(0);
  });

  it("answers null for silence, for a stated never, and for a wait that is not a number", () => {
    expect(retryAfterSecs(answer(429))).toBeNull();
    expect(retryAfterSecs(never(429))).toBeNull();
    expect(retryAfterSecs(answer(429, { details: { retryAfterSecs: "30" } }))).toBeNull();
    expect(retryAfterSecs(answer(429, { retryAfterSecs: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(retryAfterSecs(null)).toBeNull();
    expect(retryAfterSecs("429")).toBeNull();
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter("  60  ")).toBe(60);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("reads an HTTP date, and a date already past is now", () => {
    const at = new Date(Date.now() + 120_000).toUTCString();
    expect(parseRetryAfter(at)).toBeGreaterThanOrEqual(119);
    expect(parseRetryAfter(at)).toBeLessThanOrEqual(120);
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it("rounds a date up, so the retry is never early", () => {
    // 119.4 seconds away. Rounded to nearest that is 119, and the retry lands inside the refusal.
    vi.useFakeTimers({ now: Date.parse("2026-09-24T12:00:00.600Z") });
    try {
      expect(parseRetryAfter("Thu, 24 Sep 2026 12:02:00 GMT")).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers nothing for a header that is missing or not a wait", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
    // `Date.parse` reads some integers as years; "-5" must not become a date long past.
    expect(parseRetryAfter("-5")).toBeUndefined();
    expect(parseRetryAfter("9007199254740993")).toBeUndefined();
  });
});
