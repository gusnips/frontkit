/**
 * The build-time half of a prerendered Vite + React SPA.
 *
 * A Vite SPA ships one `index.html` and draws the rest with JavaScript. Nothing that reads a
 * link for a living runs that bundle — not a search crawler, not an LLM, not the thing that
 * draws the preview card in a chat app. So the build renders every public route to a real file
 * with a real `<head>` and a real body, and this is the part every app doing that shares.
 *
 * Four repos wrote it independently and each learned something the others had not. What is
 * here is the merge; every non-obvious rule carries the reason it exists.
 *
 * Two things live behind their own subpath, because each drags a dependency this barrel would
 * otherwise force on everyone: the vite config preset at `@gusnips/vite/preset` (the React and
 * Tailwind plugins) and `renderTree` at `@gusnips/vite/render` (React itself). Nothing here
 * imports React or vite, so a prerender script, an OG generator and a repo that only wants a
 * sitemap all install exactly what they use.
 */
export { resolveKey } from "./catalog.ts";
export {
  assertRendered,
  bakeHead,
  EMPTY_ROOT,
  ogLocale,
  type Alternate,
  type HeadTags,
  type RenderedChecks,
} from "./head.ts";
export {
  loadRenderer,
  loadTemplate,
  writeDist,
  writeOgCards,
  type OgCard,
  type WriteOgCardsOptions,
} from "./node.ts";
export {
  describeOverflow,
  fitText,
  OG_CANVAS,
  type FitOptions,
  type FitResult,
  type OgOverflow,
} from "./og.ts";
// `renderTree` itself is NOT here — it lives at `@gusnips/vite/render`, because it is the one
// thing in this package that loads React. Its consumer is `entry-server.tsx`, a different file
// in a different bundle to the prerender script, and a repo using this only for `sitemapXml`
// and `robotsTxt` should not have to install a renderer. The TYPE is free: it erases.
export type { PageRenderer } from "./render.ts";
export {
  ogImagePath,
  pageFile,
  pageSlug,
  robotsTxt,
  siteOrigin,
  sitemapFor,
  sitemapXml,
  type PublicPage,
  type RobotsOptions,
  type SitemapEntry,
} from "./sitemap.ts";
