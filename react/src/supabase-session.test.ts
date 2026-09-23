import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createSupabaseSessionAdapter,
  isAuthOutage,
  parseAuthCallback,
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

  it("reads nothing-went-wrong as nothing went wrong", () => {
    // `null` is the SUCCESS value of every supabase-js auth call, and this function is
    // exported, so the obvious `if (isAuthOutage(error))` around a `getUser()` result has to
    // be safe. Before this, it answered true and put an outage on screen over every success.
    // One adopter had already written the guard at its own call site, which is what a missing
    // check in here looks like from the outside.
    expect(isAuthOutage(null)).toBe(false);
    expect(isAuthOutage(undefined)).toBe(false);
  });

  it("stays narrow for an error auth-js could not read", () => {
    // AuthUnknownError is raised whenever the body does not parse as JSON, at ANY status, and
    // it never fills one in — but `status` is still PRESENT, because the base class declares
    // it, so `"status" in error` answers true and says nothing. That makes a 507 behind an
    // HTML-answering proxy indistinguishable from a malformed 400, and the narrow answer is
    // the right one: widening by class name would call the malformed 400 an outage too, and a
    // dead session read as retryable is the same failure from the other side.
    const unreadable = new AuthUnknownError("Unexpected token < in JSON", new Error("parse"));
    expect(unreadable.status).toBeUndefined();
    expect(isAuthOutage(unreadable)).toBe(false);
  });
});

describe("parseAuthCallback", () => {
  it("reads an email link, including the types an app's templates may not send yet", () => {
    expect(parseAuthCallback("?token_hash=pkce_abc&type=recovery")).toEqual({
      kind: "email-link",
      tokenHash: "pkce_abc",
      type: "recovery",
    });
    // An operator can invite from Studio whatever the product does; rejecting the type put
    // "invalid link" on a real, branded invitation.
    expect(parseAuthCallback(new URLSearchParams("token_hash=abc&type=invite"))).toMatchObject({
      kind: "email-link",
      type: "invite",
    });
  });

  it("refuses an email link whose type is missing or made up", () => {
    expect(parseAuthCallback("?token_hash=abc")).toEqual({ kind: "invalid" });
    expect(parseAuthCallback("?token_hash=abc&type=admin")).toEqual({ kind: "invalid" });
    // A key every object inherits is still not a link type.
    expect(parseAuthCallback("?token_hash=abc&type=toString")).toEqual({ kind: "invalid" });
    expect(parseAuthCallback("", "")).toEqual({ kind: "invalid" });
  });

  it("hands back the session a URL carries, in either flow", () => {
    expect(parseAuthCallback("?code=4f1c")).toEqual({
      kind: "session",
      type: null,
      credential: { code: "4f1c" },
    });
    // The implicit flow puts the tokens, and a recovery's type, in the fragment.
    expect(
      parseAuthCallback("", "#access_token=at&expires_in=3600&refresh_token=rt&type=recovery"),
    ).toEqual({
      kind: "session",
      type: "recovery",
      credential: { access_token: "at", refresh_token: "rt" },
    });
    expect(parseAuthCallback("", "#access_token=at")).toEqual({ kind: "invalid" });
  });

  it("tells a person who pressed Cancel from a link that expired", () => {
    // A refusal relayed from the provider: GoTrue writes it to both halves, with no code.
    const cancel = "error=access_denied&error_description=The+user+denied+the+request";
    expect(parseAuthCallback(`?${cancel}`, `#${cancel}&sb=`)).toEqual({
      kind: "error",
      error: "access_denied",
      code: null,
      cancelled: true,
    });
    // GoTrue's own refusal of an implicit-flow email link: the SAME error, a code beside it,
    // and only in the fragment — a query-only reader sees nothing at all.
    expect(
      parseAuthCallback(
        "",
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=",
      ),
    ).toEqual({ kind: "error", error: "access_denied", code: "otp_expired", cancelled: false });
  });

  it("reads a failure that carries no `error` at all", () => {
    // Statuses outside GoTrue's OAuth mapping, a 429 among them, write only the code.
    expect(
      parseAuthCallback("", "#error_code=over_email_send_rate_limit&error_description=x&sb="),
    ).toEqual({ kind: "error", error: null, code: "over_email_send_rate_limit", cancelled: false });
  });
});
