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

/**
 * Every link type a GoTrue email can carry — not only the ones this app's templates send today.
 * One donor rejected `invite` because "invites are never sent", which was true of the product and
 * false of the deployment: an operator inviting somebody from Studio sent a branded email whose
 * link then said it was invalid. A type the templates never emit costs nothing to accept: the hash
 * is the proof, and GoTrue opens a session only for the person whose one-time token it is.
 *
 * Closed on purpose: auth-js's own `EmailOtpType` ends in `(string & {})`, so it cannot make a
 * destination map name every case. `Record<EmailLinkType, string>` can, and that is where an app
 * decides that `recovery` and `invite` both continue to the new-password screen — GoTrue creates
 * an invited account with NO password, so landing one "inside" signs them in once and locks them
 * out after.
 */
export type EmailLinkType =
  "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

const EMAIL_LINK_TYPES: Record<EmailLinkType, true> = {
  signup: true,
  invite: true,
  magiclink: true,
  recovery: true,
  email_change: true,
  email: true,
};

function isEmailLinkType(value: string): value is EmailLinkType {
  // Not `in`: `"toString" in EMAIL_LINK_TYPES` is true, and the type is typed by whoever sends
  // the link.
  return Object.hasOwn(EMAIL_LINK_TYPES, value);
}

/** Everything an auth callback address can carry, decided from the address alone. */
export type AuthCallback =
  /** An email link with a one-use `token_hash`: trade it with `verifyOtp`, exactly once. */
  | { kind: "email-link"; tokenHash: string; type: EmailLinkType }
  /**
   * A session arriving in the address: a PKCE `code`, or the implicit flow's tokens. In a browser
   * with `detectSessionInUrl` on, the client has already taken it — wait for the session, and do
   * not trade it again, which would be a second exchange racing the first. Where nothing reads
   * the address for you (React Native), `credential` is what `exchangeCodeForSession` or
   * `setSession` takes.
   */
  | {
      kind: "session";
      type: EmailLinkType | null;
      credential: { code: string } | { access_token: string; refresh_token: string };
    }
  /**
   * GoTrue, or the provider behind it, reported a failure in the address. `code` is GoTrue's
   * stable `error_code` (`otp_expired`, `bad_oauth_state`, …) and is what to choose words by;
   * `error_description` is left out on purpose — it is English-only and often names the wrong
   * cause.
   */
  | { kind: "error"; error: string | null; code: string | null; cancelled: boolean }
  /** Nothing usable: cut short between the mail client and here, or edited by hand. */
  | { kind: "invalid" };

/**
 * Reads an auth callback address. Pure, so every edge case is testable without a router or a
 * client — pass `location.search` and `location.hash`, or the two halves of a deep link.
 *
 * GoTrue writes a failure into the FRAGMENT on every path and into the query only on some — the
 * query too after a provider round trip, the fragment alone after an implicit-flow email link —
 * so a callback reading one of the two misses a failure the other carries, and the person lands
 * on a screen that says nothing. Both are read here.
 *
 * `cancelled` is the provider refusing on its own, which for Google is the person pressing Cancel
 * — their choice, not a failure to report. It is NOT `error === "access_denied"`: GoTrue writes
 * that same value for an expired email link, a banned user and a disabled signup, each with an
 * `error_code` beside it, while a refusal relayed from the provider arrives with none. The obvious
 * test reads an expired link as a change of mind. And `error` itself is absent for a status
 * outside GoTrue's OAuth mapping — a rate-limited link arrives with `error_code` alone.
 */
export function parseAuthCallback(search: string | URLSearchParams, hash = ""): AuthCallback {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const read = (name: string) => query.get(name) || fragment.get(name) || null;

  const error = read("error");
  const code = read("error_code");
  if (error || code || read("error_description"))
    return { kind: "error", error, code, cancelled: error === "access_denied" && code === null };

  const rawType = read("type") ?? "";
  const type = isEmailLinkType(rawType) ? rawType : null;

  const tokenHash = query.get("token_hash")?.trim();
  if (tokenHash) return type ? { kind: "email-link", tokenHash, type } : { kind: "invalid" };

  const pkceCode = query.get("code");
  if (pkceCode) return { kind: "session", type, credential: { code: pkceCode } };

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken)
    return {
      kind: "session",
      type,
      credential: { access_token: accessToken, refresh_token: refreshToken },
    };

  return { kind: "invalid" };
}
