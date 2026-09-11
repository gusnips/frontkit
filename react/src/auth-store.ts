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
  return create<AuthState<TUser>>((set) => authSlice<TUser, EmptyExtra>(set, () => ({})));
}

/** What `authSlice` derives when a product adds nothing of its own. */
type EmptyExtra = Record<never, never>;

/**
 * zustand's `set`, narrowed to the two writes this slice makes.
 *
 * Not `Partial<AuthState<TUser> & TExtra>`, which is what it means and what a caller passes:
 * inside a generic function TypeScript cannot check `{ isLoading }` against a partial of an
 * unresolved type parameter, because `TExtra` might yet declare an `isLoading` of its own. The
 * union says the same thing in terms it can check at both ends. Any real store's setter
 * satisfies it, where `TExtra` is a concrete type.
 */
type AuthSet<TUser, TExtra> = (
  partial: (TExtra & Partial<AuthState<TUser>>) | Pick<AuthState<TUser>, "isLoading">,
) => void;

/**
 * The session flags as a plain object, for a product whose store needs more than them.
 *
 * `createAuthStore` owns its `create()` call, which means it owns the whole store: a product
 * cannot wrap it in `persist`, cannot add an action, and cannot add a field. Both adopters that
 * met it had a superset and neither could use it. One holds a remember-me choice, a profile row
 * and the sign-in methods themselves, under `persist`. The other adds `isAnonymous` — and that
 * one is the reason this takes a `derive` function rather than just letting the caller spread
 * extra keys in: `isAnonymous` is read off the user, so it has to be rewritten by `setUser` and
 * `clear`, which are exactly the two writes the product does not own.
 *
 * The caller keeps `create`, so middleware, extra actions and the store's own name stay theirs:
 *
 * ```ts
 * const useAuthStore = create<AuthState<User> & { isAnonymous: boolean }>((set) => ({
 *   ...authSlice<User, { isAnonymous: boolean }>(set, (user) => ({ isAnonymous: !!user?.isAnonymous })),
 * }));
 * ```
 */
export function authSlice<TUser, TExtra extends object>(
  set: AuthSet<TUser, TExtra>,
  derive: (user: TUser | null) => TExtra,
): AuthState<TUser> & TExtra {
  return {
    ...derive(null),
    user: null,
    isAuthenticated: false,
    isLoading: typeof window !== "undefined",
    setUser: (user) =>
      set({ ...derive(user), user, isAuthenticated: Boolean(user), isLoading: false }),
    setLoading: (isLoading) => set({ isLoading }),
    clear: () => set({ ...derive(null), user: null, isAuthenticated: false, isLoading: false }),
  };
}
