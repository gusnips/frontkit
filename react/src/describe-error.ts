import { ApiError } from "./api-error.ts";

/**
 * Turning anything thrown into copy a person can act on.
 *
 * The API already answers with a message written for a developer, a stable `messageKey` for the
 * domain refusals, and `details` carrying the parts that make a refusal actionable. This is the
 * one place that decides what the SCREEN says — which is not always the same sentence.
 * "Monthly quota spent, upgrade or buy a pack" is right in a JSON body and wrong under a button
 * that could just say what to do next.
 *
 * `cause` is what happened. `hint` is what to do about it. **A surface that shows only the first
 * half is the dead end this exists to prevent** — which is why the type has two fields and not
 * one, and why `hint` being absent should be a deliberate choice at each call site rather than
 * the default nobody noticed.
 *
 * The per-code switch stays in the product: two donors' switches shared their SHAPE and almost
 * no arms, because the arms are that API's vocabulary. What ships is the scaffolding around it,
 * which is the part that was written twice and got subtly different both times.
 */

export interface DescribedError {
  /** What happened, in the reader's words. */
  cause: string;
  /** What to do about it. Its absence should be a decision, not an oversight. */
  hint?: string;
}

/** The subset of i18next's `t` this module needs — typed here so `i18next` stays optional. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Seconds until a refusal clears, when the envelope carries them. */
export function retryAfterSecs(error: ApiError): number | null {
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const value = (details as { retryAfterSecs?: unknown }).retryAfterSecs;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * "in 4 minutes" / "in 2 hours" — a wait nobody has to convert from seconds.
 *
 * The thresholds are deliberately not round: 90 seconds rather than 60, so "in 75 seconds" does
 * not become the less precise "in 1 minute", and 90 minutes rather than 60 for the same reason
 * one rung up. Needs `waitSeconds` / `waitMinutes` / `waitHours` in the catalog, each with a
 * `count` plural.
 */
export function humanizeWait(t: Translate, secs: number, prefix = ""): string {
  const key = (name: string): string => `${prefix}${name}`;
  if (secs < 90) return t(key("waitSeconds"), { count: Math.max(1, Math.round(secs)) });
  if (secs < 90 * 60) return t(key("waitMinutes"), { count: Math.round(secs / 60) });
  return t(key("waitHours"), { count: Math.round(secs / 3600) });
}

export interface ErrorDescriberOptions<Code extends string> {
  t: Translate;
  /**
   * The server's own catalog namespace, e.g. `"serverErrors."`. A `messageKey` outside it is
   * ignored — the server names a sentence, it does not get to name any key in the app.
   */
  messageKeyPrefix?: string;
  /**
   * The keys this build actually carries, usually `Object.keys(en.serverErrors)`.
   *
   * Membership is checked with `hasOwnProperty` and not `in`, which would accept `"toString"`.
   * A key that is absent falls back to the server's English `message`, because a deploy can land
   * ahead of the bundle a tab is still running and a missing translation must degrade to
   * readable rather than render the key itself at somebody.
   */
  knownMessageKeys?: readonly string[] | Record<string, unknown>;
  /** Catalog namespace for this module's own copy. Defaults to `"errors."`. */
  copyPrefix?: string;
  /** Per-code copy. Everything not listed falls through to the default arm below. */
  codes?: Partial<Record<Code, (ctx: ErrorContext) => DescribedError>>;
}

export interface ErrorContext {
  error: ApiError;
  /** The server's own localized sentence, when `messageKey` named one this build carries. */
  says: string | null;
  /** Seconds until it clears, already humanized. Null when the envelope did not say. */
  wait: string | null;
  waitSecs: number | null;
  t: Translate;
}

/**
 * Build the describer. Needs `network`, `networkHint`, `unexpected`, `retrySoon`,
 * `waitSeconds`, `waitMinutes` and `waitHours` under `copyPrefix` in every locale.
 */
export function createErrorDescriber<Code extends string>({
  t,
  messageKeyPrefix = "serverErrors.",
  knownMessageKeys,
  copyPrefix = "errors.",
  codes = {},
}: ErrorDescriberOptions<Code>): (error: unknown) => DescribedError {
  const known = Array.isArray(knownMessageKeys)
    ? new Set<string>(knownMessageKeys)
    : new Set(Object.keys(knownMessageKeys ?? {}));

  const has = (name: string): boolean => known.size === 0 || known.has(name);
  const key = (name: string): string => `${copyPrefix}${name}`;

  function serverSentence(error: ApiError): string | null {
    const messageKey = error.messageKey;
    if (messageKey === undefined || !messageKey.startsWith(messageKeyPrefix)) return null;
    const name = messageKey.slice(messageKeyPrefix.length);
    return has(name) ? t(messageKey, error.params) : null;
  }

  return function describeError(error: unknown): DescribedError {
    if (!(error instanceof ApiError)) {
      // Not a response at all — the request never landed. Almost always the network, and almost
      // never worth showing a stack trace for.
      return { cause: t(key("network")), hint: t(key("networkHint")) };
    }

    const waitSecs = retryAfterSecs(error);
    const ctx: ErrorContext = {
      error,
      says: serverSentence(error),
      wait: waitSecs === null ? null : humanizeWait(t, waitSecs, copyPrefix),
      waitSecs,
      t,
    };

    const arm = error.code === undefined ? undefined : codes[error.code as Code];
    if (arm) return arm(ctx);

    // Anything unmapped: the server's own sentence is still the most specific thing we have,
    // and support can act on it. A 5xx additionally gets "try again shortly", because that one
    // genuinely does clear on its own — a 4xx does not, and saying so would be a lie that costs
    // the reader another attempt.
    return {
      cause: ctx.says ?? (error.message || t(key("unexpected"))),
      hint: error.status >= 500 ? t(key("retrySoon")) : undefined,
    };
  };
}
