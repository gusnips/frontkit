import type { ApiError as ApiErrorBody } from "@gusnips/http";

/**
 * A refusal, with the whole envelope intact.
 *
 * `code` is what the UI switches on, `messageKey` is what gets localized, and `details` carries
 * the parts that make a refusal actionable — the `resetAt` on a 429, the plan that lifts a 402.
 * Keeping all of it means a caller never has to re-parse a response body that has already been
 * read once.
 *
 * A real `class` and not an interface with a factory: one donor used the interface shape, which
 * works until something needs `instanceof` across a module boundary or wants a subclass.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly messageKey: string | undefined;
  readonly params: Record<string, string | number> | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;
  /**
   * Seconds until this refusal clears, when the answer said so.
   *
   * Read from the `Retry-After` HEADER, which is where HTTP puts it and where a rate limiter
   * written by anyone puts it. The second migration is why this exists: that API sends
   * `Retry-After: 60` on every 429 and nothing in its body, so the package's only reader —
   * which looked in `details.retryAfterSecs`, the first donor's convention — found nothing, and
   * both the copy and the retry rule were flying blind on the one refusal that states its own
   * expiry. Two conventions, same fact; {@link retryAfterSecs} reads either.
   */
  readonly retryAfterSecs: number | undefined;

  /**
   * The client raised this itself to stop a caller while it was already handling the
   * situation — today, the 401 thrown after a dead session, where the person is already on
   * their way to the sign-in page.
   *
   * It is control flow, not a fault. Exception reporting should skip it, and an error surface
   * should not ask somebody to retry something that is not broken. One donor had this and it is
   * the difference between a clean sign-out and a crash report every time a session expires.
   */
  readonly expected: boolean;

  constructor(
    status: number,
    body: ApiErrorBody["error"] | null,
    opts: {
      requestId?: string;
      expected?: boolean;
      message?: string;
      retryAfterSecs?: number;
    } = {},
  ) {
    super(opts.message ?? body?.message ?? `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.messageKey = body?.messageKey;
    this.params = body?.params;
    this.details = body?.details;
    this.requestId = opts.requestId;
    this.retryAfterSecs = opts.retryAfterSecs;
    this.expected = opts.expected ?? false;
  }
}

/**
 * Seconds until a refusal clears, from whichever place the API put them.
 *
 * The header first, because it is the standard one and it is what a limiter emits without being
 * asked; then `details.retryAfterSecs`, which one donor's API sends in the body instead. A
 * caller asking "how long" should not have to know which server it is talking to.
 */
export function retryAfterSecs(error: ApiError): number | null {
  if (error.retryAfterSecs !== undefined) return error.retryAfterSecs;
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const value = (details as { retryAfterSecs?: unknown }).retryAfterSecs;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `Retry-After` in either spec form: delay-seconds, or an HTTP-date.
 *
 * Both forms are real — RFC 9110 allows either and different servers pick differently — and the
 * date one is the half that gets skipped, which turns a stated wait into no wait at all. Clamped
 * at zero: a date already in the past means "now", not a negative delay.
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  // A bare integer is the delay-seconds form, malformed included: `Date.parse` accepts some of
  // them as years, so falling through would read "-5" as a date long past and answer 0 — a
  // wait invented out of a header that never stated one.
  if (/^[+-]?\d+$/.test(raw)) {
    const secs = Number(raw);
    return Number.isSafeInteger(secs) && secs >= 0 ? secs : undefined;
  }

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

/**
 * An aborted request — the caller's own `AbortController`, or a navigation that unmounted the
 * component waiting on it.
 *
 * Worth its own predicate because it is the one failure that must NOT be reported, retried or
 * shown: nobody is waiting for the answer. Distinguishing it from a real failure is what keeps
 * a route change from filling the console with errors nobody caused.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
