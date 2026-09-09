/**
 * The browser half of prerendering: deciding whether to hydrate or to mount fresh.
 *
 * Three separate repos invented all of this independently — same constant name, same string
 * value, same decision, and near-identical explaining comments. That is not a coincidence worth
 * deduping; it is one lesson learned three times, and it belongs somewhere it can be learned
 * once.
 *
 * The constants themselves live in `prerender-contract.ts`, which imports nothing, because the
 * BUILD needs them too and must not pull `react-dom/client` into a Node process to get a string.
 *
 * This module sits behind `@gusnips/react/hydrate` rather than in the barrel for the same reason
 * one rung further out: it is the package's ONLY `react-dom` import, and a React Native app has
 * no react-dom to give. Leaving it in the barrel made `react-dom` a required peer and shut the
 * whole package out of every phone — for one function a phone would never call.
 */
import type { ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { PRERENDERED_ROUTE_ATTR } from "./prerender-contract.ts";

export { PRERENDERED_ROUTE_ATTR, SHELL_ROUTE } from "./prerender-contract.ts";

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
