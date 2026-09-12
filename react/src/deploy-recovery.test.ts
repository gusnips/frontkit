import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isChunkLoadError,
  isPreloadHintFailure,
  isStaleBuild,
  RELOAD_GUARD_KEY,
  reloadOnce,
} from "./deploy-recovery.ts";

const ORIGIN = "https://app.example.com";

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
    // The one that fires on a static host that still answers a missing asset with its SPA
    // fallback: the browser refuses the HTML rather than reporting a 404.
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
 * Two globals, stubbed rather than run under a DOM: `window`, `document`, `sessionStorage` and
 * `fetch` are the only ones this module touches, and adding jsdom to a package whose whole point
 * is a small dependency list would cost more than it explains.
 */
const reload = vi.fn();
let store: Record<string, string> = {};
/** Throws from both methods, the way a browser does when site data is blocked. */
let blocked = false;

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockClear();
  store = {};
  blocked = false;
  vi.stubGlobal("window", { location: { reload, href: `${ORIGIN}/w/anyone` } });
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

/**
 * The detector that reads evidence instead of a message. It is the only one that catches a crash
 * carrying no signal — the old bundle meeting a renamed API field — so every ambiguous answer
 * has to resolve to "not stale", or a real bug gets dressed up as an update and hidden.
 */
describe("isStaleBuild", () => {
  // What a static host actually serves for `/`: Vite's built page names the entry with double
  // quotes and a crossorigin attribute, and `vite dev` names the source module.
  const BUILT = (hash: string) =>
    `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-${hash}.js"></script></head><body><div id="root"></div></body></html>`;
  const DEV = `<!doctype html><html><head><script type="module" src="/src/main.tsx"></script></head><body></body></html>`;

  /** Point this document at one entry script and the server at a page naming another. */
  function serving(page: string, entry: string | null): void {
    vi.stubGlobal("document", {
      querySelector: () => (entry === null ? null : { src: `${ORIGIN}${entry}` }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(page, { status: 200 })));
  }

  it("asks the page, never the cache — a cached copy would hide the deploy", async () => {
    serving(BUILT("AAA"), "/assets/index-AAA.js");
    await isStaleBuild();
    expect(fetch).toHaveBeenCalledWith("/", expect.objectContaining({ cache: "no-store" }));
  });

  it("is stale when the live page has moved to a different bundle", async () => {
    serving(BUILT("NEW222"), "/assets/index-OLD111.js");
    await expect(isStaleBuild()).resolves.toBe(true);
  });

  it("is not stale while the live page still names this bundle", async () => {
    serving(BUILT("SAME33"), "/assets/index-SAME33.js");
    await expect(isStaleBuild()).resolves.toBe(false);
  });

  // The reason this compares a PATH as a substring rather than matching `src="…"` exactly. The
  // anchored form is more precise and breaks the moment anything rewrites the markup between the
  // build and the browser — and breaking here would report a healthy tab as stale, which is a
  // reload the user did not need and cannot refuse.
  it("survives a host that rewrites the markup on the way out", async () => {
    serving(
      `<!doctype html><html><head><script type=module src='/assets/index-AAA.js'></script></head></html>`,
      "/assets/index-AAA.js",
    );
    await expect(isStaleBuild()).resolves.toBe(false);
  });

  it("is never stale under `vite dev`, where a crash is always a real one", async () => {
    serving(DEV, "/src/main.tsx");
    await expect(isStaleBuild()).resolves.toBe(false);
  });

  it("does not guess when the document has no entry script to compare", async () => {
    serving(BUILT("AAA"), null);
    await expect(isStaleBuild()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call a bad response from the host a deploy", async () => {
    serving(BUILT("AAA"), "/assets/index-AAA.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    await expect(isStaleBuild()).resolves.toBe(false);
  });

  it.each([
    ["being offline", new TypeError("Failed to fetch")],
    ["a network that hangs until the probe gives up", new DOMException("Timeout", "TimeoutError")],
  ])("does not call %s a deploy", async (_label, thrown) => {
    serving(BUILT("AAA"), "/assets/index-AAA.js");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(thrown));
    await expect(isStaleBuild()).resolves.toBe(false);
  });
});

/**
 * The guard, which is the whole reason this function exists rather than a bare
 * `location.reload()` at the call site. Reloading on a failure the reload does not fix is an
 * infinite loop with a person inside it, and it only reproduces on a real broken deploy — so
 * this is the only place the rule gets checked.
 */
describe("reloadOnce", () => {
  it("reloads on the first attempt and stamps the shared guard", () => {
    expect(reloadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store[RELOAD_GUARD_KEY]).toBe(String(Date.now()));
  });

  it("refuses a second reload inside the window, so a broken deploy cannot loop", () => {
    expect(reloadOnce()).toBe(true);
    expect(reloadOnce()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows another one after the window, because the next deploy is a new problem", () => {
    expect(reloadOnce()).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    expect(reloadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("still reloads when storage is blocked — a privacy setting is not a reason to strand", () => {
    blocked = true;
    expect(reloadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // The bug this key was renamed to prevent. An inline guard in index.html cannot import
  // anything, so it copies the string — and the moment the two names drift, a broken deploy gets
  // two reloads a minute instead of one, each path politely resetting the other's clock.
  it("exports the one key an inline guard has to share", () => {
    expect(RELOAD_GUARD_KEY).toBe("frontkit:reload-at");
    reloadOnce();
    expect(Object.keys(store)).toEqual([RELOAD_GUARD_KEY]);
  });
});
