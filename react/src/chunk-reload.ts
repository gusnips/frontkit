/**
 * Surviving a deploy that lands while a tab is open.
 *
 * Every app on this stack is a Vite SPA with `lazy()` routes, deployed on push. When a build
 * replaces the one a tab is running, the next navigation asks for a chunk whose hashed name no
 * longer exists — and a static host answers a missing asset with the SPA fallback, so the
 * import gets HTML where it expected a module. React's lazy boundary throws, and the person
 * gets a white screen on a click that worked a minute ago.
 *
 * One repo in the fleet had all of this. The others had none of it, and none of them knew.
 */

const RELOAD_FLAG_KEY = "frontkit:chunk-reload-at";
const RELOAD_WINDOW_MS = 60_000;

/**
 * A lazy-chunk fetch failure — recoverable by reloading.
 *
 * Matched by message because no browser gives it a shared type. Every phrasing in the wild is
 * here: Chrome/Edge "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", Safari "Importing a module script failed", webpack's
 * ChunkLoadError and "Loading chunk N failed", and the SPA-fallback "MIME type" refusal —
 * which is the one that actually fires on a static host, because the missing `.js` is answered
 * with `index.html`.
 *
 * A standalone predicate rather than a method on the boundary, so a global `unhandledrejection`
 * handler can classify the same failure without importing a component.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (error instanceof Error && error.name === "ChunkLoadError") return true;
  const message = (error instanceof Error ? error.message : String(error) || "").toLowerCase();
  return (
    message.includes("dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("mime type") ||
    message.includes("loading chunk")
  );
}

/**
 * Hard-reload once to pick up the fresh deploy. Returns false when the guard suppressed it.
 *
 * The guard is the part that matters. Reloading on a chunk error is obvious; reloading on a
 * chunk error that the reload does not fix is an infinite loop with the user inside it. At most
 * one reload per minute, so a genuinely missing chunk degrades to the error UI — which can at
 * least say something — instead of flickering forever.
 *
 * `sessionStorage` and not `localStorage`: the guard is about this tab's current predicament,
 * and a stale flag in another tab must not suppress a reload this one needs. Wrapped because
 * storage throws outright when site data is blocked, and a privacy setting must not be the
 * reason somebody cannot recover.
 */
export function reloadOnceForChunkError(): boolean {
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) ?? 0);
    if (now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_FLAG_KEY, String(now));
  } catch {
    // Storage blocked — proceed with the reload rather than refusing to recover.
  }
  window.location.reload();
  return true;
}

/**
 * Vite's *hint* failure, which is not the same thing and must not be treated as one.
 *
 * Vite injects a speculative `<link rel="stylesheet">` for a chunk's CSS before importing it.
 * When that link fails, the import itself still runs right after and usually succeeds — so this
 * one is worth swallowing, where a failure of the import is the real thing
 * {@link isChunkLoadError} matches. Vite builds this message in exactly one place and only ever
 * for a stylesheet link; script hints never reject.
 */
export function isPreloadHintFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Unable to preload CSS for");
}

/**
 * Install the `vite:preloadError` listener. Call once, from the browser entry.
 *
 * Vite offers `preventDefault()` here so an app can own a failed asset itself — but taking that
 * deal unconditionally resolves the dynamic import with `undefined` (Vite's helper ends in
 * `baseModule().catch(handlePreloadError)`), and `React.lazy` then reads `.default` off nothing.
 * The user gets the crash screen and the developer gets a TypeError with only React frames in
 * it, naming no chunk. So it is taken ONLY for a failed preload hint, where the import still
 * runs. A real module failure is left to throw, where the error boundary can recognise it.
 */
export function installPreloadErrorHandler(): void {
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (isPreloadHintFailure(payload)) event.preventDefault();
  });
}
