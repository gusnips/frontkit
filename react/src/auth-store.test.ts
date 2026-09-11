import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { authSlice, createAuthStore, type AuthState } from "./auth-store.ts";

interface User {
  id: string;
  email: string;
  isAnonymous?: boolean;
}

describe("createAuthStore", () => {
  it("ends the loading state when it learns who the user is", () => {
    const store = createAuthStore<User>();

    store.getState().setUser({ id: "1", email: "a@b.c" });

    expect(store.getState().isAuthenticated).toBe(true);
    expect(store.getState().isLoading).toBe(false);
  });
});

/**
 * The shape an adopter actually has: an anonymous flag read off the user, plus state and an
 * action of its own. Both halves have to survive `setUser` and `clear`, which is the whole
 * reason `authSlice` exists — a store built on `createAuthStore` could hold neither.
 */
type Extra = { isAnonymous: boolean };

const useAuthStore = create<AuthState<User> & Extra & { restored: boolean; restore: () => void }>(
  (set) => ({
    ...authSlice<User, Extra>(set, (user) => ({ isAnonymous: Boolean(user?.isAnonymous) })),
    restored: false,
    restore: () => set({ restored: true }),
  }),
);

describe("authSlice", () => {
  it("keeps a derived field in step with the user it is read from", () => {
    useAuthStore.getState().setUser({ id: "1", email: "a@b.c", isAnonymous: true });
    expect(useAuthStore.getState().isAnonymous).toBe(true);

    useAuthStore.getState().setUser({ id: "2", email: "d@e.f" });
    expect(useAuthStore.getState().isAnonymous).toBe(false);

    useAuthStore.getState().setUser({ id: "3", email: "g@h.i", isAnonymous: true });
    // Signing out must not leave the flag behind: the next visitor is not anonymous, they are
    // nobody, and a stale `true` here reads as "signed in anonymously" to every guard.
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().isAnonymous).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("leaves the product's own state alone", () => {
    useAuthStore.getState().restore();
    useAuthStore.getState().setUser({ id: "1", email: "a@b.c" });
    useAuthStore.getState().clear();

    expect(useAuthStore.getState().restored).toBe(true);
  });
});
