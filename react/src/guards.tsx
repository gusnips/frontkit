import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * Route guards.
 *
 * Two donors wrote these four, gave two of them the same names, and explained them in nearly
 * the same words. What differed was one line — and that line is invariant 4, so it is the
 * reason this file exists rather than being copied a ninth time.
 *
 * These are factories because the destinations are the app's: `paths.signIn` is not something a
 * package can know, and one donor hardcoded `/login` in four places for exactly that reason.
 *
 * A guard is a COURTESY, never the boundary. The API refuses what it refuses whatever any of
 * these decide. What they buy is that somebody who types a URL lands on one screen that
 * explains itself instead of four panels each failing separately.
 */

/** What the guard needs off the session store. */
export interface SessionState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * The answer to a "who is this?" query, in the three states it actually has.
 *
 * This shape is invariant 4. A guard reading `!me?.isStaff` collapses "loading", "failed" and
 * "no" into one branch — so an operator arriving while `/auth/me` is 500ing is told the page
 * does not exist. Wrong cause, no retry, and no request id to quote to support. One donor hit
 * that and fixed it; the other still has the collapsed version.
 */
export type MeQuery<TMe> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "success"; data: TMe };

export interface GuardOptions {
  /** Drawn while the session or the profile is still resolving. */
  loading: ReactNode;
}

/**
 * Signed in, or off to sign in — remembering where they were headed, so the redirect afterwards
 * lands on the page they actually wanted rather than the home screen.
 */
export function createRequireAuth(
  useSession: () => SessionState,
  signInPath: string,
  { loading }: GuardOptions,
) {
  return function RequireAuth({ children }: { children: ReactNode }) {
    const { isAuthenticated, isLoading } = useSession();
    const location = useLocation();
    if (isLoading) return <>{loading}</>;
    if (!isAuthenticated)
      return (
        <Navigate to={signInPath} replace state={{ from: location.pathname + location.search }} />
      );
    return <>{children}</>;
  };
}

/** The mirror: somebody already signed in has no business on the sign-in screen. */
export function createRequireAnonymous(
  useSession: () => SessionState,
  homePath: string,
  { loading }: GuardOptions,
) {
  return function RequireAnonymous({ children }: { children: ReactNode }) {
    const { isAuthenticated, isLoading } = useSession();
    if (isLoading) return <>{loading}</>;
    if (isAuthenticated) return <Navigate to={homePath} replace />;
    return <>{children}</>;
  };
}

/**
 * A gate on something the profile says — suspended, staff, on a given plan.
 *
 * `allow` gets the profile and answers yes or no. `onDenied` draws the refusal; `onError` draws
 * the failure, and they are SEPARATE arguments on purpose. That separation is the whole point
 * of this file: "you may not see this" and "we could not find out" are different sentences, and
 * showing the first when the second is true is how an outage becomes a support ticket about
 * permissions.
 */
export function createRequireProfile<TMe>(
  useMe: () => MeQuery<TMe>,
  { loading }: GuardOptions,
) {
  return function requireProfile(
    allow: (me: TMe) => boolean,
    onDenied: ReactNode | (() => ReactNode),
    onError: (error: unknown) => ReactNode,
  ) {
    return function RequireProfile({ children }: { children: ReactNode }) {
      const query = useMe();
      if (query.status === "loading") return <>{loading}</>;
      if (query.status === "error") return <>{onError(query.error)}</>;
      if (!allow(query.data)) return <>{typeof onDenied === "function" ? onDenied() : onDenied}</>;
      return <>{children}</>;
    };
  };
}
