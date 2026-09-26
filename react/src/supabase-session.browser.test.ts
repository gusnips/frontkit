// @vitest-environment happy-dom
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { supabaseAuthStorage } from "./supabase-session.ts";

// A real browser `localStorage` and a real auth-js, so what is measured is the choice supabase-js
// makes for itself, not this file's idea of it. The Node tests beside this one can only stub it.
const PROJECT_URL = "https://abcdefghijklmnop.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";

const base64Url = (value: object): string =>
  btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

const signInAnswers: typeof fetch = async (input) => {
  const { pathname } = new URL(input instanceof Request ? input.url : input);
  if (!pathname.endsWith("/token")) {
    return Response.json({ msg: "not in this test" }, { status: 404 });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const claims = { sub: USER_ID, exp: expiresAt, aud: "authenticated", role: "authenticated" };
  return Response.json({
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url(claims)}.signature`,
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", app_metadata: {} },
  });
};

afterEach(() => {
  localStorage.clear();
});

describe("supabaseAuthStorage in a browser", () => {
  it("uses the browser's localStorage", () => {
    expect(supabaseAuthStorage(PROJECT_URL).storage).toBe(localStorage);
  });

  it("reads the session supabase-js stored with no storage option, so switching signs nobody out", async () => {
    const before = createClient(PROJECT_URL, "anon-key", { global: { fetch: signInAnswers } }).auth;
    await before.signInWithPassword({ email: "someone@example.test", password: "password" });
    await before.stopAutoRefresh();

    const after = createClient(PROJECT_URL, "anon-key", {
      auth: supabaseAuthStorage(PROJECT_URL),
      global: { fetch: signInAnswers },
    }).auth;
    const { data } = await after.getSession();
    await after.stopAutoRefresh();

    expect(data.session?.user.id).toBe(USER_ID);
  });
});
