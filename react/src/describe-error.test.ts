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

  // A wait is a floor. "in 2 hours" for 2h24 sends the reader back 24 minutes early, into the
  // same refusal; every other wait formatter in the fleet already rounds up.
  it("rounds a wait up, never down", () => {
    expect(humanizeWait(t, 2 * 3600 + 24 * 60, "errors.")).toBe('errors.waitHours({"count":3})');
    expect(humanizeWait(t, 2 * 60 + 5, "errors.")).toBe('errors.waitMinutes({"count":3})');
    expect(humanizeWait(t, 74.3, "errors.")).toBe('errors.waitSeconds({"count":75})');
  });

  it("never says 'in 0 seconds'", () => {
    expect(humanizeWait(t, 0.2, "errors.")).toBe('errors.waitSeconds({"count":1})');
  });
});

/**
 * The seam 0.6.0 added, and why it is required rather than defaulted: this module used to
 * humanize the wait itself, which put `waitSeconds`/`waitMinutes`/`waitHours` into the key union
 * of every adopter's `t` — six ICU entries per language — even for an app that formats relative
 * time with `Intl` and would never render one of them.
 */
describe("formatWait", () => {
  const describeError = createErrorDescriber({
    t,
    copyPrefix: "errors.",
    // What an adopter on `Intl.RelativeTimeFormat` passes. Its catalog has no wait keys at all,
    // and it gets correct plurals in every language without writing one.
    formatWait: (secs) =>
      new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        Math.round(secs / 60),
        "minute",
      ),
    messageKeyPrefix: "serverErrors.",
    knownMessageKeys: {},
    codes: {
      RATE_LIMIT_EXCEEDED: ({ wait }) => ({
        cause: "errors.rateLimit",
        fix: `wait:${String(wait)}`,
      }),
    },
  });

  it("hands an arm the wait in the app's own words, not the package's", () => {
    const error = new ApiError(
      429,
      { code: "RATE_LIMIT_EXCEEDED", message: "slow down" },
      { retryAfterSecs: 120 },
    );
    expect(describeError(error).fix).toBe("wait:in 2 minutes");
  });

  it("leaves the wait null when the refusal never stated one", () => {
    const error = new ApiError(429, { code: "RATE_LIMIT_EXCEEDED", message: "slow down" });
    expect(describeError(error).fix).toBe("wait:null");
  });
});

describe("createErrorDescriber", () => {
  const describeError = createErrorDescriber({
    t,
    copyPrefix: "errors.",
    formatWait: (secs) => humanizeWait(t, secs, "errors."),
    messageKeyPrefix: "serverErrors.",
    knownMessageKeys: { quotaDay: "", suspended: "" },
    codes: {
      QUOTA_EXCEEDED: ({ says, wait }) => ({
        cause: says ?? "errors.quota",
        fix: wait ? `errors.retryIn(${wait})` : undefined,
      }),
    },
  });

  it("reads a thrown non-response as the network, with a way forward", () => {
    const { cause, fix } = describeError(new TypeError("Failed to fetch"));
    expect(cause).toBe("errors.network");
    // The fix is the point. A cause with no fix is the dead end this module exists to stop.
    expect(fix).toBe("errors.networkHint");
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
  // i18next stores a plural suffixed and the server names the base, so `Object.keys` alone does
  // not contain the key the server sends. Before this, the two plan limits in the seventh
  // migration's API — a seat limit and a profile limit — read as keys the build did not have,
  // and each fell back to English on the one screen where the written sentence earns its keep.
  it("admits the base name of a plural the catalog stores suffixed", () => {
    const describePlural = createErrorDescriber({
      t,
      copyPrefix: "errors.",
      formatWait: (secs) => humanizeWait(t, secs, "errors."),
      messageKeyPrefix: "serverErrors.",
      knownMessageKeys: { seatLimitReached_one: "", seatLimitReached_other: "" },
    });
    const error = new ApiError(402, {
      code: "PAYMENT_REQUIRED",
      message: "seat limit reached",
      messageKey: "serverErrors.seatLimitReached",
      params: { count: 3 },
    });
    expect(describePlural(error).cause).toBe('serverErrors.seatLimitReached({"count":3})');
  });

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
    expect(describeError(new ApiError(503, null)).fix).toBe("errors.retrySoon");
    expect(describeError(new ApiError(403, null)).fix).toBeUndefined();
  });

  it("never puts the client's own log line on screen", () => {
    // A gateway answers with HTML, so there is no envelope and `message` is the client's
    // `Request failed (502)` — English, and written for a log.
    const { cause, fix } = describeError(new ApiError(502, null));
    expect(cause).toBe("errors.unexpected");
    expect(fix).toBe("errors.retrySoon");
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
    formatWait: (secs) => humanizeWait(t, secs, "errors."),
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
      formatWait: (secs) => humanizeWait(t, secs, "errors."),
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
 * The seventh migration's seam. The server names what IT knows — a role id, an action verb — and
 * the sentence needs whatever the app's own screens call those. The substitution can only happen
 * inside the lookup that reads `params`, which is why an arm cannot do it: by the time an arm
 * runs, `ctx.says` is already resolved.
 */
describe("localizeParams", () => {
  const options = {
    t,
    copyPrefix: "errors." as const,
    formatWait: (secs: number) => humanizeWait(t, secs, "errors."),
    messageKeyPrefix: "serverErrors." as const,
    knownMessageKeys: { roleRequired: "" },
  };
  const refusal = new ApiError(403, {
    code: "FORBIDDEN",
    message: "Needs admin",
    messageKey: "serverErrors.roleRequired",
    params: { role: "admin" },
  });

  it("translates a param before it fills the sentence", () => {
    const describeError = createErrorDescriber({
      ...options,
      localizeParams: (params) => ({
        ...params,
        ...(typeof params?.role === "string" && { role: t(`roles.${params.role}`) }),
      }),
    });
    expect(describeError(refusal).cause).toBe('serverErrors.roleRequired({"role":"roles.admin"})');
  });

  it("is identity by default, so params already in words pass straight through", () => {
    const describeError = createErrorDescriber(options);
    expect(describeError(refusal).cause).toBe('serverErrors.roleRequired({"role":"admin"})');
  });
});

/**
 * The seventh migration's second seam, and the same lesson as the first: a default that was one
 * adopter's convention, shipped as if it were a fact.
 *
 * The built-in arm hands an unmapped code the server's `message`. That is right for the API whose
 * message IS the reader's sentence. It is wrong for the one whose own i18n rules call `message`
 * "the English fallback for logs" while the app ships three languages — there the built-in puts
 * developer English on screen, which is the single thing that repo's rules forbid.
 */
describe("fallback", () => {
  const options = {
    t,
    copyPrefix: "errors." as const,
    formatWait: (secs: number) => humanizeWait(t, secs, "errors."),
    messageKeyPrefix: "serverErrors." as const,
    knownMessageKeys: { quotaDay: "" },
  };
  const describeError = createErrorDescriber({
    ...options,
    fallback: ({ error, says, wait }) => ({
      cause:
        says ??
        (error.code !== undefined && error.status < 500 ? "errors.invalid" : "errors.unexpected"),
      fix: wait ? `errors.retryIn(${wait})` : undefined,
    }),
  });

  it("keeps the server's English log line off the screen", () => {
    const error = new ApiError(422, {
      code: "SLIDE_TOO_LONG",
      message: "slide 3 exceeds 2200 chars",
    });
    expect(describeError(error).cause).toBe("errors.invalid");
    // What the built-in would have said, which is the whole reason the seam exists.
    expect(createErrorDescriber(options)(error).cause).toBe("slide 3 exceeds 2200 chars");
  });

  it("still resolves a sentence this build carries", () => {
    // The arm only runs for what `codes` left unnamed; it does not take over the key lookup.
    const error = new ApiError(429, {
      code: "SOMETHING_NEW",
      message: "log line",
      messageKey: "serverErrors.quotaDay",
    });
    expect(describeError(error).cause).toBe("serverErrors.quotaDay");
  });

  it("hands the arm a stated wait the built-in spends on nothing", () => {
    const error = new ApiError(
      503,
      { code: "SOMETHING_NEW", message: "log line" },
      { retryAfterSecs: 120 },
    );
    expect(describeError(error).fix).toBe('errors.retryIn(errors.waitMinutes({"count":2}))');
    expect(createErrorDescriber(options)(error).fix).toBe("errors.retrySoon");
  });

  it("leaves the derived recovery kind alone unless the arm narrows it", () => {
    const error = new ApiError(503, { code: "SOMETHING_NEW", message: "log line" });
    expect(describeError(error).recover).toBe("retry");
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
    formatWait: (secs) => humanizeWait(t, secs, "errors."),
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

/**
 * The form for an app in one language. It had to pass `copyPrefix`, `messageKeyPrefix` and an
 * empty `knownMessageKeys` to say "I have no catalog", and typing `t`'s argument by hand broke the
 * inference. It writes its four sentences out instead.
 */
describe("one language", () => {
  const COPY = {
    network: "We could not reach the server.",
    networkHint: "Check your connection, then try again.",
    unexpected: "Something went wrong on our side.",
    retrySoon: "Try again in a moment.",
  };
  const describeError = createErrorDescriber({
    copy: COPY,
    formatWait: (secs) => `in ${secs}s`,
    codes: {
      RATE_LIMIT_EXCEEDED: ({ wait }) => ({ cause: "Too many at once.", fix: `Try ${wait}.` }),
    },
  });

  it("takes its own sentences from `copy`", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toEqual({
      cause: COPY.network,
      fix: COPY.networkHint,
      recover: "retry",
    });
    expect(describeError(new ApiError(502, null))).toMatchObject({
      cause: COPY.unexpected,
      fix: COPY.retrySoon,
    });
  });

  // No catalog, so nothing the server names can reach the screen as a key. The server writes in
  // the app's one language, so its own sentence is what an unmapped refusal shows.
  it("shows the server's sentence and never a key the server named", () => {
    const error = new ApiError(409, {
      code: "SLUG_TAKEN",
      message: "That address is taken.",
      messageKey: "serverErrors.slugTaken",
    });
    expect(describeError(error).cause).toBe("That address is taken.");
  });

  it("still runs the arms and the stated wait", () => {
    const error = new ApiError(
      429,
      { code: "RATE_LIMIT_EXCEEDED", message: "slow down" },
      { retryAfterSecs: 30 },
    );
    expect(describeError(error)).toMatchObject({
      cause: "Too many at once.",
      fix: "Try in 30s.",
      recover: "wait",
    });
  });

  it("refuses `copy` with a sentence missing", () => {
    // @ts-expect-error -- `retrySoon` is missing, and a 5xx would show `undefined` without it.
    createErrorDescriber({
      copy: { network: "", networkHint: "", unexpected: "" },
      formatWait: String,
    });
  });
});
