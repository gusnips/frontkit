import { isAuthError, isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import type { SessionAdapter } from "./api-client.ts";

interface SupabaseSessionResult {
  data: { session: { access_token: string } | null };
}

/** The three auth calls the API client needs, kept structural so any Supabase schema fits. */
export interface SupabaseSessionAuth {
  getSession(): Promise<SupabaseSessionResult>;
  refreshSession(): Promise<SupabaseSessionResult & { error: unknown }>;
  signOut(): Promise<{ error: unknown }>;
}

type Satisfied<T extends true> = T;
type _SupabaseAuthFitsAdapter = Satisfied<
  SupabaseClient["auth"] extends SupabaseSessionAuth ? true : false
>;

/**
 * Auth FAILED rather than answered, so nothing is known about the credential it was handed:
 * either the request never landed, or GoTrue failed on its own.
 *
 * This is the question every site that ends a session has to ask — a token refresh, an API
 * door, and a callback choosing between "try again" and "that link is spent". Without it one
 * bad minute at GoTrue signs out everybody whose token happened to need refreshing, and tells
 * everybody clicking a recovery link that it has expired, which sends them to ask the service
 * that is down for a replacement.
 *
 * Both clauses carry weight, and the second is why this is a function rather than one call.
 * `isAuthRetryableFetchError` is a NAME check, and the statuses that earn that name are a list
 * auth-js owns. The list has drifted — 502, 503 and 504 at 2.91; those plus the 52x family and
 * still no 500 at 2.106; 500 through 530 at 2.108 — so code leaning on it alone is right at
 * whichever version happens to be installed, which is not the same as being right, and a fleet
 * installs several versions at once. It is also a LIST rather than a range, so it has holes at
 * every version, drift or no drift: at 2.112 nothing covers 505 through 519 or 531 up, and a
 * 507 or a 599 out of a proxy in front of GoTrue arrives as a plain `AuthApiError`. Pinning a
 * recent SDK does not make the status clause redundant.
 *
 * Read the version a tree really serves with `bun why @supabase/auth-js`, which prints one
 * heading per RESOLVED version; `node_modules` keeps copies the resolver does not serve.
 *
 * Anything that is not an auth error at all answers true: a failure from outside auth-js is not
 * a verdict on the credential either. Nothing at all answers false — `null` is what every
 * supabase-js auth call returns on success, and success is not an outage.
 */
export function isAuthOutage(error: unknown): boolean {
  // Nothing thrown is not an outage, and this clause exists because the function is exported.
  // `null` is the SUCCESS value of every supabase-js auth call, so the obvious
  // `if (isAuthOutage(error))` around a `getUser()` result has to be safe; without this it read
  // every success as auth being down. An adopter had already written that guard at its own call
  // site, which is what a check missing from in here looks like from the outside.
  if (error == null) return false;
  if (!isAuthError(error)) return true;
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500;
}

function reachedAuth(error: unknown): boolean {
  // Measured across the fleet: four backends answered 401 to their own auth provider's 500,
  // and every client reads a 401 as a dead session, so one bad minute at auth signed out
  // everybody who was signed in. `isAuthError` leads only for the narrowing below —
  // `isAuthOutage` already answers true for anything that is not an auth error.
  if (!isAuthError(error) || isAuthOutage(error)) return false;
  // Newer clients name a refresh that reached GoTrue but was deliberately discarded because the
  // local session changed mid-flight. That race is a no-op, not proof that either session died.
  return error.name !== "AuthRefreshDiscardedError";
}

/**
 * Connects a Supabase auth client to {@link SessionAdapter}.
 *
 * The distinction this preserves is the one that decides whether anybody is signed out: only
 * auth ANSWERING proves a session is gone. A fetch that never landed says nothing about it, and
 * neither does a 5xx, which is auth failing rather than auth answering. A thrown network error
 * stays on that side of the line too.
 */
export function createSupabaseSessionAdapter(auth: SupabaseSessionAuth): SessionAdapter {
  return {
    getToken: async () => {
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    },
    refresh: async () => {
      try {
        const { data, error } = await auth.refreshSession();
        return {
          token: data.session?.access_token ?? null,
          reachedAuth: error === null || reachedAuth(error),
        };
      } catch (error) {
        return { token: null, reachedAuth: reachedAuth(error) };
      }
    },
    signOut: async () => {
      const { error } = await auth.signOut();
      if (error) throw error;
    },
  };
}
