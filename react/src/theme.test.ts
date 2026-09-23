import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTheme, startTheme, type ThemeOptions } from "./theme.ts";

const KEY = "app.theme";

/**
 * The few globals the controller touches, stubbed rather than run under a DOM — the same call as
 * `deploy-recovery.test.ts`. What matters is what a browser does at the edges: storage that
 * throws from both methods when site data is blocked, an OS preference that changes under the
 * page, and events from other tabs.
 */
function browser({
  stored,
  osDark = false,
  blocked = false,
  metas = 0,
}: { stored?: string; osDark?: boolean; blocked?: boolean; metas?: number } = {}) {
  const store = new Map<string, string>(stored === undefined ? [] : [[KEY, stored]]);
  const state = { blocked };
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const media = { matches: osDark, listeners: [] as Array<() => void> };
  const events = new Map<string, Array<(event: { key: string | null }) => void>>();
  const themeColors = Array.from({ length: metas }, () => ({ content: "" }));

  const fire = (type: string, event: { key: string | null } = { key: null }) =>
    events.get(type)?.forEach((listener) => listener(event));

  vi.stubGlobal("window", {
    matchMedia: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_type: string, listener: () => void) => media.listeners.push(listener),
    }),
    localStorage: {
      getItem: (key: string) => {
        if (state.blocked) throw new Error("site data blocked");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (state.blocked) throw new Error("site data blocked");
        store.set(key, value);
      },
    },
    addEventListener: (type: string, listener: (event: { key: string | null }) => void) =>
      events.set(type, [...(events.get(type) ?? []), listener]),
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
    querySelectorAll: () =>
      themeColors.map((meta) => ({
        setAttribute: (_name: string, value: string) => (meta.content = value),
      })),
  });

  return {
    store,
    themeColors,
    dark: () => classes.has("dark"),
    attribute: (name: string) => attributes.get(name),
    osSwitches(dark: boolean) {
      media.matches = dark;
      media.listeners.forEach((listener) => listener());
    },
    /** Another tab wrote the key: `storage` fires here, never in the tab that wrote it. */
    otherTabPicks(value: string) {
      store.set(KEY, value);
      fire("storage", { key: KEY });
    },
    storageEvent: (key: string | null) => fire("storage", { key }),
    backForwardRestore: () => fire("pageshow"),
    block: () => (state.blocked = true),
    /** A page that forces light for its own lifetime, the way a public booking page does. */
    forceLight: () => classes.delete("dark"),
  };
}

const options: ThemeOptions = { key: KEY };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startTheme", () => {
  it("paints the stored choice the moment it starts", () => {
    const page = browser({ stored: "dark" });
    expect(startTheme(options).getSnapshot()).toEqual({ mode: "dark", resolved: "dark" });
    expect(page.dark()).toBe(true);
  });

  it("follows the OS while the choice is system, live — and only then", () => {
    const page = browser({ stored: "system", osDark: true });
    const theme = startTheme(options);
    expect(page.dark()).toBe(true);

    page.osSwitches(false);
    expect(theme.getSnapshot()).toEqual({ mode: "system", resolved: "light" });
    expect(page.dark()).toBe(false);

    theme.setMode("dark");
    page.osSwitches(false);
    expect(page.dark()).toBe(true);
  });

  // A choice made later in the same page must still follow the OS. A listener attached only
  // when the page started in "system" would miss every switch after that.
  it("follows the OS after switching to system mid-page", () => {
    const page = browser({ stored: "light" });
    const theme = startTheme(options);
    theme.setMode("system");
    page.osSwitches(true);
    expect(page.dark()).toBe(true);
  });

  it("reads an empty key, and one holding anything else, as the default", () => {
    browser({ stored: "blue" });
    expect(startTheme({ key: KEY, defaultMode: "dark" }).getSnapshot().mode).toBe("dark");
  });

  // The white page: storage throws on read, during the first render. The default has to apply,
  // following the OS like any other "system".
  it("starts on the default when storage is blocked, instead of throwing", () => {
    const page = browser({ blocked: true, osDark: true });
    expect(startTheme(options).getSnapshot()).toEqual({ mode: "system", resolved: "dark" });
    expect(page.dark()).toBe(true);
  });

  it("keeps a choice made under blocked storage when the page resyncs", () => {
    const page = browser({ blocked: true });
    const theme = startTheme(options);
    theme.setMode("dark");
    // A failed read says nothing about what was chosen, so it must not reset to the default.
    page.backForwardRestore();
    page.storageEvent(KEY);
    expect(theme.getSnapshot().mode).toBe("dark");
    expect(page.dark()).toBe(true);
  });

  it("repaints when another tab picks, and tells subscribers", () => {
    const page = browser({ stored: "light" });
    const theme = startTheme(options);
    const listener = vi.fn();
    theme.subscribe(listener);

    page.otherTabPicks("dark");
    expect(page.dark()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores another key, and resyncs when storage is cleared", () => {
    const page = browser({ stored: "dark" });
    const theme = startTheme(options);
    page.store.set(KEY, "light");
    page.storageEvent("some.other.key");
    expect(theme.getSnapshot().mode).toBe("dark");

    page.store.clear();
    page.storageEvent(null);
    expect(theme.getSnapshot().mode).toBe("system");
  });

  it("picks up a choice made while this page sat in the back-forward cache", () => {
    const page = browser({ stored: "light" });
    const theme = startTheme(options);
    page.store.set(KEY, "dark");
    page.backForwardRestore();
    expect(theme.getSnapshot().mode).toBe("dark");
  });

  // An empty key means the DEFAULT, and the default is not always "system". Clearing the key
  // for "system" in an app that defaults to dark would come back dark on the next visit.
  it("stores system as the word, so it survives a non-system default", () => {
    const page = browser();
    startTheme({ key: KEY, defaultMode: "dark" }).setMode("system");
    expect(page.store.get(KEY)).toBe("system");
  });

  it("still applies a choice when storage refuses to keep it", () => {
    const page = browser({ stored: "light" });
    const theme = startTheme(options);
    page.block();
    expect(() => theme.setMode("dark")).not.toThrow();
    expect(page.dark()).toBe(true);
  });

  it("ignores a mode it does not know, rather than storing it", () => {
    const page = browser({ stored: "light" });
    const theme = startTheme(options);
    const fromASelect: string = "blue";
    theme.setMode(fromASelect as "dark");
    expect(page.store.get(KEY)).toBe("light");
    expect(theme.getSnapshot().mode).toBe("light");
  });

  it("notifies only on a change, and stops after unsubscribing", () => {
    const page = browser({ stored: "dark" });
    const theme = startTheme(options);
    const listener = vi.fn();
    const unsubscribe = theme.subscribe(listener);

    theme.setMode("dark");
    page.osSwitches(true);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    theme.setMode("light");
    expect(listener).not.toHaveBeenCalled();
  });

  // `pageshow` fires on every load, not only on a back-forward restore, so a controller that
  // repainted on every resync would undo a page's override a moment after the page set it.
  it("writes to the page only when the theme changes, so a page can override it", () => {
    const page = browser({ stored: "dark" });
    const theme = startTheme(options);
    page.forceLight();

    page.backForwardRestore();
    page.storageEvent(KEY);
    page.osSwitches(true);
    theme.setMode("dark");
    expect(page.dark()).toBe(false);

    page.otherTabPicks("light");
    page.otherTabPicks("dark");
    expect(page.dark()).toBe(true);
  });

  it("writes data-theme both ways when asked to", () => {
    const page = browser({ stored: "dark" });
    const theme = startTheme({ key: KEY, attribute: "data-theme" });
    expect(page.attribute("data-theme")).toBe("dark");
    expect(page.dark()).toBe(false);
    theme.setMode("light");
    expect(page.attribute("data-theme")).toBe("light");
  });

  // Both tags, whatever their `media`: a query on the tag follows the OS, and the reader may have
  // picked the opposite of it.
  it("moves every theme-color tag with the theme", () => {
    const page = browser({ stored: "light", metas: 2 });
    const theme = startTheme({ key: KEY, themeColor: { light: "#fff", dark: "#111" } });
    expect(page.themeColors.map((meta) => meta.content)).toEqual(["#fff", "#fff"]);
    theme.setMode("dark");
    expect(page.themeColors.map((meta) => meta.content)).toEqual(["#111", "#111"]);
  });

  // Two controllers would both follow the OS, and the one that missed a `setMode` would repaint
  // its stale choice on the next switch.
  it("runs once per page — the pre-paint script's controller is the app's", () => {
    const page = browser({ stored: "light" });
    const prePaint = startTheme(options);
    const { setMode, getSnapshot } = createTheme(options);
    expect(startTheme(options)).toBe(prePaint);

    setMode("dark");
    page.osSwitches(false);
    expect(prePaint.getSnapshot().mode).toBe("dark");
    expect(getSnapshot().mode).toBe("dark");
    expect(page.dark()).toBe(true);
  });
});

describe("createTheme", () => {
  // A module that calls `createTheme` at its top level is imported by the prerender too, where
  // there is no window. Nothing may start until something asks.
  it("touches no browser global at creation, and prerenders the default", () => {
    const { useTheme, getSnapshot } = createTheme({ key: KEY, defaultMode: "dark" });
    expect(getSnapshot()).toEqual({ mode: "dark", resolved: "dark" });

    function Toggle() {
      const { mode, resolved } = useTheme();
      return createElement("span", null, `${mode}/${resolved}`);
    }
    expect(renderToString(createElement(Toggle))).toContain("dark/dark");
  });

  it("prerenders system as light, the same guess color-scheme makes", () => {
    expect(createTheme(options).getSnapshot()).toEqual({ mode: "system", resolved: "light" });
  });
});
