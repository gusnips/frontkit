import { isApiError, type ApiSuccess } from "@gusnips/http";
import { ApiError, parseRetryAfter } from "./api-error.ts";

/**
 * The app's one door to the API. Nothing else should call `fetch`.
 *
 * Every route answers the same envelope, so unwrapping and error-shaping belong here once
 * rather than in every hook. Three donors built this independently and all three arrived at
 * single-flight token refresh — see {@link SessionAdapter.refresh} for the reason, which is
 * the sharpest thing in this file.
 *
 * Four things deliberately did NOT come across from the donors, because they belong to a
 * product and not to a client:
 *
 * - **Toasts.** Whether a failure is spoken aloud is a design decision that differs per surface.
 *   Throw, and let the caller decide.
 * - **In-flight GET deduplication.** react-query already dedups by key, so the client's copy is
 *   redundant — and one donor's version returned a `clone()` of a body already being consumed,
 *   which is a race with no symptom until it has one.
 * - **Service-status tracking and impersonation.** One donor's, and firmly its own.
 * - **Analytics correlation headers.** Injected through {@link ApiClientOptions.headers}.
 */

/** What a refresh attempt actually learned. */
export interface RefreshResult {
  token: string | null;
  /**
   * False when the refresh never got an ANSWER out of the auth server — a dropped connection,
   * a 5xx, a captive portal.
   *
   * This flag is invariant 3, and only one of three donors had it. Losing a packet says nothing
   * about whether a session is still good, so a client that collapses "auth said no" into
   * "auth did not answer" signs people out over a Wi-Fi blip and costs them their place for
   * nothing. Auth libraries usually name this: Supabase throws `AuthRetryableFetchError`, so
   * an adapter answers `reachedAuth: !(error instanceof AuthRetryableFetchError)`.
   */
  reachedAuth: boolean;
}

/**
 * The seam onto whatever holds the session. Supabase in every donor so far, but nothing here
 * knows that — an adapter is four lines and keeps the auth vendor out of this package.
 */
export interface SessionAdapter {
  getToken(): Promise<string | null>;
  refresh(): Promise<RefreshResult>;
  signOut(): Promise<void>;
}

export interface ApiClientOptions {
  /** Origin + prefix, e.g. `https://api.example.com/v1`. No trailing slash. */
  baseUrl: string;
  session: SessionAdapter;
  /**
   * Extra headers, computed per request.
   *
   * A function, not an object, and that matters: one donor read
   * `document.documentElement.lang` inline in its request builder, which crashes a prerender
   * outright. Anything that touches the DOM, the current locale or the clock goes in here,
   * where it runs only when a request is actually being sent.
   */
  headers?: () => Record<string, string>;
  /**
   * The session is gone and cannot be renewed — send them to sign in.
   *
   * The client does not know the route, and it deliberately still THROWS after calling this:
   * `location.replace()` does not stop the current frame, so a caller's own `onError` must
   * still run or a half-finished screen keeps rendering against data that will never arrive.
   * The error it throws carries `expected: true`.
   *
   * Ending the session IN PLACE is equally supported — routing to the sign-in screen without a
   * reload — and it is the case that keeps this client alive across the next sign-in. The
   * sign-out latch is keyed on the refused token for exactly that reason; see `refusedToken`.
   */
  onSessionDead: () => void;
  /**
   * Every failed response, seen once, just before it is thrown.
   *
   * For a reaction that belongs to the whole app rather than to one call site. The donor's case
   * is the sharp one: a mid-session account suspension 403s every authed route except
   * `GET /auth/me`, so the moment one arrives the app has to refresh `me` and route to the
   * screen that explains it — otherwise every query on the page fails at once and the shell
   * half-renders behind an error storm until `me` goes stale on its own.
   *
   * It cannot live at a call site, because the point is that it fires from whichever call
   * happened to be first. It went in the donor's client directly, which made the client import
   * its query cache and its query keys — a cycle that this hook removes.
   *
   * Observation only: the error is thrown either way, and throwing from here would replace a
   * real API failure with whatever the listener hit.
   *
   * **The response comes with it, because a refusal's headers are otherwise unreachable.**
   * `request` throws before the `Response` escapes, so an adopter whose API states something on
   * the error path had no way to read it at all — one reports what every call cost, refusals
   * included, which is how "a blocked page costs nothing" becomes a thing a customer can check
   * rather than a thing we assert. That is the distinction worth keeping: field-error flattening
   * and a per-call meter callback both stayed in their products, because a product can write
   * those itself. This one it cannot, at any price, and a capability the kit makes unreachable
   * is a regression the kit has to undo.
   *
   * The BODY has already been read by the time this runs — the envelope was needed to build the
   * error — so `response.json()` here throws. The headers are what is left, and what this is for.
   */
  onError?: (error: ApiError, response: Response) => void;
  /**
   * Abort a request that has not answered. Default 30s.
   *
   * Neither donor bounded its authenticated requests at all — both bounded only their keyless
   * clients — so a stalled connection was a spinner with no end. providerkit learned the same
   * lesson about streams: a request with no deadline is a bug that only shows up on a bad
   * network, which is exactly when nobody can reproduce it.
   */
  timeoutMs?: number;
  /** How many times to refresh-and-retry a 401. Default 2. */
  maxRefreshAttempts?: number;
  /** Pause between refresh attempts. Default 500ms. */
  refreshRetryDelayMs?: number;
  /**
   * How long to wait for `signOut()` before redirecting anyway. Default 3s.
   *
   * A fail-safe, and one donor added it after the failure it prevents: awaiting `signOut()`
   * covers a rejection but not a HANG, and a hang leaves the tab signed out in name only —
   * still on the page, every request 401ing, nothing left that could redirect it.
   */
  signOutTimeoutMs?: number;
  /** Header carrying the server's request id, echoed onto {@link ApiError.requestId}. */
  requestIdHeader?: string;
}

export interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  /** Override the client's default timeout for this call. `null` disables it (streams). */
  timeoutMs?: number | null;
}

export interface ApiClient {
  /** The raw `Response`, past auth and error handling. For blobs, streams and downloads. */
  request(path: string, options?: RequestOptions): Promise<Response>;
  /** `data` out of the success envelope. */
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  /**
   * DELETE, discarding whatever comes back. Returns `void` because 204 is the usual answer and
   * a 204 has NO BODY — `res.json()` on one throws `Unexpected end of JSON input`, which reads
   * like a malformed response and is really just a success nobody was allowed to parse.
   *
   * Split from {@link ApiClient.delJson} rather than guessing per response, because the guess is
   * the part that hides a bug: a route that was supposed to answer with data and returned
   * nothing should fail loudly here, not hand back a silent `undefined` that surfaces three
   * layers away. The donor that hit this had written exactly these two functions.
   */
  del(path: string, options?: RequestOptions): Promise<void>;
  /** The DELETE that answers with something worth reading — a queue entry it handed back. */
  delJson<T>(path: string, options?: RequestOptions): Promise<T>;
  /**
   * The whole envelope rather than just `data`, for a route whose `meta` is half the answer —
   * a list's `total`, or a metered call's receipt.
   */
  page<T, M>(path: string, options?: RequestOptions): Promise<ApiSuccess<T, M>>;
  /**
   * The same, off a POST.
   *
   * Two adopters needed this and both wrote the same workaround: `client.request(…)` followed by
   * a hand-rolled `res.json()`, stepping around the client's own envelope reader and its one
   * assertion about the success shape. One of them left the reason sitting in a comment — "the
   * whole envelope is reachable off a GET and not off a POST, so this one reads the body itself"
   * — which is this package describing its own gap in somebody else's file.
   *
   * A metered route takes a body whenever its input is too long or too punctuated to be a path
   * segment (a URL, a search query), and then the receipt has to survive the POST too. When the
   * same guard shows up in every adopter, the thing it guards against is ours.
   */
  postPage<T, M>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiSuccess<T, M>>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One signal that fires on the caller's abort or on the deadline, whichever comes first.
 *
 * `AbortSignal.timeout` plus `AbortSignal.any` is the obvious way to write this, and it is
 * not portable: React Native replaces the global `AbortSignal` with abort-controller@3, which
 * has neither static — so the phone got `AbortSignal.timeout is not a function` on its very
 * first request. This is the same two rules with an `AbortController`, which every runtime
 * this package targets does have, and it is the ONLY path rather than a fallback: one branch
 * cannot drift from the other.
 *
 * Three details that are the whole reason this is not three lines:
 *
 * - **The already-aborted race.** A caller whose signal fired before we attached would never
 *   fire the listener, so the request would go out and run to full term. Checked first.
 * - **A timeout must not look like a cancellation.** `isAbortError` exists so a request nobody
 *   is waiting for stays silent; a request that ran out of time is a real failure somebody
 *   should see. A bare `controller.abort()` raises an `AbortError` and would be swallowed, so
 *   the deadline aborts with a plain `Error` — not a `DOMException`, which `isAbortError` is
 *   the one thing that checks for.
 * - **The timer is cleared.** Otherwise every completed request leaves a pending timeout for
 *   the rest of its budget, which on a phone is a wake-up nobody asked for.
 */
function withDeadline(
  ms: number,
  caller: AbortSignal | null | undefined,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    // Named, not typed: callers identify a deadline by `name === "TimeoutError"`, the same
    // way `AbortSignal.timeout` reports it. A `DOMException` would be the faithful copy and is
    // not constructible everywhere this runs.
    const expired = new Error(`Request timed out after ${String(ms)}ms`);
    expired.name = "TimeoutError";
    controller.abort(expired);
  }, ms);

  let detach = (): void => {};
  if (caller) {
    if (caller.aborted) {
      clearTimeout(timer);
      controller.abort(caller.reason);
    } else {
      const onAbort = (): void => {
        controller.abort(caller.reason);
      };
      caller.addEventListener("abort", onAbort, { once: true });
      detach = () => {
        caller.removeEventListener("abort", onAbort);
      };
    }
  }

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      detach();
    },
  };
}

export function createApiClient({
  baseUrl,
  session,
  headers: extraHeaders,
  onSessionDead,
  onError,
  timeoutMs = 30_000,
  maxRefreshAttempts = 2,
  refreshRetryDelayMs = 500,
  signOutTimeoutMs = 3_000,
  requestIdHeader = "x-request-id",
}: ApiClientOptions): ApiClient {
  /**
   * Single-flight refresh.
   *
   * A page that fires six queries at once must not send six refreshes. The auth server rotates
   * the refresh token on use, so the losers of that race each invalidate the winner — and the
   * person is signed out in the middle of a load that was working. All three donors found this
   * the hard way and all three fixed it the same way.
   */
  let refreshing: Promise<RefreshResult> | null = null;
  function refresh(): Promise<RefreshResult> {
    refreshing ??= session
      .refresh()
      .catch(() => ({ token: null, reachedAuth: false }))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  /**
   * Latches, so whichever request gets here first owns the sign-out and the rest are no-ops.
   *
   * Keyed on the token that was REFUSED rather than on a boolean, because the latch is about one
   * session and not about the client. An adopter that ends a dead session in place — routing to
   * the sign-in screen instead of reloading — keeps this client across the next sign-in, and a
   * flag that never clears means the second dead session in that tab only throws: nothing calls
   * `onSessionDead`, so every request 401s with nothing left to redirect it. That is the state
   * `signOutTimeoutMs` exists to prevent, reached from the other side, and an adopter hit it.
   *
   * `undefined` means no session has been refused. `null` is a real value here — a request with
   * no token at all can be the one auth answers "no" to.
   */
  let refusedToken: string | null | undefined;
  function sessionDead(token: string | null): never {
    if (refusedToken === undefined) {
      refusedToken = token;
      let done = false;
      const go = (): void => {
        if (done) return;
        done = true;
        onSessionDead();
      };
      void session
        .signOut()
        .catch(() => {})
        .finally(go);
      setTimeout(go, signOutTimeoutMs);
    }
    // Thrown even though the redirect is under way: see `onSessionDead`.
    throw new ApiError(
      401,
      { code: "UNAUTHORIZED", message: "Session expired" },
      { expected: true },
    );
  }

  function buildHeaders(token: string | null, extra?: Record<string, string>): Headers {
    const headers = new Headers({ ...extraHeaders?.(), ...extra });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  async function send(
    path: string,
    token: string | null,
    { headers, timeoutMs: perCall, signal, ...init }: RequestOptions,
  ): Promise<Response> {
    const budget = perCall === undefined ? timeoutMs : perCall;
    if (budget === null)
      return fetch(`${baseUrl}${path}`, { ...init, signal, headers: buildHeaders(token, headers) });

    const deadline = withDeadline(budget, signal);
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: deadline.signal,
        headers: buildHeaders(token, headers),
      });
    } finally {
      deadline.clear();
    }
  }

  async function request(path: string, options: RequestOptions = {}): Promise<Response> {
    const token = await session.getToken();
    // A token that is not the one already refused is a new session, and signing back in inside
    // the same tab is the only thing that produces one. That releases the latch.
    if (refusedToken !== undefined && token !== null && token !== refusedToken)
      refusedToken = undefined;
    let res = await send(path, token, options);

    if (res.status === 401) {
      // Only a refresh that actually REACHED auth proves the session is gone. Anything else is
      // a network problem, and the 401 falls through as an ordinary error — the next request
      // refreshes cleanly once the connection is back. Invariant 3.
      let answered = false;
      // The NEWEST token that was refused, which is what the latch is keyed on. Latching the one
      // the request started with would be wrong: a refresh that yields a token auth then also
      // refuses leaves `getToken` answering that newer one, so the very next request would read
      // it as a fresh session and sign the same dead one out twice.
      let refused = token;
      for (let attempt = 0; attempt < maxRefreshAttempts; attempt++) {
        if (attempt > 0) await sleep(refreshRetryDelayMs);
        const result = await refresh();
        // A later network miss cannot erase an earlier answer from auth. The attempts are one
        // investigation of this session, and one definitive "no" settles it.
        answered ||= result.reachedAuth;
        if (!result.token) continue;
        refused = result.token;
        res = await send(path, result.token, options);
        if (res.status !== 401) break;
      }
      if (res.status === 401 && answered) sessionDead(refused);
    }

    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const error = new ApiError(res.status, isApiError(body) ? body.error : null, {
        requestId: res.headers.get(requestIdHeader) ?? undefined,
        retryAfterSecs: parseRetryAfter(res.headers.get("retry-after")),
      });
      // A listener that throws must not become the error the caller sees: the API failure is
      // the real news, and swallowing it for a bug in a side effect would send everyone
      // debugging the wrong thing.
      try {
        onError?.(error, res);
      } catch {
        // ignored on purpose — see above
      }
      throw error;
    }
    return res;
  }

  /**
   * The success envelope. `request` has already thrown on anything that is not one, so what is
   * left is `{data, meta?}` by contract — this is the single place that assertion is made.
   */
  async function envelope<T, M>(res: Response): Promise<ApiSuccess<T, M>> {
    return (await res.json()) as ApiSuccess<T, M>;
  }

  const json = (body: unknown, options: RequestOptions = {}): RequestOptions =>
    body === undefined
      ? options
      : {
          ...options,
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json", ...options.headers },
        };

  async function data<T>(path: string, options: RequestOptions): Promise<T> {
    return (await envelope<T, never>(await request(path, options))).data;
  }

  return {
    request,
    get: <T>(path: string, options: RequestOptions = {}) =>
      data<T>(path, { ...options, method: "GET" }),
    post: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
      data<T>(path, json(body, { ...options, method: "POST" })),
    put: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
      data<T>(path, json(body, { ...options, method: "PUT" })),
    patch: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
      data<T>(path, json(body, { ...options, method: "PATCH" })),
    del: async (path: string, options: RequestOptions = {}) => {
      await request(path, { ...options, method: "DELETE" });
    },
    delJson: <T>(path: string, options: RequestOptions = {}) =>
      data<T>(path, { ...options, method: "DELETE" }),
    page: async <T, M>(path: string, options: RequestOptions = {}) =>
      envelope<T, M>(await request(path, { ...options, method: "GET" })),
    postPage: async <T, M>(path: string, body?: unknown, options: RequestOptions = {}) =>
      envelope<T, M>(await request(path, json(body, { ...options, method: "POST" }))),
  };
}
