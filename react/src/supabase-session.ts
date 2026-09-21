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

function reachedAuth(error: unknown): boolean {
  if (!isAuthError(error) || isAuthRetryableFetchError(error)) return false;
  // A 5xx is auth failing, not auth answering — and the vendor's predicate above cannot be
  // relied on to say so, because it reads a list it owns and has already changed: at auth-js
  // 2.91 it covered 502, 503 and 504, at 2.106 those plus the 52x family and still no 500, and
  // at 2.108 it covers 500 through 530. Code leaning on it alone is right at whichever version
  // happens to be installed, which is not the same as being right — and a fleet installs
  // several versions at once, so "we are on a new one" is not the answer either.
  //
  // Without this clause one bad minute at GoTrue signs out everybody whose token happened to
  // need refreshing. Measured across the fleet: four backends answered 401 to their own auth
  // provider's 500 for exactly this reason.
  if ((error.status ?? 0) >= 500) return false;
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
