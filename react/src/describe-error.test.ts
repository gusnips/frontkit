import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { createErrorDescriber, humanizeWait } from "./describe-error.ts";
import { shouldRetry } from "./query.ts";

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

  it("never puts the client's own log line on screen", () => {
    // A gateway answers with HTML, so there is no envelope and `message` is the client's
    // `Request failed (502)` — English, and written for a log.
    const { cause, hint } = describeError(new ApiError(502, null));
    expect(cause).toBe("errors.unexpected");
    expect(hint).toBe("errors.retrySoon");
  });
});

/**
 * The control to offer beside the words. The fourth adopter had this and the package did not, so
 * every adopter re-derived "can a second attempt fix this" from its own switch — beside a
 * `shouldRetry` already answering exactly that for react-query.
 */
describe("the recovery kind", () => {
  const describeError = createErrorDescriber({
    t,
    copyPrefix: "errors.",
    messageKeyPrefix: "serverErrors.",
    knownMessageKeys: { quotaDay: "" },
    durableLimitCodes: ["QUOTA_EXCEEDED"],
  });

  it("sends a 401 to sign-in and leaves a 403 alone", () => {
    expect(describeError(new ApiError(401, null)).recover).toBe("signin");
    // 403 is not a dead session: the session is fine and a different account is the fix, so
    // signing someone out would be the wrong cause AND the wrong remedy.
    expect(describeError(new ApiError(403, null)).recover).toBe("none");
  });

  it("offers a retry for a request that never landed", () => {
    expect(describeError(new TypeError("Failed to fetch")).recover).toBe("retry");
  });

  it("counts down when the refusal stated its own expiry", () => {
    const error = new ApiError(
      429,
      { code: "RATE_LIMIT_EXCEEDED", message: "slow down" },
      { retryAfterSecs: 30 },
    );
    expect(describeError(error).recover).toBe("wait");
  });

  it("offers no control for a limit that buying clears rather than waiting", () => {
    // The same 429 as above. Only the CODE separates a burst limit from a spent quota, which is
    // why the caller names them — from the same list it hands `queryDefaults`.
    const spent = new ApiError(429, { code: "QUOTA_EXCEEDED", message: "spent" });
    expect(describeError(spent).recover).toBe("none");
  });

  it("never asks anyone to retry the 401 the client raised itself", () => {
    // `expected` is the sign-out path: nothing is broken and the person is already on their way
    // to the door. A retry button here is the surface contradicting what it reports.
    expect(describeError(new ApiError(401, null, { expected: true })).recover).toBe("none");
  });

  it("agrees with the retry rule instead of deciding the same thing twice", () => {
    // The whole reason this derives rather than switches: if the two ever disagree, a reader
    // presses a button the query layer has already refused to honour.
    const error = new ApiError(503, null);
    expect(shouldRetry(error)).toBe(true);
    expect(describeError(error).recover).toBe("retry");
  });

  it("carries the request id the error contract reserves a slot for", () => {
    const error = new ApiError(500, null, { requestId: "req_123" });
    expect(describeError(error).reference).toBe("req_123");
  });

  it("lets an arm narrow the derived kind without restating it", () => {
    const describe503 = createErrorDescriber({
      t,
      copyPrefix: "errors.",
      messageKeyPrefix: "serverErrors.",
      knownMessageKeys: {},
      codes: {
        MAINTENANCE: (ctx) => {
          // The arm reads what the rule decided, so an arm that agrees can stay silent.
          expect(ctx.recover).toBe("retry");
          return { cause: "errors.maintenance", recover: "none" };
        },
      },
    });
    const out = describe503(new ApiError(503, { code: "MAINTENANCE", message: "back soon" }));
    expect(out.recover).toBe("none");
    expect(out.cause).toBe("errors.maintenance");
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
