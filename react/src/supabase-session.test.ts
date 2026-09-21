import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createSupabaseSessionAdapter,
  isAuthOutage,
  type SupabaseSessionAuth,
} from "./supabase-session.ts";

function auth(overrides: Partial<SupabaseSessionAuth> = {}): SupabaseSessionAuth {
  return {
    getSession: async () => ({ data: { session: { access_token: "old-token" } } }),
    refreshSession: async () => ({
      data: { session: { access_token: "new-token" } },
      error: null,
    }),
    signOut: async () => ({ error: null }),
    ...overrides,
  };
}

describe("createSupabaseSessionAdapter", () => {
  it("reads the current token and the refreshed token", async () => {
    const adapter = createSupabaseSessionAdapter(auth());

    await expect(adapter.getToken()).resolves.toBe("old-token");
    await expect(adapter.refresh()).resolves.toEqual({
      token: "new-token",
      reachedAuth: true,
    });
  });

  it("keeps the session when a refresh never reached auth", async () => {
    const retryable = new AuthRetryableFetchError("offline", 0);
    const returned = createSupabaseSessionAdapter(
      auth({
        refreshSession: async () => ({ data: { session: null }, error: retryable }),
      }),
    );
    const thrown = createSupabaseSessionAdapter(
      auth({
        refreshSession: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );

    await expect(returned.refresh()).resolves.toEqual({ token: null, reachedAuth: false });
    await expect(thrown.refresh()).resolves.toEqual({ token: null, reachedAuth: false });
  });

  it("marks a terminal auth refusal whether it is returned or thrown", async () => {
    const refusal = new AuthApiError("expired", 401, "refresh_token_not_found");
    const returned = createSupabaseSessionAdapter(
      auth({
        refreshSession: async () => ({ data: { session: null }, error: refusal }),
      }),
    );
    const thrown = createSupabaseSessionAdapter(
      auth({
        refreshSession: async () => {
          throw refusal;
        },
      }),
    );

    await expect(returned.refresh()).resolves.toEqual({ token: null, reachedAuth: true });
    await expect(thrown.refresh()).resolves.toEqual({ token: null, reachedAuth: true });
  });

  it("keeps the session when auth answers with a failure of its own", async () => {
    // `isAuthRetryableFetchError` says false for this one — it is an API error, not a fetch
    // failure — so what holds the session is the status clause beside it. A 5xx is auth
    // failing, never auth answering, and reading it as an answer signs the person out.
    const outage = new AuthApiError("Internal Server Error", 500, undefined);
    const adapter = createSupabaseSessionAdapter(
      auth({
        refreshSession: async () => ({ data: { session: null }, error: outage }),
      }),
    );

    await expect(adapter.refresh()).resolves.toEqual({ token: null, reachedAuth: false });
  });

  it("does not kill a session whose rotated refresh was discarded after a local race", async () => {
    const adapter = createSupabaseSessionAdapter(
      auth({
        refreshSession: async () => ({
          data: { session: null },
          error: new AuthRefreshDiscardedError(),
        }),
      }),
    );

    await expect(adapter.refresh()).resolves.toEqual({ token: null, reachedAuth: false });
  });

  it("turns a resolved sign-out error into a rejection", async () => {
    const refusal = new AuthApiError("unavailable", 503, "unexpected_failure");
    const signOut = vi.fn(async () => ({ error: refusal }));
    const adapter = createSupabaseSessionAdapter(auth({ signOut }));

    await expect(adapter.signOut()).rejects.toBe(refusal);
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("isAuthOutage", () => {
  it("lets a real refusal through as an answer", () => {
    expect(
      isAuthOutage(new AuthApiError("Invalid login credentials", 400, "invalid_credentials")),
    ).toBe(false);
    expect(
      isAuthOutage(new AuthApiError("Token has expired or is invalid", 403, "otp_expired")),
    ).toBe(false);
  });

  it("refuses to read a failure as an answer", () => {
    // Nothing came back, and the two shapes that carries.
    expect(isAuthOutage(new AuthRetryableFetchError("Failed to fetch", 0))).toBe(true);
    expect(isAuthOutage(new TypeError("Load failed"))).toBe(true);
    // A gateway between us and GoTrue, which auth-js wraps by name.
    expect(isAuthOutage(new AuthRetryableFetchError("Bad Gateway", 502))).toBe(true);
    // And the reason the status clause is not redundant: the statuses earning that name are a
    // LIST, so it has holes at every version. 507 and 599 are on no version of it, and arrive
    // as ordinary AuthApiErrors that `isAuthRetryableFetchError` answers false for.
    expect(isAuthOutage(new AuthApiError("Insufficient Storage", 507, undefined))).toBe(true);
    expect(isAuthOutage(new AuthApiError("Network Connect Timeout", 599, undefined))).toBe(true);
  });
});
