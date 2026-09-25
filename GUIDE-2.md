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
2. [More than one language](#more-than-one-language)

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

## More than one language

Each language gets its own addresses: `/pricing` in English, `/pt/pricing` in Portuguese. A search
engine reads each address once, so a page that changes language to match the browser is found in
one language only. [Why the default language has no prefix](locale/README.md#why-the-default-language-has-no-prefix).

### One list of languages

The site, the web app and the API all need the list, so it goes in `packages/shared`, which now
depends on `@gusnips/locale`:

```ts
// packages/shared/src/locale.ts
import { createLocales } from "@gusnips/locale";

// The languages Notes ships. The site, the web app and the API all read this one list.
export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// Where a reader's choice is saved. The site and the web app are two origins, so each has its
// own storage under this name; the choice crosses between them in the link.
export const LOCALE_STORAGE_KEY = "notes.locale";
export { LOCALE_QUERY_PARAM } from "@gusnips/locale";

export const { asLocale, localePath, localePrefix, localeUrl, localeQueryUrl, splitLocalePath } =
  createLocales(SUPPORTED_LOCALES, DEFAULT_LOCALE);
```

`localePath("pt-BR", "/pricing")` is `/pt/pricing`. The default language has no prefix, so every
address from the last chapter still works. `@gusnips/locale` has no dependencies, so the API can
import this file too.

Add `i18next` and `react-i18next` to the site and the web app, and
`i18next-browser-languagedetector` to the web app.

### The site in two languages

The words move into one catalog per language, `apps/site/src/i18n/en.json` and `pt-BR.json`, and a
component reads them with `const { t } = useTranslation()` and `t("pricing.heading")`. A `.d.ts`
file types the keys:

```ts
// apps/site/src/i18next.d.ts
import "i18next";
import type en from "./i18n/en.json";

// Checks every key you pass to t against the English catalog, so a missing key does not compile.
declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}
```

A typo like `t("home.nope")` then stops the typecheck. It checks the English catalog only; the
translation check at the end of this chapter covers the others.

On the site, the address names the language, so nothing needs detecting:

```ts
// apps/site/src/i18n/index.ts
import { DEFAULT_LOCALE, type Locale } from "@notes/shared";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ptBR from "./pt-BR.json";

const resources = { en: { translation: en }, "pt-BR": { translation: ptBR } };

// The address names the language, so there is nothing to detect. One instance per call, because
// the prerender renders every language in one process.
export function createI18n(locale: Locale) {
  const i18n = createInstance({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    resources,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  void i18n.use(initReactI18next).init();
  return i18n;
}
```

The build renders each page once for each language. The renderer takes the language as its second
argument, and the router's `basename` puts `/pt` in front of every link:

```tsx
// apps/site/src/entry-server.tsx
import type { PageRenderer } from "@gusnips/vite";
import { renderTree } from "@gusnips/vite/render";
import { DEFAULT_LOCALE, type Locale, localePath, localePrefix } from "@notes/shared";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { StaticRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { createI18n } from "./i18n/index.ts";

// The same App as main.tsx, with a router that takes the address as an argument, and the
// language as a second one.
export const renderPage: PageRenderer<Locale> = (route, locale = DEFAULT_LOCALE) =>
  renderTree(
    <StrictMode>
      <I18nextProvider i18n={createI18n(locale)}>
        <StaticRouter location={localePath(locale, route)} basename={localePrefix(locale) || "/"}>
          <App />
        </StaticRouter>
      </I18nextProvider>
    </StrictMode>,
  );
```

In the browser, `main.tsx` reads the language out of the address:

```tsx
// apps/site/src/main.tsx, after the root is found
// "/pt/pricing" is the pricing page in Portuguese. The file names "/pricing" as its page.
const { locale, path } = splitLocalePath(window.location.pathname);

hydrateOrMount(
  root,
  <StrictMode>
    <I18nextProvider i18n={createI18n(locale)}>
      <BrowserRouter basename={localePrefix(locale) || "/"}>
        <App />
      </BrowserRouter>
    </I18nextProvider>
  </StrictMode>,
  path,
);
```

**Hand `hydrateOrMount` the page, not the address.** The file for `/pt/pricing` names `/pricing`
as its page, because the language lives in the `basename`. Pass `window.location.pathname` here and
no Portuguese page would ever match, so each one would be drawn again from nothing. With `path`,
`/pt` and `/pt/pricing` kept the elements the file delivered, with no errors in the console.

### The prerender, once for each language

The list of pages now says where each page's words are, instead of holding them:

```ts
// apps/site/src/pages.ts, the list
export const PAGES: readonly SitePage[] = [
  { path: "/", copy: "home", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", copy: "pricing", priority: 0.8, changeFrequency: "monthly" },
];
```

The script loops over the languages, and over the pages inside that:

```ts
// apps/site/scripts/prerender.ts, after the template is read
// Every language's address for one page, plus x-default for a reader who matches none. Each
// page carries the whole list, its own address included.
function alternatesFor(page: string): Alternate[] {
  return [
    ...SUPPORTED_LOCALES.map((locale) => ({
      hreflang: locale,
      href: localeUrl(ORIGIN, locale, page),
    })),
    { hreflang: "x-default", href: localeUrl(ORIGIN, DEFAULT_LOCALE, page) },
  ];
}

for (const locale of SUPPORTED_LOCALES) {
  const { t } = createI18n(locale);

  for (const page of PAGES) {
    const html = bakeHead(template, {
      title: t(`${page.copy}.title`),
      description: t(`${page.copy}.description`),
      canonical: localeUrl(ORIGIN, locale, page.path),
      image: `${ORIGIN}/og.png`,
      lang: locale,
      alternates: alternatesFor(page.path),
      body: { route: page.path, html: await renderPage(page.path, locale) },
    });
    // "/pt/pricing" is written to pt/pricing.html.
    const file = pageFile(localePath(locale, page.path));
    assertRendered(file, html, template, { lang: locale });
    await writeDist(DIST, file, html);
  }

  // One 404 page per language: a host serves the nearest one, so /pt/nope gets pt/404.html.
  const notFound = bakeHead(template, {
    title: t("notFound.title"),
    description: t("notFound.description"),
    canonical: null,
    noindex: true,
    lang: locale,
    body: { route: SHELL_ROUTE, html: await renderPage("/404", locale) },
  });
  const file = pageFile(localePath(locale, "/404"));
  assertRendered(file, notFound, template, { lang: locale });
  await writeDist(DIST, file, notFound);
}

const sitemap = sitemapXml(
  SUPPORTED_LOCALES.flatMap((locale) =>
    PAGES.map((page) => ({
      loc: localeUrl(ORIGIN, locale, page.path),
      changefreq: page.changeFrequency,
      priority: page.priority.toFixed(1),
      alternates: alternatesFor(page.path),
    })),
  ),
);
await writeDist(DIST, "sitemap.xml", sitemap);
```

`sitemapFor` from the last chapter knows one language. With two, you build the entries yourself and
hand them to `sitemapXml`. It takes `priority` as text, so `toFixed(1)` turns `1` into `"1.0"`.

The build now writes `index.html`, `pricing.html` and `404.html` in English, and `pt.html`,
`pt/pricing.html` and `pt/404.html` in Portuguese.

**Every page lists every language, its own included.** A search engine ignores the whole set unless
each address in it points back at the others. `x-default` is the page for a reader whose language
you do not ship.

**`lang` sets `<html lang>` and `og:locale`.** `pt/pricing.html` says `lang="pt-BR"` and
`og:locale` `pt_BR`. Open Graph reads a missing `og:locale` as `en_US`, so a link preview would
treat your Portuguese page as English. `assertRendered(…, { lang })` stops the build when a file is
marked with another language: `pt/pricing.html is not marked as pt-BR`.
[Baking a page](vite/README.md#baking-a-page).

**Each language needs its own 404.** A host answers a missing address with the nearest
`404.html`, so `/pt/nope` gets `pt/404.html`. Served that way, it came back with status 404 and the
Portuguese page.

### Send a reader to their language before the page shows

A reader with a Portuguese browser who lands on `/pricing` should see `/pt/pricing`. A redirect in
`main.tsx` comes too late: the browser can show the English page before it runs that file. The gate
runs before the page shows:

```ts
// apps/site/vite.config.ts
import { localeGateScript } from "@gusnips/locale";
import { prePaintScript } from "@gusnips/vite";
import { webPreset } from "@gusnips/vite/preset";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from "@notes/shared";
import { defineConfig } from "vite";

// Sends a reader on a bare address to their language before the page paints.
const localeGate = prePaintScript({
  name: "locale",
  source: localeGateScript({
    locales: SUPPORTED_LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    storageKey: LOCALE_STORAGE_KEY,
  }),
  position: "head-prepend",
});

export default defineConfig(
  webPreset({ root: import.meta.dirname, port: 5174, plugins: [localeGate] }),
);
```

`prePaintScript` writes the gate to its own file and puts a `<script>` for it first in `<head>`.
In a browser set to Portuguese, `/pricing` went to `/pt/pricing`, and the first frame on screen was
already in Portuguese. A browser set to `pt-PT` went there too, and one set to `en-US` stayed. With
the gate's file blocked, the Portuguese browser stayed on the English page.

The gate checks a saved choice before the browser's languages, so the language picker has to save
one:

```tsx
// apps/site/src/components/LanguagePicker.tsx
import { type Locale, LOCALE_STORAGE_KEY, localePath, SUPPORTED_LOCALES } from "@notes/shared";
import { useLocation } from "react-router-dom";

// Each language in its own words, so a reader finds theirs without reading the other one.
const NAMES: Record<Locale, string> = { en: "English", "pt-BR": "Português" };

// The language gate reads this before the browser's languages. Without it, the link to the
// English page (a bare address) would send a reader with a Portuguese browser back to /pt.
function remember(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be blocked. The gate then goes by the browser's languages, as if no one chose.
  }
}

export function LanguagePicker({ current }: { current: Locale }) {
  const { pathname } = useLocation();
  return SUPPORTED_LOCALES.filter((locale) => locale !== current).map((locale) => (
    <a
      key={locale}
      href={localePath(locale, pathname)}
      hrefLang={locale}
      lang={locale}
      onClick={() => remember(locale)}
      // A middle click opens a new tab and fires no click event.
      onAuxClick={(event) => {
        if (event.button === 1) remember(locale);
      }}
    >
      {NAMES[locale]}
    </a>
  ));
}
```

**Save the choice on a middle click too.** A middle click opens the link in a new tab, and fires
`auxclick` but not `click`. In a Portuguese browser, a click on "English" and a middle click both
landed on `/pricing` and stayed there. With storage blocked, the same click went back to
`/pt/pricing`: the gate had nothing saved, so it went by the browser.
[Send a reader to their language](locale/README.md#send-a-reader-to-their-language-before-the-page-shows).

### Carry the language to the web app

The site and the web app are two origins, and each origin has its own `localStorage`. A choice
saved on the site is not there when the reader clicks "Sign in". So the link carries it, and the
language picker sits beside it:

```tsx
// apps/site/src/components/Layout.tsx
import { asLocale, DEFAULT_LOCALE, localeQueryUrl } from "@notes/shared";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LanguagePicker } from "./LanguagePicker.tsx";

export function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const locale = asLocale(i18n.language) ?? DEFAULT_LOCALE;
  return (
    <>
      <header className="mx-auto flex max-w-2xl items-center gap-6 p-8">
        <Link className="font-semibold" to="/">
          Notes
        </Link>
        <nav className="flex gap-4">
          <Link to="/pricing">{t("nav.pricing")}</Link>
          {/* The app is another origin, so the language rides in the link. */}
          <a href={localeQueryUrl(import.meta.env.VITE_APP_URL, locale, "/sign-in")}>
            {t("nav.signIn")}
          </a>
          <LanguagePicker current={locale} />
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-8">{children}</main>
      <footer className="mx-auto max-w-2xl p-8 text-sm">{t("footer")}</footer>
    </>
  );
}
```

On `/pt`, that link is `https://app.example.com/sign-in?lang=pt-BR`. The web app reads it with
`i18nInitOptions`:

```ts
// apps/web/src/i18n/index.ts
import { i18nInitOptions } from "@gusnips/react";
import {
  DEFAULT_LOCALE,
  LOCALE_QUERY_PARAM,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
} from "@notes/shared";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

// Screen readers and the browser's translate button read <html lang>, not i18next.
i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, "pt-BR": { translation: ptBR } },
    ...i18nInitOptions({
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES,
      storageKey: LOCALE_STORAGE_KEY,
      // A link from the site ends in ?lang=pt-BR. It wins over storage and the browser.
      queryKey: LOCALE_QUERY_PARAM,
    }),
  });

export { i18n };
```

`main.tsx` imports it once, beside `index.css`, and the web app gets its own `i18next.d.ts` like the
site's. Tests need it too, so `vitest.config.ts` lists it in `setupFiles`.

**The parameter wins, then the saved choice, then the browser.** An English browser that opened
`/sign-in?lang=pt-BR` got the page in Portuguese, and `<html lang="pt-BR">`. It opened `/sign-in`
again without the parameter and stayed in Portuguese, because the detector saved the choice.
[A language does not survive a jump to another origin](locale/README.md#a-language-does-not-survive-a-jump-to-another-origin).

The error sentences from part 1 go through `t` too, so a failure reads in the reader's language:

```ts
// apps/web/src/lib/describeError.ts
import { createErrorDescriber, type ErrorArm } from "@gusnips/react";
import type { ErrorCode } from "@notes/shared";
import { i18n } from "../i18n/index.ts";

const codes: Partial<Record<ErrorCode, ErrorArm>> = {
  VALIDATION_ERROR: () => ({
    cause: i18n.t("errors.invalid"),
    fix: i18n.t("errors.invalidFix"),
  }),
};

// The describer reads its four sentences (errors.network, errors.networkHint, errors.unexpected
// and errors.retrySoon) through t, so they come out in the reader's language.
export const describeError = createErrorDescriber({
  t: (key) => i18n.t(key),
  copyPrefix: "errors.",
  messageKeyPrefix: "serverErrors.",
  knownMessageKeys: {},
  formatWait: (secs) =>
    new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }).format(secs, "second"),
  codes,
});
```

Leave out one of those four keys and the typecheck fails, because the describer names the keys it
reads. [Never dead-end anyone](react/README.md#never-dead-end-anyone).

### Check the translations

The typecheck knows the English keys. This script checks the rest: a key one language lacks, a
`{{name}}` renamed in translation, a plural form a language needs.

```ts
// scripts/check-i18n.ts
import { readFile } from "node:fs/promises";
import { checkI18n, formatI18nReport, type I18nBundle } from "@gusnips/vite/i18n";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@notes/shared";

async function readCatalog(file: string) {
  return { translation: JSON.parse(await readFile(file, "utf8")) };
}

const web: I18nBundle = {
  name: "apps/web",
  locales: SUPPORTED_LOCALES,
  canonical: DEFAULT_LOCALE,
  load: (locale) => readCatalog(`apps/web/src/i18n/locales/${locale}.json`),
  code: ["apps/web/src/**/*.{ts,tsx}"],
};

const site: I18nBundle = {
  name: "apps/site",
  locales: SUPPORTED_LOCALES,
  canonical: DEFAULT_LOCALE,
  load: (locale) => readCatalog(`apps/site/src/i18n/${locale}.json`),
  code: ["apps/site/src/**/*.{ts,tsx}", "apps/site/scripts/*.ts"],
};

const report = await checkI18n([web, site]);
console.log(formatI18nReport(report));
process.exit(report.problems.some((problem) => problem.level === "error") ? 1 : 0);
```

It lives in the root `scripts/`, because it reads two apps. The root `package.json` gets
`@gusnips/vite` and `@notes/shared` as dev dependencies, the script
`"i18n:check": "bun scripts/check-i18n.ts"`, and `&& bun run i18n:check` at the end of `check`, so
`bun run check` runs it with everything else.

We deleted `signIn.submit` from the Portuguese catalog, and `bun run i18n:check` stopped:

```text
apps/web
  ✖ parity: pt-BR signIn.submit missing
  · 4 key(s) no code reaches, as far as a scan can tell
✖ i18n: 1 error(s)
```

Those 4 keys are the describer's four sentences. It reads them by prefix, which a scan cannot see,
so that line is a hint, not a failure. `code` also checks that every `t("key")` in the source is in
the English catalog. [Check your translations](vite/README.md#check-your-translations).
