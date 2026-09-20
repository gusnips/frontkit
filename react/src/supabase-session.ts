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
  // Newer clients name a refresh that reached GoTrue but was deliberately discarded because the
  // local session changed mid-flight. That race is a no-op, not proof that either session died.
  return error.name !== "AuthRefreshDiscardedError";
}

/**
 * Connects a Supabase auth client to {@link SessionAdapter}.
 *
 * The distinction this preserves is the one that decides whether anybody is signed out: a
 * retryable fetch error never reached GoTrue and says nothing about the session; any other auth
 * error is an answer. A thrown network error stays on the first side of that line too.
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
