import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { retryDelayMs, shouldRetry } from "./query.ts";

const refusal = (status: number, code?: string) =>
  new ApiError(status, code ? { code, message: code } : null);

/** A refusal that named its own expiry, the way a `Retry-After` header does. */
const waited = (status: number, secs: number) =>
  new ApiError(status, null, { retryAfterSecs: secs });

// Invariant 8, and the reason this module exists: three donors wrote three retry rules and
// each was right about something the other two got wrong. Every case below is one of those.
describe("shouldRetry", () => {
  it("retries a request that never landed", () => {
    // Offline, DNS, a dropped connection. Nothing about it is an answer.
    expect(shouldRetry(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("retries 5xx", () => {
    expect(shouldRetry(refusal(500))).toBe(true);
    expect(shouldRetry(refusal(503))).toBe(true);
  });

  it("does not retry a 4xx that is an answer", () => {
    // A 402, a 403 and a 404 say exactly the same thing three times.
    for (const status of [400, 401, 402, 403, 404, 409, 422, 451]) {
      expect(shouldRetry(refusal(status))).toBe(false);
    }
  });

  // Only one donor allowed this through, and it is the one 4xx a second attempt genuinely fixes.
  it("retries 408", () => {
    expect(shouldRetry(refusal(408))).toBe(true);
  });

  it("retries a burst 429", () => {
    expect(shouldRetry(refusal(429, "RATE_LIMIT_EXCEEDED"))).toBe(true);
  });

  // The sharpest rule of the three, and only one donor had it. A spent monthly quota and an
  // empty balance both arrive as 429 or 402, and neither clears by waiting — retrying burns
  // another request against the limiter and cannot succeed. The status alone cannot tell them
  // apart from a burst limit, which is why the caller names the codes.
  it("does not retry a limit the code says is durable", () => {
    const durable = ["QUOTA_EXCEEDED", "PAYMENT_REQUIRED"];
    expect(shouldRetry(refusal(429, "QUOTA_EXCEEDED"), durable)).toBe(false);
    expect(shouldRetry(refusal(402, "PAYMENT_REQUIRED"), durable)).toBe(false);
    // …and the burst limit still retries, which is the distinction the whole rule is for.
    expect(shouldRetry(refusal(429, "RATE_LIMIT_EXCEEDED"), durable)).toBe(true);
  });

  // A durable code wins even over a 5xx: if the server says the limit does not clear by
  // waiting, its status code is not the more specific claim.
  it("lets a durable code override the status", () => {
    expect(shouldRetry(refusal(503, "QUOTA_EXCEEDED"), ["QUOTA_EXCEEDED"])).toBe(false);
  });

  // The second migration's rule. Its limiter answers `Retry-After: 60` on a per-minute window,
  // so retrying at 1s and 2s spends two more requests that cannot possibly succeed.
  it("does not retry a stated wait longer than we will hold", () => {
    expect(shouldRetry(waited(429, 60))).toBe(false);
    expect(shouldRetry(waited(429, 2))).toBe(true);
    // The boundary is inclusive: exactly the ceiling is still worth waiting out.
    expect(shouldRetry(waited(429, 10))).toBe(true);
    expect(shouldRetry(waited(429, 11))).toBe(false);
  });

  it("takes the ceiling from the caller", () => {
    expect(shouldRetry(waited(429, 60), [], 90)).toBe(true);
    expect(shouldRetry(waited(429, 3), [], 1)).toBe(false);
  });

  // A long wait is an answer whatever the status says — the same judgement `durableLimitCodes`
  // makes, except here the server named it and the app did not have to.
  it("lets a stated wait override a 5xx", () => {
    expect(shouldRetry(waited(503, 300))).toBe(false);
  });

  it("still retries when nothing said how long", () => {
    expect(shouldRetry(refusal(429))).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially when nothing said how long", () => {
    expect(retryDelayMs(0, refusal(500))).toBe(1000);
    expect(retryDelayMs(1, refusal(500))).toBe(2000);
    // …and caps, so a long-lived query does not schedule a retry for next week.
    expect(retryDelayMs(20, refusal(500))).toBe(30_000);
  });

  it("waits what the server asked for", () => {
    expect(retryDelayMs(0, waited(429, 5))).toBe(5000);
  });

  // `Retry-After: 0` is a server saying "immediately", which for a client that was just refused
  // is still too soon — the backoff is the floor.
  it("never goes below the backoff", () => {
    expect(retryDelayMs(1, waited(429, 0))).toBe(2000);
  });

  it("backs off for a failure that is not an API answer at all", () => {
    expect(retryDelayMs(0, new TypeError("Failed to fetch"))).toBe(1000);
  });
});
