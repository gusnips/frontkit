/**
 * The browser half of prerendering: deciding whether to hydrate or to mount fresh.
 *
 * This lives in `react/` and not in `vite/` even though `vite/` writes the attribute, because
 * a BROWSER ENTRY reads it. Putting the constant in the build-time package would drag `node:`
 * into the client bundle for the sake of one string. Build-time depends on runtime; never the
 * reverse.
 *
 * Three separate repos invented all of this independently — same constant name, same string
 * value, same decision, and near-identical explaining comments. That is not a coincidence
 * worth deduping; it is one lesson learned three times, and it belongs somewhere it can be
 * learned once.
 */
import type { ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

/**
 * The attribute a prerendered file names its own route in — written by the build, read here.
 *
 * One constant because the writer and the reader are in different builds, and a typo between
 * them would show up only as a silent full re-render.
 */
export const PRERENDERED_ROUTE_ATTR = "data-prerendered-route";

/**
 * What a 404 shell writes instead of a route.
 *
 * It is the pattern that actually matched — the catch-all — and it can never equal an address,
 * which is the property that matters: every route a static host answers from the shell mounts
 * fresh rather than hydrating the not-found page over itself. A real 404 pays one redundant
 * client render for that, and keeps the markup a crawler reads.
 */
export const SHELL_ROUTE = "*";

/**
 * Hydrate the render this file IS, and mount fresh over anything else.
 *
 * "Does the root have children" is the wrong question, and getting it wrong is silent. A static
 * host answers every address it does not publish with the nearest `404.html` — and that file has
 * the not-found page rendered INTO it — so an address served from a shell arrives at a full root
 * holding somebody else's markup. Hydrating that is React reconciling two different pages: it
 * recovers by throwing the whole tree away and says so in the console, which is a page that
 * works and a bug nobody sees. The file names the route it is a render of, so we can simply ask.
 *
 * `route` is passed in rather than read from `window.location` on purpose. A localized app
 * serves `/pt/pricing` from a file rendered for `/pricing`, with the locale carried in the
 * router's `basename` — so the address and the route are different strings, and only the caller
 * knows which one the build wrote.
 */
export function hydrateOrMount(rootEl: Element, tree: ReactNode, route: string): void {
  if (rootEl.getAttribute(PRERENDERED_ROUTE_ATTR) === route) hydrateRoot(rootEl, tree);
  else createRoot(rootEl).render(tree);
}
