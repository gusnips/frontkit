import { describe, expect, it } from "vitest";
import { isChunkLoadError, isPreloadHintFailure } from "./chunk-reload.ts";

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
