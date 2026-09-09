import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { createErrorDescriber, humanizeWait, retryAfterSecs } from "./describe-error.ts";

/** A translator that echoes the key, so a test can see exactly which one was asked for. */
const t = (key: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length > 0 ? `${key}(${JSON.stringify(params)})` : key;

describe("humanizeWait", () => {
  // The thresholds are 90s and 90min, not 60 and 60. "in 75 seconds" must not round down to
  // the vaguer "in 1 minute" — the whole job of this function is to be more useful than the
  // raw number, and a lossy rounding at the boundary is less useful.
  it("keeps the more precise unit past the round boundary", () => {
    expect(humanizeWait(t, 75, "errors.")).toBe('errors.waitSeconds({"count":75})');
    expect(humanizeWait(t, 95, "errors.")).toBe('errors.waitMinutes({"count":2})');
    expect(humanizeWait(t, 80 * 60, "errors.")).toBe('errors.waitMinutes({"count":80})');
    expect(humanizeWait(t, 2 * 3600, "errors.")).toBe('errors.waitHours({"count":2})');
  });

  it("never says 'in 0 seconds'", () => {
    expect(humanizeWait(t, 0.2, "errors.")).toBe('errors.waitSeconds({"count":1})');
  });
});

describe("retryAfterSecs", () => {
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
});

describe("createErrorDescriber", () => {
  const describeError = createErrorDescriber({
    t,
    copyPrefix: "errors.",
    messageKeyPrefix: "serverErrors.",
    knownMessageKeys: { quotaDay: "", suspended: "" },
    codes: {
      QUOTA_EXCEEDED: ({ says, wait }) => ({
        cause: says ?? "errors.quota",
        hint: wait ? `errors.retryIn(${wait})` : undefined,
      }),
    },
  });

  it("reads a thrown non-response as the network, with a way forward", () => {
    const { cause, hint } = describeError(new TypeError("Failed to fetch"));
    expect(cause).toBe("errors.network");
    // The hint is the point. A cause with no hint is the dead end this module exists to stop.
    expect(hint).toBe("errors.networkHint");
  });

  it("resolves a messageKey this build carries, with its params", () => {
    const error = new ApiError(429, {
      code: "QUOTA_EXCEEDED",
      message: "Daily cap reached",
      messageKey: "serverErrors.quotaDay",
      params: { limit: 100 },
      details: { retryAfterSecs: 3600 },
    });
    expect(describeError(error).cause).toBe('serverErrors.quotaDay({"limit":100})');
  });

  // A deploy can land ahead of the bundle a tab is still running, so the server names a
  // sentence this build has never heard of. Falling back to the server's English beats
  // rendering the raw key at somebody.
  it("falls back to the server's English for a key this build does not have", () => {
    const error = new ApiError(429, {
      code: "QUOTA_EXCEEDED",
      message: "Daily cap reached",
      messageKey: "serverErrors.shippedLastTuesday",
    });
    expect(describeError(error).cause).toBe("errors.quota");
  });

  // The server names a SENTENCE, not any key in the app. A messageKey outside the namespace
  // is ignored rather than resolved — otherwise a compromised or careless server could point
  // the client at arbitrary copy.
  it("ignores a messageKey outside the server namespace", () => {
    const error = new ApiError(500, {
      code: "UNKNOWN",
      message: "boom",
      messageKey: "billing.upgradeNow",
    });
    expect(describeError(error).cause).toBe("boom");
  });

  it("offers a retry on a 5xx and withholds it on a 4xx", () => {
    // A 5xx genuinely clears on its own. A 4xx does not, and saying so would cost the reader
    // another attempt for nothing.
    expect(describeError(new ApiError(503, null)).hint).toBe("errors.retrySoon");
    expect(describeError(new ApiError(403, null)).hint).toBeUndefined();
  });
});

/**
 * The second convention in the fleet: an API with no `messageKey` field at all, whose CODE
 * names the sentence. One repo has 98 of them — `errors.FORECAST_NOT_FOUND` and its siblings —
 * and its client used to resolve them itself, which is how the translation ended up inside the
 * transport.
 */
describe("createErrorDescriber, when the code names the sentence", () => {
  const describeError = createErrorDescriber({
    t,
    copyPrefix: "errors.",
    messageKeyPrefix: "errors.",
    knownMessageKeys: { FORECAST_NOT_FOUND: "", network: "" },
  });

  it("resolves a code this build has copy for", () => {
    const error = new ApiError(404, { code: "FORECAST_NOT_FOUND", message: "Forecast not found" });
    expect(describeError(error).cause).toBe("errors.FORECAST_NOT_FOUND");
  });

  it("falls back to the server's own message for a code with no copy", () => {
    // The server writes for a developer, so this is the worse of the two — but it is still the
    // most specific thing anyone has, and support can act on it.
    const error = new ApiError(429, { code: "RESEARCH_LIMIT", message: "Concurrent limit hit" });
    expect(describeError(error).cause).toBe("Concurrent limit hit");
  });

  it("prefers messageKey when the server sends both", () => {
    const error = new ApiError(404, {
      code: "FORECAST_NOT_FOUND",
      message: "Forecast not found",
      messageKey: "errors.network",
    });
    expect(describeError(error).cause).toBe("errors.network");
  });
});
