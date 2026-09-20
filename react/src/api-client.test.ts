import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, isAbortError, retryAfterSecs } from "./api-error.ts";
import { createApiClient, type RefreshResult, type SessionAdapter } from "./api-client.ts";

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "no" } }), { status: 401 });

function session(overrides: Partial<SessionAdapter> = {}): SessionAdapter {
  return {
    getToken: async () => "old-token",
    refresh: async (): Promise<RefreshResult> => ({ token: "new-token", reachedAuth: true }),
    signOut: async () => {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createApiClient", () => {
  it("unwraps the success envelope", async () => {
    stubFetch(() => ok({ id: 7 }));
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
    });
    await expect(api.get<{ id: number }>("/me")).resolves.toEqual({ id: 7 });
  });

  it("throws an ApiError carrying the whole envelope and the request id", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { code: "QUOTA_EXCEEDED", message: "spent", details: { retryAfterSecs: 60 } },
          }),
          { status: 429, headers: { "x-request-id": "req_1" } },
        ),
    );
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
    });

    const error = await api.get("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "QUOTA_EXCEEDED",
      details: { retryAfterSecs: 60 },
      requestId: "req_1",
    });
  });

  /**
   * The second migration's API states the wait in the HEADER and puts nothing in the body — the
   * standard place, and the one this package did not read. `retryAfterSecs` now answers for
   * either convention, which is what lets one retry rule and one piece of copy serve both.
   */
  it("reads the wait off the Retry-After header", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "RATE_LIMIT_EXCEEDED", message: "slow" } }), {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
    );
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
    });

    const error = await api.get("/x").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429, retryAfterSecs: 60 });
    expect(retryAfterSecs(error as ApiError)).toBe(60);
  });

  it("leaves the wait unset when the answer did not state one", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
    });

    const error = await api.get("/x").catch((e: unknown) => e);
    expect((error as ApiError).retryAfterSecs).toBeUndefined();
    expect(retryAfterSecs(error as ApiError)).toBeNull();
  });

  /**
   * The single-flight rule, and the reason all three donors found it the hard way: the auth
   * server rotates the refresh token on use, so six parallel 401s sending six refreshes means
   * five of them invalidate the winner — and the person is signed out in the middle of a load
   * that was working.
   */
  it("sends one refresh for six concurrent 401s", async () => {
    let refreshes = 0;
    let token = "old-token";
    stubFetch((_url, init) => {
      const auth = new Headers(init.headers).get("Authorization");
      return auth === "Bearer new-token" ? ok({}) : unauthorized();
    });

    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({
        getToken: async () => token,
        refresh: async () => {
          refreshes++;
          // A real rotation: the old token is dead the moment a refresh succeeds.
          await new Promise((r) => setTimeout(r, 5));
          token = "new-token";
          return { token, reachedAuth: true };
        },
      }),
      onSessionDead: () => {},
    });

    await Promise.all(Array.from({ length: 6 }, () => api.get("/me")));
    expect(refreshes).toBe(1);
  });

  /**
   * Invariant 3. Only one of three donors had this, and it is the difference between a Wi-Fi
   * blip and losing your place: a refresh that never got an ANSWER out of auth says nothing
   * about whether the session is good, so the 401 falls through as an ordinary error and the
   * next request refreshes cleanly once the connection is back.
   */
  it("does not sign anyone out when the refresh never reached auth", async () => {
    stubFetch(() => unauthorized());
    const onSessionDead = vi.fn();
    const signOut = vi.fn(async () => {});

    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({
        refresh: async () => ({ token: null, reachedAuth: false }),
        signOut,
      }),
      onSessionDead,
      refreshRetryDelayMs: 0,
    });

    const error = await api.get("/me").catch((e: unknown) => e);
    expect(onSessionDead).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    // It surfaces as an ordinary 401 the caller can report, not as an expected sign-out.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).expected).toBe(false);
  });

  it("remembers an auth answer across later failed refresh attempts", async () => {
    stubFetch(() => unauthorized());
    const onSessionDead = vi.fn();
    let refreshes = 0;
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({
        refresh: async () =>
          ++refreshes === 1
            ? { token: null, reachedAuth: true }
            : { token: null, reachedAuth: false },
      }),
      onSessionDead,
      refreshRetryDelayMs: 0,
    });

    const error = await api.get("/me").catch((e: unknown) => e);
    expect(refreshes).toBe(2);
    expect(onSessionDead).toHaveBeenCalledTimes(1);
    expect((error as ApiError).expected).toBe(true);
  });

  it("uses the fail-safe when sign-out never settles", async () => {
    vi.useFakeTimers();
    stubFetch(() => unauthorized());
    const onSessionDead = vi.fn();
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({
        refresh: async () => ({ token: null, reachedAuth: true }),
        signOut: () => new Promise(() => {}),
      }),
      onSessionDead,
      maxRefreshAttempts: 1,
      signOutTimeoutMs: 3_000,
    });

    await api.get("/me").catch(() => {});
    expect(onSessionDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onSessionDead).toHaveBeenCalledTimes(1);
  });

  it("signs out once when auth actually says no", async () => {
    stubFetch(() => unauthorized());
    const onSessionDead = vi.fn();
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({ refresh: async () => ({ token: null, reachedAuth: true }) }),
      onSessionDead,
      refreshRetryDelayMs: 0,
    });

    const first = await api.get("/a").catch((e: unknown) => e);
    await api.get("/b").catch(() => {});

    // Latched: whichever request got there first owns the sign-out.
    expect(onSessionDead).toHaveBeenCalledTimes(1);
    // Still throws, because location.replace() does not stop the current frame — a caller's
    // own onError has to run or a half-finished screen keeps rendering against data that will
    // never arrive. `expected` is what keeps it out of crash reporting.
    expect((first as ApiError).expected).toBe(true);
  });

  /**
   * The latch is about one SESSION, not about the client.
   *
   * An adopter that ends a dead session IN PLACE — routing to the sign-in screen rather than
   * reloading — keeps this client across the next sign-in. A latch that never clears means the
   * SECOND dead session in that tab only throws: nothing calls `onSessionDead`, so every
   * request 401s with nothing left to redirect it. That is the same end state the sign-out
   * fail-safe timer exists to prevent, reached from the other side.
   */
  it("signs out again after the tab signs back in", async () => {
    stubFetch(() => unauthorized());
    const onSessionDead = vi.fn();
    let token = "first-session";
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({
        getToken: async () => token,
        refresh: async () => ({ token: null, reachedAuth: true }),
      }),
      onSessionDead,
      refreshRetryDelayMs: 0,
    });

    await api.get("/a").catch(() => {});
    expect(onSessionDead).toHaveBeenCalledTimes(1);

    // The person signs back in without reloading: same client, a different token.
    token = "second-session";
    await api.get("/b").catch(() => {});
    expect(onSessionDead).toHaveBeenCalledTimes(2);

    // …and the second session latches on its own, exactly as the first one did.
    await api.get("/c").catch(() => {});
    expect(onSessionDead).toHaveBeenCalledTimes(2);
  });

  /**
   * …and the latch holds the NEWEST refused token, not the one the request started with.
   *
   * A refresh can hand back a rotated token that auth then also refuses. The adapter stores it,
   * so `getToken` answers with it from then on — and a latch keyed on the token the request
   * began with would read that as a fresh session and sign the same dead one out twice.
   */
  it("does not sign out twice when the refused token was itself a refresh", async () => {
    stubFetch(() => unauthorized());
    const onSessionDead = vi.fn();
    let token = "old-token";
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session({
        getToken: async () => token,
        refresh: async () => {
          // What a rotating auth server does: a new token the API still refuses.
          token = "rotated-token";
          return { token, reachedAuth: true };
        },
      }),
      onSessionDead,
      refreshRetryDelayMs: 0,
    });

    await api.get("/a").catch(() => {});
    await api.get("/b").catch(() => {});
    expect(onSessionDead).toHaveBeenCalledTimes(1);
  });

  /**
   * providerkit's invariant 2, on the web side: a caller's Stop and our deadline must stay
   * distinguishable. The deadline aborts with a **TimeoutError**, not an AbortError, so
   * `isAbortError` stays false for it — which is what lets a timeout be retried and reported
   * while a navigation-cancelled request is silently dropped.
   */
  it("distinguishes its own timeout from the caller's abort", async () => {
    // Note the `aborted` check before the listener. A signal that fired before fetch was ever
    // called never emits the event, so a listener alone hangs forever — real `fetch` checks the
    // flag first, and so must anything standing in for it. That already-aborted race is one of
    // the three things `withDeadline` exists to get right.
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal | null;
          if (signal?.aborted) return reject(signal.reason as Error);
          signal?.addEventListener("abort", () => reject(signal.reason as Error));
        }),
    );
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
      timeoutMs: 10,
    });

    const timedOut = await api.get("/slow").catch((e: unknown) => e);
    expect((timedOut as Error).name).toBe("TimeoutError");
    expect(isAbortError(timedOut)).toBe(false);

    const controller = new AbortController();
    const cancelled = api.get("/slow", { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    expect(isAbortError(await cancelled)).toBe(true);

    // The already-aborted race: a signal that fired BEFORE the call. A listener alone never
    // hears it, so the request would go out and run to full term with nobody waiting.
    const already = new AbortController();
    already.abort();
    const dead = await api.get("/slow", { signal: already.signal }).catch((e: unknown) => e);
    expect(isAbortError(dead)).toBe(true);
  });

  /**
   * React Native replaces the global `AbortSignal` with abort-controller@3, which has neither
   * `timeout` nor `any`. The client used both, so `createApiClient` threw
   * `AbortSignal.timeout is not a function` on the phone's first request — in the main entry,
   * the one this package promises works there. Deleting the statics is the cheapest honest
   * stand-in for that runtime.
   */
  it("works where AbortSignal has no static helpers, as on a phone", async () => {
    const { timeout, any } = AbortSignal as unknown as Record<string, unknown>;
    delete (AbortSignal as unknown as Record<string, unknown>).timeout;
    delete (AbortSignal as unknown as Record<string, unknown>).any;
    try {
      stubFetch(() => ok({ id: "1" }));
      const api = createApiClient({
        baseUrl: "https://api.test",
        session: session(),
        onSessionDead: () => {},
      });
      await expect(api.get("/me")).resolves.toEqual({ id: "1" });
    } finally {
      Object.assign(AbortSignal, { timeout, any });
    }
  });

  // A 204 has no body, so `res.json()` on one throws `Unexpected end of JSON input` — which
  // reads like a malformed response and is really a success nobody was allowed to parse. The
  // donor's dashboard DELETEs all answer 204, so `del` must not go looking for data.
  it("deletes without reading the body, and reads it only when asked", async () => {
    const fetched = stubFetch((_url, init) =>
      init.method === "DELETE" && !String(_url).endsWith("/queue/1")
        ? new Response(null, { status: 204 })
        : ok({ removed: true }),
    );
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
    });

    await expect(api.del("/keys/1")).resolves.toBeUndefined();
    await expect(api.delJson<{ removed: boolean }>("/queue/1")).resolves.toEqual({ removed: true });
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  /**
   * The metered POST. `post` keeps only `data`, and on a metered route the `meta` beside it is
   * half the answer — what the call cost, whether a cache hit made it free. Two adopters wanted
   * that off a POST (the input is a URL or a search query, too long and too punctuated for a path
   * segment) and both reached past the client for `res.json()` to get it.
   */
  it("returns the whole envelope off a POST, with the body serialized", async () => {
    const body = { data: { markdown: "# hi" }, meta: { cost: 0, cached: true } };
    const fetched = stubFetch(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
    });

    await expect(
      api.postPage<{ markdown: string }, { cost: number; cached: boolean }>("/v1/scrape", {
        url: "https://example.com",
      }),
    ).resolves.toEqual(body);

    const init = fetched.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    // Serialized and typed by the client, exactly as `post` does it — the half a hand-rolled
    // `request()` call has to remember, and the reason this is not just `page` with a method.
    expect(init.body).toBe(JSON.stringify({ url: "https://example.com" }));
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("reports a failure to onError once, and still throws it", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "suspended",
              messageKey: "serverErrors.suspended",
            },
          }),
          { status: 403 },
        ),
    );
    const seen: ApiError[] = [];
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
      onError: (error) => seen.push(error),
    });

    const thrown = await api.get("/numbers").catch((e: unknown) => e);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.messageKey).toBe("serverErrors.suspended");
    // The same object, not a copy: a listener that stashes it can compare identity later.
    expect(thrown).toBe(seen[0]);
  });

  /**
   * A refusal's headers reach nobody otherwise: `request` throws before the `Response` escapes.
   * One adopter's API reports what every call cost on the error path too — `x-request-cost: 0`
   * on a page that was walled — which is the whole promise "a blocked page costs nothing" made
   * checkable. Without the response here, adopting this client would have deleted that screen.
   */
  it("hands the failed response to onError, headers and all", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "UPSTREAM_BLOCKED", message: "walled" } }), {
          status: 422,
          headers: { "x-request-cost": "0" },
        }),
    );
    const seen: { code: string | undefined; cost: string | null }[] = [];
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
      onError: (error, response) =>
        seen.push({ code: error.code, cost: response.headers.get("x-request-cost") }),
    });

    await api.get("/v1/scrape").catch(() => {});
    expect(seen).toEqual([{ code: "UPSTREAM_BLOCKED", cost: "0" }]);
  });

  it("does not let a broken listener replace the API failure", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no" } }), {
          status: 404,
        }),
    );
    const api = createApiClient({
      baseUrl: "https://api.test",
      session: session(),
      onSessionDead: () => {},
      onError: () => {
        throw new Error("the listener is buggy");
      },
    });

    const thrown = await api.get("/x").catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(404);
  });
});
