# Build an app with the @gusnips packages, part 2

[Part 1](GUIDE.md) built `notes`: an API, a web app and sign-in. Part 2 adds what a product needs
next, one chapter at a time.

As in part 1, every snippet comes from a copy of the app that was built and run while this was
written, on Bun 1.4.2. Part 2 starts from part 1's repo, with the catalog moved up to
`@gusnips/http` `^0.1.4`, `@gusnips/react` `^0.9.17`, `@gusnips/server` `^0.8.19` and
`@gusnips/vite` `^0.8.26`. Move `@gusnips/react` and `@gusnips/vite` in the same commit:
[part 1 shows why](GUIDE.md#set-up-the-repo).

Part 2 covers:

1. [Pages a search engine can read](#pages-a-search-engine-can-read)

## Pages a search engine can read

The web app draws its pages with JavaScript. A search engine, or the app that shows a preview when
someone pastes your link, often runs none. It sees `<div id="root"></div>` and nothing else. So the
public site renders each page to its own HTML file when it builds.

The site is a new app, `apps/site`, beside the web app. Its Vite config is the web app's, on
another port:

```ts
// apps/site/vite.config.ts
import { webPreset } from "@gusnips/vite/preset";
import { defineConfig } from "vite";

export default defineConfig(webPreset({ root: import.meta.dirname, port: 5174 }));
```

It depends on `@gusnips/react`, `@gusnips/tokens`, `react`, `react-dom` and `react-router-dom`, and
builds with the same tools as the web app. Its `.env` holds the two addresses it links to:

```text
VITE_SITE_URL=https://example.com
VITE_APP_URL=https://app.example.com
```

### One list of pages

```ts
// apps/site/src/pages.ts
import type { PublicPage } from "@gusnips/vite";

// Every public page, in one list. The prerender writes a file for each, and the sitemap lists
// each, so a page cannot be in one and missing from the other.
export interface SitePage extends PublicPage {
  title: string;
  description: string;
}

export const PAGES: readonly SitePage[] = [
  {
    path: "/",
    title: "Notes: write it down, find it later",
    description: "Write a note in one line, and find it again on any device.",
    priority: 1,
    changeFrequency: "weekly",
  },
  {
    path: "/pricing",
    title: "Pricing · Notes",
    description: "Notes is free for 100 notes. Unlimited notes cost $4 a month.",
    priority: 0.8,
    changeFrequency: "monthly",
  },
];
```

`PublicPage` gives each page a `path`, and the `priority` and `changeFrequency` the sitemap needs.
The title and the description are yours to add.

### One app, two ways in

The pages are ordinary React routes. The pricing page loads on demand, with `lazy()`:

```tsx
// apps/site/src/App.tsx
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";

const PricingPage = lazy(() =>
  import("./pages/PricingPage.tsx").then((m) => ({ default: m.PricingPage })),
);

export function App() {
  return (
    <Layout>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
```

The build renders that `App` once for each address:

```tsx
// apps/site/src/entry-server.tsx
import type { PageRenderer } from "@gusnips/vite";
import { renderTree } from "@gusnips/vite/render";
import { StrictMode } from "react";
import { StaticRouter } from "react-router-dom";
import { App } from "./App.tsx";

// The same App as main.tsx, with a router that takes the address as an argument.
export const renderPage: PageRenderer = (route) =>
  renderTree(
    <StrictMode>
      <StaticRouter location={route}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
```

Name the export `renderPage`. The prerender script looks for that name.

**Render with `renderTree`, never `renderToString`.** `renderToString` does not wait for a `lazy()`
page. We tried it here, and `pricing.html` held React's error message where the page should be. A
browser never shows that, because the app draws the page again on load. A search engine reads it.
`renderTree` waits for every `lazy()` page, and the script below stops the build if a file holds
that error. [Rendering](vite/README.md#rendering).

In the browser, `main.tsx` takes over the page the file already holds:

```tsx
// apps/site/src/main.tsx
import { hydrateOrMount } from "@gusnips/react/hydrate";
import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

hydrateOrMount(
  root,
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
  window.location.pathname,
);
```

**Hydrate only the page the file holds.** To hydrate is to keep the HTML on screen and attach the
app to it, instead of drawing it again. A host answers an address it has no file for with your
`404.html`, and that file holds the not-found page. Each file names the page it holds, so
`hydrateOrMount` hydrates when that name matches the address, and draws the page fresh when it does
not. In a browser, `/` and `/pricing` kept the elements the file delivered, with no errors in the
console. `/nope` got the 404 file, and the app drew it fresh.

### The prerender script

`index.html` has to carry every tag the script rewrites: the description, the canonical, and the
`og:title`, `og:description`, `og:url` and `og:image` tags. Then, after `vite build`:

```ts
// apps/site/scripts/prerender.ts
import path from "node:path";
import { SHELL_ROUTE } from "@gusnips/react/contract";
import {
  assertOgImages,
  assertRendered,
  bakeHead,
  loadRenderer,
  loadTemplate,
  pageFile,
  robotsTxt,
  siteOrigin,
  sitemapFor,
  writeDist,
} from "@gusnips/vite";
import { PAGES } from "../src/pages.ts";

const SITE = path.resolve(import.meta.dirname, "..");
const DIST = path.join(SITE, "dist");
const ORIGIN = siteOrigin(process.env.VITE_SITE_URL ?? "https://example.com");

const renderPage = await loadRenderer(path.join(SITE, "dist-ssr/entry-server.js"));
// Read it before the loop: dist/index.html is the template, and also where the home page goes.
const template = await loadTemplate(DIST);

for (const page of PAGES) {
  const html = bakeHead(template, {
    title: page.title,
    description: page.description,
    canonical: `${ORIGIN}${page.path}`,
    image: `${ORIGIN}/og.png`,
    body: { route: page.path, html: await renderPage(page.path) },
  });
  const file = pageFile(page.path);
  assertRendered(file, html, template);
  await writeDist(DIST, file, html);
}

// Served for every address that has no file. It claims no address of its own.
const notFound = bakeHead(template, {
  title: "Page not found · Notes",
  description: "There is no page at this address.",
  canonical: null,
  noindex: true,
  body: { route: SHELL_ROUTE, html: await renderPage("/404") },
});
assertRendered("404.html", notFound, template);
await writeDist(DIST, "404.html", notFound);

await writeDist(DIST, "sitemap.xml", sitemapFor(ORIGIN, PAGES));
await writeDist(DIST, "robots.txt", robotsTxt({ origin: ORIGIN, sitemaps: ["/sitemap.xml"] }));
await assertOgImages(DIST, ORIGIN);

console.log(`Prerendered ${PAGES.length} pages and 404.html`);
// Under Bun, the renderer keeps the process alive after the last file is written.
process.exit(0);
```

`bakeHead` writes one page's title, tags and body into the template. `pageFile("/pricing")` is
`pricing.html`, and the sitemap and `robots.txt` come from the same list of pages.

**End with `process.exit(0)`.** Under Bun, the renderer keeps the process running after the work
is done. Without that line, the script printed its last line and was still running 25 seconds
later, when we stopped it. In CI, that is a job that does all its work, then waits for its timeout.

**The 404 page claims no address.** `canonical: null` removes the canonical and `og:url`, and
`noindex` keeps the page out of search results. Leave `image` out too: the page then keeps the
share image from `index.html`, which is a real file.
[Baking a page](vite/README.md#baking-a-page).

**Every check stops the build.** `bakeHead` stops when `index.html` is missing a tag it has to set.
`assertRendered` stops on a page that rendered too little, a loading screen, or React's error.
`assertOgImages` runs last: it reads every file the build wrote, and stops on a share image that
is not in `dist/`.

**Give the loading text `role="status"`,** as `App.tsx` does. A screen reader then reads it out,
and `assertRendered` can tell a loading screen from a page. We rendered the pricing page stuck on
its loading text: with a plain `<p>`, the file passed every check. With `role="status"`, the build
stopped.

`assertRendered` also wants each page to be at least 500 bytes bigger than `index.html`. Our
pricing page, before it had a header and a footer, grew by 396 bytes and stopped the build. For a
page that is short on purpose, pass a smaller floor: `assertRendered(file, html, template,
{ minGrowth: 200 })`.

### Build it

The site's `build` script runs the three steps in order:

```json
"build": "vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr && bun scripts/prerender.ts",
```

Add `dist-ssr/**` to the build's `outputs` in `turbo.json`, beside `dist/**`. turbo restores only
the folders listed there, so without it a cached build brings back the pages and not the renderer
that wrote them.

Then run `bun run build` in `apps/site`. It prints `Prerendered 2 pages and 404.html`, and `dist/`
holds `index.html`, `pricing.html`, `404.html`, `sitemap.xml` and `robots.txt`:

```text
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

**Every address in the sitemap must answer 200, not redirect.** That is why the page is
`pricing.html` and not `pricing/index.html`: a host like Cloudflare Pages serves the flat file at
`/pricing`, and would redirect `/pricing` to `/pricing/` for the folder. Hosts differ, so run
`curl -I` on one page after your first deploy. [Flat files](vite/README.md#flat-files).

Run the script a second time without `vite build`, and it stops: `dist/index.html` no longer
holds an empty `<div id="root"></div>`. That file is both the template and the home page, and the
first run turned it into the home page.
[Sitemap, robots, OG cards](vite/README.md#sitemap-robots-og-cards).
