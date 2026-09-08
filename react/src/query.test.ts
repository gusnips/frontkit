import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { shouldRetry } from "./query.ts";

const refusal = (status: number, code?: string) =>
  new ApiError(status, code ? { code, message: code } : null);

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
});
