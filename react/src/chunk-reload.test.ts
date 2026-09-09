import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, isPreloadHintFailure, reloadOnceForChunkError } from "./chunk-reload.ts";

// No browser gives a failed dynamic import a shared type, so this is matched by message and
// every phrasing has to be here. A miss is a white screen after a deploy — the exact failure
// this module exists to catch — and it only reproduces on a real deploy, so the test is the
// only place these strings get checked.
describe("isChunkLoadError", () => {
  it.each([
    ["Chrome/Edge", "Failed to fetch dynamically imported module: https://x/assets/a.js"],
    ["Firefox", "error loading dynamically imported module"],
    ["Safari", "Importing a module script failed."],
    ["webpack", "Loading chunk 42 failed."],
    // The one that actually fires on a static host: the missing .js is answered with the SPA
    // fallback, so the browser refuses the HTML rather than reporting a 404.
    [
      "SPA fallback",
      "Expected a JavaScript module script but the server responded with a MIME type of text/html",
    ],
  ])("matches %s", (_browser, message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it("matches a named ChunkLoadError whatever its message", () => {
    const error = new Error("nothing recognisable");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("does not match an ordinary render error", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    // A thrown string reaches the `String(error)` branch, which is the one a non-Error throw
    // takes — and the one that would blow up if it were written `error.message`.
    expect(isChunkLoadError("something failed")).toBe(false);
  });
});

// The distinction that matters: swallowing a real module failure resolves the import with
// `undefined`, React.lazy reads `.default` off nothing, and the developer gets a TypeError with
// only React frames in it — naming no chunk. Only the CSS hint is safe to swallow.
describe("isPreloadHintFailure", () => {
  it("matches Vite's CSS preload hint and nothing else", () => {
    expect(isPreloadHintFailure(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    expect(isPreloadHintFailure(new Error("Failed to fetch dynamically imported module"))).toBe(
      false,
    );
  });
});

/**
 * The guard, which is the whole reason this function exists rather than a bare
 * `location.reload()` at the call site. Reloading on a chunk error the reload does not fix is
 * an infinite loop with a person inside it, and it only reproduces on a real broken deploy —
 * so this is the only place the rule gets checked.
 *
 * Two globals, stubbed rather than run under a DOM: `window` and `sessionStorage` are the only
 * ones this module touches, and adding jsdom to a package whose whole point is a small
 * dependency list would cost more than it explains.
 */
describe("reloadOnceForChunkError", () => {
  const reload = vi.fn();
  let store: Record<string, string> = {};
  /** Throws from both methods, the way a browser does when site data is blocked. */
  let blocked = false;

  beforeEach(() => {
    vi.useFakeTimers();
    reload.mockClear();
    store = {};
    blocked = false;
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string): string | null => {
        if (blocked) throw new Error("site data blocked");
        return store[key] ?? null;
      },
      setItem: (key: string, value: string): void => {
        if (blocked) throw new Error("site data blocked");
        store[key] = value;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reloads on the first chunk failure", () => {
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("refuses a second reload inside the window, so a dead chunk cannot loop", () => {
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadOnceForChunkError()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows another one after the window, because the next deploy is a new problem", () => {
    expect(reloadOnceForChunkError()).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("still reloads when storage is blocked — a privacy setting is not a reason to strand", () => {
    blocked = true;
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
