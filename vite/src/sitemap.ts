/**
 * The three build outputs that are addresses rather than pages: where a rendered page lands,
 * `sitemap.xml`, and `robots.txt`.
 *
 * Pure string work, like `head.ts` — no `node:` import, so every rule here is unit-testable.
 */
import { escapeAttr } from "./escape.ts";
// Type-only, so this file carries no runtime dependency on the head baker: a sitemap alternate
// and an `hreflang` link are the same claim, stated in two places a crawler reads separately.
import type { Alternate } from "./head.ts";

/**
 * Where a rendered page lands.
 *
 * FLAT (`pricing.html`), not directory-style (`pricing/index.html`). Cloudflare Pages serves
 * the directory form at `/pricing/` and answers `/pricing` with a 308 to it — so every address
 * the app advertises in its canonical and its sitemap would be a redirect rather than a page.
 * A flat file answers `/pricing` — the address the canonical and the sitemap name — with a 200,
 * and normalizes `/pricing/` to it with a 308.
 *
 * This said "200 either way" until somebody measured it. On a live Pages deployment `/precos/`
 * answers `308` with `location: /precos`, which then answers 200. The rule is untouched by that
 * — the ADVERTISED form is the one that must be a page, and it is — but the parenthetical was
 * inherited from a donor comment and repeated into an adopter's commit message as a live bug
 * before anyone checked. It also has a consequence worth knowing: on a host that normalizes,
 * `hydrateOrMount`'s slash tolerance can never fire, because the browser is redirected before it
 * runs. That tolerance earns its place on hosts that serve both forms, not on this one.
 *
 * That is Cloudflare Pages, not every host. Firebase Hosting serves the directory form at
 * `/pricing` itself with `trailingSlash: false`, and an adopter there names its own files. What
 * holds on every host is the rule underneath: an advertised address answers 200.
 *
 * A nested route keeps its folders: `/guides/errors` → `guides/errors.html`.
 */
export function pageFile(routePath: string): string {
  const trimmed = routePath.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "index.html" : `${trimmed}.html`;
}

/**
 * The origin every canonical, share URL and sitemap entry is built on.
 *
 * The trailing slash is dropped because the caller appends a path that starts with one, and
 * `https://example.com//pricing` is a different address to every crawler that reads it. The
 * scheme is demanded because the value normally comes from an env var: `VITE_SITE_URL=acme.com`
 * looks right in a `.env`, and it silently turns every canonical on the site into a relative
 * URL. That is a bad build, not a bad page, so it fails here.
 */
export function siteOrigin(url: string): string {
  if (!/^https?:\/\/[^/]+/.test(url))
    throw new Error(
      `prerender: "${url}" is not an absolute origin — it needs a scheme, as in https://example.com`,
    );
  return url.replace(/\/+$/, "");
}

/**
 * The three things about a public page that do not translate: where it is, how often it
 * changes, and how it ranks against its siblings.
 *
 * A product's registry extends this with its own copy fields — one donor names an i18n key per
 * page, another keys its locale catalogs by `pageSlug` and stores no copy here at all. Where
 * the copy lives is the product's call. These three are what a sitemap needs from every one of
 * them, and the registry is the single source the prerender, the sitemap and the share cards
 * all walk, so a page can never be in one and missing from another.
 */
export interface PublicPage {
  path: string;
  /** Relative crawl priority, 0.0–1.0. */
  priority: number;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
}

/** URL slug for a page path (`/pricing` → `pricing`, `/` → `home`), used to name its share
 *  card and to key a locale catalog's copy. */
export function pageSlug(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "home" : trimmed.replaceAll("/", "-");
}

/** Public path of a page's generated share card (`/pricing` → `/og/pricing.png`). */
export function ogImagePath(path: string): string {
  return `/og/${pageSlug(path)}.png`;
}

export interface SitemapEntry {
  loc: string;
  changefreq: string;
  /** Already formatted — an app ranks its own pages, and that rule does not belong here. */
  priority: string;
  /** `YYYY-MM-DD`. The one hint in a sitemap Google actually reads. One date for the whole
   *  build is the honest answer: these pages ship together. */
  lastmod?: string;
  /** The same reciprocal set the page's `<head>` carries. Stated twice on purpose: a crawler
   *  that reaches an address through the sitemap has not read the head yet. */
  alternates?: readonly Alternate[];
}

/** `sitemap.xml`, from whichever registry the caller walks. */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const links = (entry.alternates ?? []).map(
        (alt) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeAttr(alt.hreflang)}" href="${escapeAttr(alt.href)}" />\n`,
      );
      return (
        `  <url>\n` +
        // Escaped like every other URL here: a query string with an `&` in it is not valid XML,
        // and an invalid sitemap is rejected whole rather than per entry.
        `    <loc>${escapeAttr(entry.loc)}</loc>\n` +
        links.join("") +
        (entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>\n` : "") +
        `    <changefreq>${entry.changefreq}</changefreq>\n` +
        `    <priority>${entry.priority}</priority>\n` +
        `  </url>`
      );
    })
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` +
    ` xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`
  );
}

/**
 * `sitemap.xml` for a single-language site, straight from the registry — the common case, and
 * the reason a registry exists: the sitemap can never drift from the routes the app serves.
 *
 * A localized site walks its own locales and calls {@link sitemapXml}, because only it knows
 * how an address carries a language.
 */
export function sitemapFor(origin: string, pages: readonly PublicPage[], lastmod?: string): string {
  const root = siteOrigin(origin);
  return sitemapXml(
    pages.map((page) => ({
      loc: `${root}${page.path}`,
      changefreq: page.changeFrequency,
      // One decimal, always. `<priority>` is a number a crawler compares, and floating-point
      // noise from a computed rank would print as `0.7000000000000001`.
      priority: page.priority.toFixed(1),
      ...(lastmod !== undefined && { lastmod }),
    })),
  );
}

export interface RobotsOptions {
  /** The origin this file is served from. Every sitemap path is resolved against it, so the
   *  file can never advertise a host it is not on — a mistake one donor is still shipping,
   *  where a static `robots.txt` and the build's fallback name different domains. */
  origin: string;
  /** Every sitemap on this ORIGIN, as paths (`/sitemap.xml`, `/docs/sitemap.xml`).
   *
   *  A crawler reads only the robots.txt at the origin root. An app served from a
   *  subdirectory therefore cannot ship its own — the one file at the root has to list its
   *  sitemap too, or nothing ever finds it. */
  sitemaps: readonly string[];
  /** Paths to keep out of every index. A page nobody should be able to find by searching —
   *  a per-request status page, an unsubscribe link — belongs here AND in `noindex`. */
  disallow?: readonly string[];
}

export function robotsTxt({ origin, sitemaps, disallow = [] }: RobotsOptions): string {
  const root = siteOrigin(origin);
  return (
    `User-agent: *\nAllow: /\n` +
    disallow.map((path) => `Disallow: ${path}\n`).join("") +
    `\n` +
    sitemaps.map((path) => `Sitemap: ${root}${path}\n`).join("")
  );
}
