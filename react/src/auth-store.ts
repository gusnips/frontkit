import { create, type StoreApi, type UseBoundStore } from "zustand";

/**
 * Session FLAGS only.
 *
 * Who the person is — their plan, their staff bit, whether they are suspended — comes from
 * `GET /auth/me` through react-query, never from here. Mirroring server state in a client store
 * is how two sources of truth start disagreeing, and the one that is wrong is always the one on
 * screen. Three repos wrote this same store; two of them wrote that same warning in a comment.
 *
 * `TUser` stays generic because it is the one part that differs: one product carries an
 * anonymous-browsing flag, another does not. Keep it to what a GUARD needs — an id and an
 * email is what all three donors had.
 */
export interface AuthState<TUser> {
  user: TUser | null;
  isAuthenticated: boolean;
  /**
   * True until the first session lookup resolves. The guards must not bounce somebody to
   * /login while we are still finding out whether they are signed in.
   */
  isLoading: boolean;
  /**
   * Set (or clear) the signed-in user. This ENDS the loading state — knowing who they are is
   * what the bootstrap was waiting for. Two of the three donors left `isLoading` alone here and
   * relied on a separate `setLoading(false)`; forgetting that call leaves every guard spinning,
   * so the safe default is to do it in one write.
   */
  setUser: (user: TUser | null) => void;
  setLoading: (isLoading: boolean) => void;
  /** Sign-out: clears the user and ends the loading state in one write. */
  clear: () => void;
}

/**
 * Create the store.
 *
 * The whole reason this is a factory and not a store: `isLoading` must start FALSE where there
 * is no window, and only a factory can decide that at the call site rather than at import.
 *
 * A session bootstrap can only be in flight in a browser. The BUILD renders this app to files
 * with no window at all, so `true` there is a wait that never ends — one donor shipped a route
 * guard holding its loading screen forever, and prerendered a public page as 1,174 bytes of
 * `role="status"`: a spinner as the indexable body of a page whose entire purpose was to be
 * found. With no browser there is no session and never will be, which is exactly the state a
 * first-time visitor arrives in, so that is what the page should render.
 *
 * Only one of the three donors knew this. It is invariant 7.
 */
export function createAuthStore<TUser>(): UseBoundStore<StoreApi<AuthState<TUser>>> {
  return create<AuthState<TUser>>((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: typeof window !== "undefined",
    setUser: (user) => set({ user, isAuthenticated: Boolean(user), isLoading: false }),
    setLoading: (isLoading) => set({ isLoading }),
    clear: () => set({ user: null, isAuthenticated: false, isLoading: false }),
  }));
}
