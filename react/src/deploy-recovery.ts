/**
 * Surviving a deploy that lands while a tab is open.
 *
 * Every app on this stack is a Vite SPA with `lazy()` routes, deployed on push. A build replaces
 * every hashed asset underneath whatever tabs are already open, and those tabs go on running
 * yesterday's bundle. It surfaces two ways, and only one of them looks like a missing file:
 *
 *   1. The next navigation asks for a chunk whose hashed name is gone. React's lazy boundary
 *      throws, and the person gets a white screen on a click that worked a minute ago.
 *   2. The old bundle reads a field the API has since renamed, and throws. That one arrives as a
 *      plain `TypeError` with nothing in it about a deploy — no file, no hash, no signal.
 *
 * So there are two detectors here and they are not interchangeable. {@link isChunkLoadError}
 * matches the message, which is all you have for a failure that never reaches a boundary.
 * {@link isStaleBuild} asks the server, which is evidence rather than a guess — and it is the
 * only one that catches case 2 at all.
 *
 * **The deepest fix is not in this file, and it is worth more than everything in it.** A static
 * host answers a missing `/assets/x.js` with the SPA fallback — `index.html`, at a 200, as
 * `text/html` — which is what the browser's "MIME type text/html" module-script refusal actually
 * is. Hosts then match cache rules against the REQUEST PATH rather than the outcome, so the
 * `immutable, max-age=31536000` rule written for hashed assets gets applied to that HTML body:
 * one poisoned asset URL, at the edge and in every browser that touched it, for a year. One
 * adopter removed the cause instead of recovering from it — no blanket fallback over `/assets/`,
 * and an edge function that refuses to answer an asset path with `text/html` — which turns a
 * dead chunk into a real, uncacheable 404 and lets everything below be recovery rather than the
 * plan. A package cannot ship that; it can refuse to let it go unwritten.
 */

/**
 * One stamp for every reason to reload, which is the part that is easy to get wrong.
 *
 * A tab can decide to reload because a chunk 404'd, because the server says it is running an old
 * build, or from a guard inlined in `index.html` that runs before any module does. That is three
 * detectors for ONE predicament, and giving each its own key hands a broken deploy three reloads
 * a minute to take turns with. The guard belongs to the tab, not to the reason.
 *
 * Exported because of the third caller: an inline `<script>` in `index.html` has to exist for the
 * case where the bundle holding this file is itself the missing asset, and it cannot import
 * anything. Copying the string is what it has to do; copying it from here is why the two agree.
 */
export const RELOAD_GUARD_KEY = "frontkit:reload-at";

const RELOAD_WINDOW_MS = 60_000;

/** Bounded: a crashed app already shows nothing, and a network that hangs rather than fails must
 *  land on the real error screen instead of an endless spinner. */
const PROBE_TIMEOUT_MS = 4_000;

/**
 * A lazy-chunk fetch failure — recoverable by reloading.
 *
 * Matched by message because no browser gives it a shared type. Every phrasing in the wild is
 * here: Chrome/Edge "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", Safari "Importing a module script failed", webpack's
 * ChunkLoadError and "Loading chunk N failed", and the SPA-fallback "MIME type" refusal —
 * which is the one that fires on a static host that has not fixed the cause above, because the
 * missing `.js` is answered with `index.html`.
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
 * The entry script this document loaded, as a path.
 *
 * Read from the DOM rather than from `import.meta.url`, so it stays the ENTRY even if this module
 * is later code-split into some other chunk — and so `vite dev`, which names `/src/main.tsx`,
 * compares like with like and never reports a real crash as an update.
 *
 * A path, compared as a plain substring, rather than the raw attribute matched as `src="…"`. The
 * two donors split on exactly this and the anchored form is the more precise one — which is also
 * why it is the one that breaks if anything between the build and the browser rewrites the
 * markup, where a minifier changing quote style is enough. A missed match resolves to "not
 * stale", which shows the real error, and that is the direction this whole function is built to
 * fail in.
 */
function runningEntry(): string {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return el ? new URL(el.src, window.location.href).pathname : "";
}

/**
 * Is the build this tab is running still the one being served?
 *
 * Asked of the server, so the answer is evidence rather than a guess. Everything ambiguous —
 * offline, a non-200, a captive portal, a probe that times out — resolves to `false`: dressing a
 * genuine bug up as an update hides it from the user and from us.
 *
 * It asks for the PAGE, not for the asset, and that is not the obvious choice. A missing asset
 * looks like the direct question, but a CDN commonly serves assets with a long `s-maxage`, so a
 * bundle a deploy retired an hour ago still answers 200 from the edge — it would report "current"
 * during exactly the window when skew is most likely. The page is the one URL that cannot lie: it
 * ships `max-age=0, must-revalidate` and never enters the edge cache.
 */
export async function isStaleBuild(): Promise<boolean> {
  const running = runningEntry();
  if (!running) return false;
  try {
    const res = await fetch("/", {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    return !(await res.text()).includes(running);
  } catch {
    return false;
  }
}

/**
 * Hard-reload once to pick up the fresh deploy. Returns false when the guard suppressed it,
 * which is the caller's cue that reloading did not fix it and the person needs the real error UI
 * rather than watching the same attempt loop.
 *
 * The guard is the part that matters. Reloading on a failure is obvious; reloading on a failure
 * that the reload does not fix is an infinite loop with the user inside it. At most one reload
 * per minute, so a genuinely broken deploy degrades to the error screen — which can at least say
 * something — instead of flickering forever.
 *
 * `sessionStorage` and not `localStorage`: the guard is about this tab's current predicament, and
 * a stale stamp in another tab must not suppress a reload this one needs. Wrapped because storage
 * throws outright when site data is blocked, and a privacy setting must not be the reason
 * somebody cannot recover.
 */
export function reloadOnce(): boolean {
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
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
