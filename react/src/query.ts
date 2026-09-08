import type { DefaultOptions } from "@tanstack/react-query";
import { ApiError } from "./api-error.ts";

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
 * This is invariant 8.
 */

/** 4xx statuses a second attempt can fix. Everything else in the 4xx family is an answer. */
const RETRYABLE_CLIENT_STATUS = new Set([408, 429]);

export interface QueryDefaultsOptions {
  /**
   * Error codes that mean "this limit does not clear by waiting" — a spent monthly quota, a
   * balance that needs topping up. They usually arrive as 402 or 429; the status alone cannot
   * tell them apart from a burst limit, which is why the caller names them.
   */
  durableLimitCodes?: readonly string[];
  /** How many times to retry a transient failure. Two donors used 2, one used 1. */
  maxRetries?: number;
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
): boolean {
  // No response at all — offline, DNS, a dropped connection. The request never landed, so
  // nothing about it is an answer, and a second attempt is exactly right.
  if (!(error instanceof ApiError)) return true;

  if (error.code !== undefined && durableLimitCodes.includes(error.code)) return false;
  if (error.status >= 500) return true;
  return RETRYABLE_CLIENT_STATUS.has(error.status);
}

export function queryDefaults({
  durableLimitCodes = [],
  maxRetries = 2,
  staleTime = 2 * 60 * 1000,
  gcTime = 10 * 60 * 1000,
  refetchOnWindowFocus = false,
}: QueryDefaultsOptions = {}): DefaultOptions {
  return {
    queries: {
      staleTime,
      gcTime,
      retry: (failureCount, error) =>
        failureCount < maxRetries && shouldRetry(error, durableLimitCodes),
      refetchOnWindowFocus,
      refetchOnReconnect: true,
    },
    // A mutation is not idempotent by default. Retrying one that already reached the server is
    // how a customer gets charged twice; all three donors agreed on this without discussion.
    mutations: { retry: false },
  };
}
