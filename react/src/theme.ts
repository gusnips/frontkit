/**
 * Light, dark, or whatever the operating system says — chosen once, remembered, and painted
 * before the first frame.
 *
 * Nearly every app in the fleet had written this on its own, and each copy knew something the
 * others did not. What they got wrong is the design brief for this file:
 *
 * - **Storage is read unguarded.** A browser that blocks site data throws on `localStorage`
 *   itself, and the read ran during a render, so a privacy setting was a white page. Apps fixed
 *   this one at a time, and the last copy still had it.
 * - **The pre-paint script and the runtime disagreed.** Most apps kept two copies of "read the
 *   key, resolve system, set the class": an inline script in `index.html`, because it has to run
 *   before any module loads, and the store the app renders from. They drifted on exactly the
 *   inputs nobody tests. With storage blocked one forced light while the other followed the OS,
 *   and with a stale value in the key one read it as light while the other read it as system.
 *   Either way the page painted one theme, and React swapped it for the other one frame later.
 *   One app had written a build check that the two copies at least named the same key.
 * - **The OS preference started as a guess.** A provider that holds the OS preference in state,
 *   starting at `"light"` and correcting it in an effect, commits a light frame first. That
 *   frame REMOVES the `.dark` class the pre-paint script had just set, so a reader whose OS is
 *   dark sees a flash on every load.
 * - **The pre-paint script was inline, and a strict CSP blocks inline scripts.** Under
 *   `script-src 'self'` it never ran in production: the app booted light and turned dark a frame
 *   later. A CSP hash works until the first whitespace change silently breaks it again.
 * - **Another tab's choice was ignored.** A tab left open kept the old theme until it reloaded.
 *   One app did listen for `storage`, then re-read its own page, which the other tab had not
 *   changed.
 *
 * So there is ONE function, {@link startTheme}. The page runs it before first paint and the app
 * uses it after React mounts. `@gusnips/vite/theme` serves it as a same-origin FILE, built from
 * this function's own source, so the two cannot drift and a strict CSP allows it. The runtime
 * the pre-paint script creates is also the one the app talks to: {@link createTheme} finds it
 * rather than starting a second one.
 *
 * What stays in the app: the control (three buttons, a menu, a switch) and its words.
 */
import { useSyncExternalStore } from "react";

/** What a person picked. `"system"` means "follow the operating system", live. */
export type ThemeMode = "light" | "dark" | "system";

/** What is on screen right now. */
export type ResolvedTheme = "light" | "dark";

export interface ThemeOptions {
  /**
   * The `localStorage` key holding the choice. Keep the key your app already uses: a new key
   * resets everybody's choice once.
   */
  key: string;
  /**
   * What an empty, unreadable or unrecognised key means. Defaults to `"system"`.
   */
  defaultMode?: ThemeMode;
  /**
   * Where the resolved theme goes on `<html>`. `"class"` toggles `dark`, which is what
   * Tailwind's `dark:` variant and `@gusnips/tokens` read. `"data-theme"` writes `"light"` or
   * `"dark"` into that attribute, for a stylesheet whose `@custom-variant` reads it. Defaults
   * to `"class"`.
   */
  attribute?: "class" | "data-theme";
  /**
   * The browser toolbar colour for each theme, written to every `<meta name="theme-color">`.
   * Leave it out and the tags are not touched. It is needed whenever the choice can differ from
   * the OS setting: a `media` query on the tag follows the OS, not your app.
   */
  themeColor?: Readonly<Record<ResolvedTheme, string>>;
}

export interface ThemeSnapshot {
  readonly mode: ThemeMode;
  readonly resolved: ResolvedTheme;
}

export interface ThemeController {
  getSnapshot(): ThemeSnapshot;
  /** Applies at once, and is remembered when storage allows it. */
  setMode(mode: ThemeMode): void;
  subscribe(listener: () => void): () => void;
}

declare global {
  interface Window {
    /** The page's one theme controller. See {@link startTheme}. */
    __frontkitTheme?: ThemeController;
  }
}

/**
 * Reads the choice, paints it, and keeps it painted: when the OS switches (a laptop that goes
 * dark at sunset), when another tab picks a theme, and when the page comes back from the
 * back-forward cache.
 *
 * **This function is serialized.** `@gusnips/vite/theme` writes `startTheme.toString()` into the
 * pre-paint file, so it must not reference anything outside its own body: no imports, no helpers
 * or constants from this module. It would still pass here and throw a `ReferenceError` in that
 * file, before first paint. The vite package's test runs the serialized copy in a bare context
 * to catch that. Comments go up here rather than in the body, because the body ships.
 *
 * **One per page.** The first call stores the controller on `window` and later calls return it,
 * whatever options they pass. Two would both follow the OS, and the one that missed a `setMode`
 * would repaint its stale choice on the next change. So the pre-paint script and the app must
 * pass the same options, which is easiest when both import them from one module.
 *
 * **Blocked storage is not an empty key.** When storage throws, the default applies at boot, and
 * a choice made afterwards lasts until the page is left. A resync never replaces that choice
 * with the default, because a read that failed says nothing about what was chosen.
 *
 * "system" is stored as the word, not as an empty key. An empty key means the default, and the
 * default is not always "system".
 */
export function startTheme(options: ThemeOptions): ThemeController {
  const running = window.__frontkitTheme;
  if (running) return running;

  const { key, defaultMode = "system", attribute = "class", themeColor } = options;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set<() => void>();
  const isMode = (value: unknown): value is ThemeMode =>
    value === "light" || value === "dark" || value === "system";
  const read = (): ThemeMode | undefined => {
    try {
      const stored = window.localStorage.getItem(key);
      return isMode(stored) ? stored : defaultMode;
    } catch {
      return undefined;
    }
  };
  const resolve = (mode: ThemeMode): ResolvedTheme =>
    mode === "system" ? (media.matches ? "dark" : "light") : mode;
  const paint = (resolved: ResolvedTheme) => {
    const root = document.documentElement;
    if (attribute === "class") root.classList.toggle("dark", resolved === "dark");
    else root.setAttribute(attribute, resolved);
    if (themeColor)
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute("content", themeColor[resolved]));
  };

  const initial = read() ?? defaultMode;
  let snapshot: ThemeSnapshot = { mode: initial, resolved: resolve(initial) };
  const apply = (mode: ThemeMode) => {
    const resolved = resolve(mode);
    paint(resolved);
    if (mode === snapshot.mode && resolved === snapshot.resolved) return;
    snapshot = { mode, resolved };
    listeners.forEach((listener) => listener());
  };
  const sync = () => {
    const stored = read();
    if (stored) apply(stored);
  };

  paint(snapshot.resolved);
  media.addEventListener("change", () => apply(snapshot.mode));
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) sync();
  });
  window.addEventListener("pageshow", sync);

  const controller: ThemeController = {
    getSnapshot: () => snapshot,
    setMode(mode) {
      if (!isMode(mode)) return;
      try {
        window.localStorage.setItem(key, mode);
      } catch {
        // Blocked: the choice lasts until the page is left.
      }
      apply(mode);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  window.__frontkitTheme = controller;
  return controller;
}

export interface Theme {
  /** The choice and what it resolves to, re-rendering when either changes. */
  useTheme(): ThemeSnapshot & { setMode(mode: ThemeMode): void };
  /** For code outside React: a keyboard shortcut, a command palette. Browser only. */
  setMode(mode: ThemeMode): void;
  /** For code outside React. Answers the prerender snapshot where there is no window. */
  getSnapshot(): ThemeSnapshot;
}

/**
 * The React side of {@link startTheme}. Nothing starts at import, so a module calling this at
 * its top level is safe to prerender. The controller starts on first use, or is found if the
 * pre-paint script already started it.
 *
 * During a prerender, and while hydrating, `useTheme` answers the default. `"system"` cannot be
 * resolved without a window, so it reads as light, as `color-scheme` does before the pre-paint
 * script runs. React then re-renders with the real snapshot, so a toggle hydrates cleanly and
 * shows the right choice a frame later instead of failing to hydrate.
 */
export function createTheme(options: ThemeOptions): Theme {
  const defaultMode = options.defaultMode ?? "system";
  const serverSnapshot: ThemeSnapshot = {
    mode: defaultMode,
    resolved: defaultMode === "dark" ? "dark" : "light",
  };
  const subscribe = (listener: () => void) => startTheme(options).subscribe(listener);
  const getSnapshot = () =>
    typeof window === "undefined" ? serverSnapshot : startTheme(options).getSnapshot();
  const getServerSnapshot = () => serverSnapshot;
  const setMode = (mode: ThemeMode) => startTheme(options).setMode(mode);

  function useTheme() {
    return { ...useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), setMode };
  }

  return { useTheme, setMode, getSnapshot };
}
