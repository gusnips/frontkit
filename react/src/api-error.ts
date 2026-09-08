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
    opts: { requestId?: string; expected?: boolean; message?: string } = {},
  ) {
    super(opts.message ?? body?.message ?? `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.messageKey = body?.messageKey;
    this.params = body?.params;
    this.details = body?.details;
    this.requestId = opts.requestId;
    this.expected = opts.expected ?? false;
  }
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
