import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseSessionAdapter, type SupabaseSessionAuth } from "./supabase-session.ts";

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
