import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, isAbortError } from "./api-error.ts";
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

afterEach(() => vi.unstubAllGlobals());

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
   * providerkit's invariant 2, on the web side: a caller's Stop and our deadline must stay
   * distinguishable. `AbortSignal.timeout` rejects with a **TimeoutError**, not an AbortError,
   * so `isAbortError` stays false for it — which is what lets a timeout be retried and reported
   * while a navigation-cancelled request is silently dropped.
   */
  it("distinguishes its own timeout from the caller's abort", async () => {
    // Note the `aborted` check before the listener. A signal that fired before fetch was ever
    // called never emits the event, so a listener alone hangs forever — real `fetch` checks the
    // flag first, and so must anything standing in for it. That already-aborted race is exactly
    // what `AbortSignal.any` in the client exists to cover.
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
    expect((timedOut as DOMException).name).toBe("TimeoutError");
    expect(isAbortError(timedOut)).toBe(false);

    const controller = new AbortController();
    const cancelled = api.get("/slow", { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    expect(isAbortError(await cancelled)).toBe(true);
  });
});
