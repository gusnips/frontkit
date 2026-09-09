import type { DefaultOptions } from "@tanstack/react-query";
import { ApiError, retryAfterSecs } from "./api-error.ts";

/**
 * react-query defaults — the merge of three repos that each got part of this right.
 *
 * The default is three blind retries, which is wrong for an API that answers refusals
 * precisely: a 402, a 403 or a 451 says exactly the same thing three times, and a 429 we hammer
 * is a 429 we deserve. All three donors knew that much. What each knew alone:
 *
 * - one allowed **408** through, the only 4xx that a second attempt genuinely fixes;
 * - one refused to retry a 429 whose CODE says the limit is durable — a monthly quota or a
 *   spent balance clears by buying, not by waiting, so retrying burns another request against
 *   the limiter and cannot succeed;
 * - one set **`refetchOnReconnect`**, which none of the others had, and which is the single
 *   most useful refetch there is: coming back from a tunnel is exactly when the screen is stale.
 *
 * The second migration added the fourth rule, which no donor had: **when a 429 says how long,
 * believe it.** Its limiter answers `Retry-After: 60` on a per-minute window, and the default
 * backoff retries at 1s and 2s — two more requests that cannot succeed, both charged against the
 * same limiter, and three seconds added before the screen says anything. So a stated wait is
 * waited out when it is short, and is an ANSWER when it is not.
 *
 * This is invariant 8.
 */

/** 4xx statuses a second attempt can fix. Everything else in the 4xx family is an answer. */
const RETRYABLE_CLIENT_STATUS = new Set([408, 429]);

const DEFAULT_MAX_RETRY_WAIT_SECS = 10;

export interface QueryDefaultsOptions {
  /**
   * Error codes that mean "this limit does not clear by waiting" — a spent monthly quota, a
   * balance that needs topping up. They usually arrive as 402 or 429; the status alone cannot
   * tell them apart from a burst limit, which is why the caller names them.
   */
  durableLimitCodes?: readonly string[];
  /** How many times to retry a transient failure. Two donors used 2, one used 1. */
  maxRetries?: number;
  /**
   * Longest stated wait still worth retrying. Default 10 seconds.
   *
   * Only applies when the refusal named its own expiry (`Retry-After`, or `retryAfterSecs` in
   * the body). A burst limit that clears in two seconds is worth sitting out; a monthly ceiling
   * that clears in an hour is an answer, and holding a spinner for it helps nobody — show the
   * wait instead, which is what `humanizeWait` is for.
   */
  maxRetryWaitSecs?: number;
  staleTime?: number;
  gcTime?: number;
  /**
   * Left to the caller on purpose. A dashboard someone leaves open wants it on; a console
   * whose data changes only when the operator changes it wants it off, and one donor turned it
   * off deliberately. There is no right answer to inherit.
   */
  refetchOnWindowFocus?: boolean;
}

/**
 * Should this failure be retried?
 *
 * Exported on its own because an app with its own QueryClient config still wants this rule, and
 * because it is the part worth testing.
 */
export function shouldRetry(
  error: unknown,
  durableLimitCodes: readonly string[] = [],
  maxRetryWaitSecs = DEFAULT_MAX_RETRY_WAIT_SECS,
): boolean {
  // No response at all — offline, DNS, a dropped connection. The request never landed, so
  // nothing about it is an answer, and a second attempt is exactly right.
  if (!(error instanceof ApiError)) return true;

  if (error.code !== undefined && durableLimitCodes.includes(error.code)) return false;

  // It told us when it clears. A wait we are not willing to hold is a refusal, not a hiccup —
  // and it is the same judgement `durableLimitCodes` makes, except the server did the naming.
  const wait = retryAfterSecs(error);
  if (wait !== null && wait > maxRetryWaitSecs) return false;

  if (error.status >= 500) return true;
  return RETRYABLE_CLIENT_STATUS.has(error.status);
}

/**
 * How long before the next attempt: the server's stated wait when there is one, react-query's
 * exponential backoff otherwise, and never less than the backoff — a `Retry-After: 0` is a
 * server saying "immediately", which for a client that just got refused is still too soon.
 */
export function retryDelayMs(attemptIndex: number, error: unknown): number {
  const backoff = Math.min(1000 * 2 ** attemptIndex, 30_000);
  if (!(error instanceof ApiError)) return backoff;
  const wait = retryAfterSecs(error);
  return wait === null ? backoff : Math.max(backoff, wait * 1000);
}

export function queryDefaults({
  durableLimitCodes = [],
  maxRetries = 2,
  maxRetryWaitSecs = DEFAULT_MAX_RETRY_WAIT_SECS,
  staleTime = 2 * 60 * 1000,
  gcTime = 10 * 60 * 1000,
  refetchOnWindowFocus = false,
}: QueryDefaultsOptions = {}): DefaultOptions {
  return {
    queries: {
      staleTime,
      gcTime,
      retry: (failureCount, error) =>
        failureCount < maxRetries && shouldRetry(error, durableLimitCodes, maxRetryWaitSecs),
      retryDelay: retryDelayMs,
      refetchOnWindowFocus,
      refetchOnReconnect: true,
    },
    // A mutation is not idempotent by default. Retrying one that already reached the server is
    // how a customer gets charged twice; all three donors agreed on this without discussion.
    mutations: { retry: false },
  };
}
