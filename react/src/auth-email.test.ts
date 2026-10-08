import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAuthEmail, recallAuthEmail, rememberAuthEmail } from "./auth-email.ts";

const KEY = "frontkit.auth-email";
const MINUTE = 60 * 1000;

/**
 * `localStorage` stubbed rather than run under a DOM, the same call as `theme.test.ts`. What
 * matters is what a browser does at the edges: site data blocked (every method throws), a quota
 * that refuses new writes while old ones stay readable, and a page with no storage at all.
 */
function storage({ blocked = false }: { blocked?: boolean } = {}) {
  const store = new Map<string, string>();
  const state = { blocked, full: false };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (state.blocked) throw new Error("site data blocked");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (state.blocked || state.full) throw new Error("site data blocked");
      store.set(key, value);
    },
    removeItem: (key: string) => {
      if (state.blocked) throw new Error("site data blocked");
      store.delete(key);
    },
  });
  return { store, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
});

afterEach(() => {
  forgetAuthEmail();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("remember and recall", () => {
  it("starts empty", () => {
    storage();
    expect(recallAuthEmail()).toBe("");
  });

  it("hands back what was typed, as typed", () => {
    storage();
    rememberAuthEmail(" Ana@Example.com ");
    expect(recallAuthEmail()).toBe(" Ana@Example.com ");
  });

  it("writes to localStorage, so a new tab opened from a mail finds it", () => {
    const { store } = storage();
    rememberAuthEmail("ana@example.com");
    expect(JSON.parse(store.get(KEY) ?? "null")).toMatchObject({ email: "ana@example.com" });
  });

  it("empties when the field is cleared", () => {
    const { store } = storage();
    rememberAuthEmail("ana@example.com");
    rememberAuthEmail("");
    expect(recallAuthEmail()).toBe("");
    expect(store.has(KEY)).toBe(false);
  });

  it("keeps the last good value when handed something longer than an address can be", () => {
    storage();
    rememberAuthEmail("ana@example.com");
    rememberAuthEmail("a".repeat(255));
    expect(recallAuthEmail()).toBe("ana@example.com");
  });

  it("forgets on request", () => {
    const { store } = storage();
    rememberAuthEmail("ana@example.com");
    forgetAuthEmail();
    expect(recallAuthEmail()).toBe("");
    expect(store.has(KEY)).toBe(false);
  });
});

describe("the thirty minutes", () => {
  it("lets go after thirty minutes of nothing, and deletes what it found", () => {
    const { store } = storage();
    rememberAuthEmail("ana@example.com");
    vi.advanceTimersByTime(30 * MINUTE);
    expect(recallAuthEmail()).toBe("ana@example.com");
    vi.advanceTimersByTime(1);
    expect(recallAuthEmail()).toBe("");
    expect(store.has(KEY)).toBe(false);
  });

  it("renews on every keystroke", () => {
    storage();
    rememberAuthEmail("ana@example.com");
    vi.advanceTimersByTime(25 * MINUTE);
    rememberAuthEmail("ana@example.com.br");
    vi.advanceTimersByTime(25 * MINUTE);
    expect(recallAuthEmail()).toBe("ana@example.com.br");
  });
});

describe("when the browser will not store it", () => {
  it("falls back to memory when site data is blocked", () => {
    storage({ blocked: true });
    rememberAuthEmail("ana@example.com");
    expect(recallAuthEmail()).toBe("ana@example.com");
    forgetAuthEmail();
    expect(recallAuthEmail()).toBe("");
  });

  it("falls back to memory when there is no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    rememberAuthEmail("ana@example.com");
    expect(recallAuthEmail()).toBe("ana@example.com");
  });

  it("prefers the newer address when a full quota left an older one in storage", () => {
    const { state } = storage();
    rememberAuthEmail("old@example.com");
    state.full = true;
    vi.advanceTimersByTime(MINUTE);
    rememberAuthEmail("new@example.com");
    expect(recallAuthEmail()).toBe("new@example.com");
  });

  it("prefers what another tab wrote after this tab's memory went stale", () => {
    const { store } = storage();
    rememberAuthEmail("old@example.com");
    vi.advanceTimersByTime(MINUTE);
    store.set(KEY, JSON.stringify({ email: "new@example.com", at: Date.now() }));
    expect(recallAuthEmail()).toBe("new@example.com");
  });

  it("ignores a stored value that is not ours", () => {
    const { store } = storage();
    store.set(KEY, "{not json");
    expect(recallAuthEmail()).toBe("");
    store.set(KEY, JSON.stringify({ email: 42, at: "now" }));
    expect(recallAuthEmail()).toBe("");
  });
});
