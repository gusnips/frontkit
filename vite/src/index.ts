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
 * The vite config preset lives at `@gusnips/vite/preset`, so a prerender script does not load
 * the React and Tailwind plugins to bake one `<head>`.
 */
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
export { renderTree, type PageRenderer } from "./render.ts";
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
