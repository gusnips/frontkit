/**
 * One page, as the markup that goes inside `<div id="root">`.
 *
 * This is the build-time half of `main.tsx`, and the app's `entry-server.tsx` is expected to
 * be four lines around it: the same `<App />` and the same route table the browser runs, with
 * a `StaticRouter` in place of the history the build does not have. `main.tsx` is deliberately
 * NOT reused — it reads `window.location`, registers listeners and starts analytics at module
 * scope, none of which mean anything here.
 *
 * No `node:` import: this file is bundled into the SSR build by Vite, and it is React's own
 * static renderer plus two string rules.
 */
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";

/**
 * React 19 hoists `<title>`, `<meta>` and `<link>` rendered anywhere in the tree into the
 * document head — and on the server it does that by emitting them at the FRONT of the stream,
 * for a caller that is expected to be assembling a whole document. We are not: we are filling
 * one `<div>`, so an in-tree SEO component's tags would land inside the body, where that markup
 * is invalid and duplicates the head the prerender bakes.
 *
 * They are dropped rather than lifted, because the page registry is the one source of that head
 * by contract and the baked copy is the half that exists before React runs. `<style>` and
 * `<script>` are deliberately NOT in this pattern: if one appears here it belongs to the page
 * and must survive.
 */
const HOISTED_HEAD = /^(?:<title>[^<]*<\/title>|<meta\b[^>]*\/?>|<link\b[^>]*\/?>|\s+)+/;

/**
 * Render a tree to markup with `prerender` from `react-dom/static`.
 *
 * **Never `renderToString`.** With `lazy()` routes behind a `<Suspense fallback={<Spinner />}>`,
 * `renderToString` renders the FALLBACK — it would write a loading screen into every file and
 * pass every gate that only asks whether the root has children. `prerender` waits for the tree
 * to settle, which is also why this is async and why the whole renderer contract is.
 *
 * Two more halves of the same lesson are here too: `onError` is captured and rethrown, so a
 * render failure fails the build rather than shipping a partial page; and an empty result is
 * refused, because a router whose basename does not match its location answers `""` with no
 * error and no warning.
 */
export async function renderTree(tree: ReactNode): Promise<string> {
  let failure: unknown;
  const { prelude } = await prerender(tree, {
    onError(error: unknown) {
      failure ??= error;
    },
  });
  const html = await new Response(prelude).text();
  if (failure !== undefined) throw failure;

  const markup = html.replace(HOISTED_HEAD, "");
  if (markup.trim() === "")
    throw new Error(
      "renderTree: the tree rendered to nothing — usually a router whose location or basename " +
        "matches no route, which React reports as an empty string rather than an error",
    );
  return markup;
}

/**
 * What an SSR entry exports, and what {@link loadRenderer} looks for.
 *
 * `context` is opaque on purpose. A multi-locale app builds its i18n instance per call — three
 * languages render in one process and a shared singleton would have them racing for one `lng` —
 * while a single-locale app ignores the argument and keeps its singleton.
 */
export type PageRenderer<Context = unknown> = (route: string, context?: Context) => Promise<string>;
