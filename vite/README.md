# @gusnips/vite

Turn a Vite + React SPA's public routes into real HTML files at build time — a real `<head>`, a
real body, one file per page.

```bash
bun add -d @gusnips/vite
```

```ts
import { pageFile } from "@gusnips/vite";

pageFile("/pricing"); // → "pricing.html"
```

## Why bother

A Vite SPA ships one `index.html` and draws everything else with JavaScript. Nothing that reads a
link for a living runs that bundle — not a search crawler, not an LLM, not the thing that draws
the preview card when someone pastes your link in a chat. A shipped `<div id="root"></div>` is a
page that can be listed and never quoted.

So the build renders each public route to its own file. This is the part every app doing that
ends up writing.

## Baking a page

```ts
import { bakeHead } from "@gusnips/vite";

const html = bakeHead(template, {
  title: "Pricing — Example",
  description: "What it costs.",
  canonical: "https://example.com/pricing",
  body: { route: "/pricing", html: rendered },
});
```

`bakeHead` rewrites the title, the description, the canonical, the Open Graph and Twitter tags,
`<html lang>`, the `hreflang` set, and injects the rendered markup into `<div id="root">`.

Four rules in there are load-bearing:

- **`canonical: null` strips the tag, and `og:url` with it.** For the 404 shell, which is served
  for every address that does not exist. Blanking is not stripping: an empty canonical is a claim
  about `""`, and an empty `og:url` is a card pointing at your front page. **Leave `image` out
  there too**, and the shell keeps the card your template already has. The image is the half
  people miss, and `bakeHead` cannot catch it for you — it writes whatever card you name. Three
  codebases named the shell's card after its made-up path, so their `404.html` advertised
  `/og/__not-found__.png`, a file that has never existed. Every share of a dead link unfurled
  broken, and nothing in a browser showed it.
- **`og:locale` is not optional on a non-English page.** Leave it out and the spec does not
  default it to "unknown" — it defaults to `en_US`. A Portuguese page with a Portuguese
  `og:title` then tells every share crawler the card is English. `ogLocale("pt-BR")` gives you
  the underscore spelling it actually wants.
- **`body` carries the route, not just the markup.** A static host answers every address it does
  not publish with the nearest `404.html`, and that file has the not-found page rendered _into_
  it. So "does the root have children" is the wrong question: a route served from the shell finds
  a full root, hydrates, and React reconciles two different pages. It recovers by throwing the
  tree away and logging — a page that works, and a bug nobody sees. The marker is what the
  browser entry compares against before it decides.
- **`alternates` must be reciprocal.** A crawler ignores the whole set unless every address in it
  points back at the others, which is why you pass the full list to every page rather than "the
  other two".

## Rendering

```ts
import { renderTree } from "@gusnips/vite/render";
```

Behind its own subpath, because it is the one thing here that loads React. A repo that only wants
a sitemap installs no renderer.

It uses `prerender` from `react-dom/static`, never `renderToString`. With `lazy()` routes behind
a `<Suspense>`, **`renderToString` renders the fallback** — it will write a loading screen into
every file and pass any gate that only asks whether the root has children. It also answers `""`
for a basename mismatch with no error and no warning, so `assertRendered` checks every route for
non-empty output. And React 19 hoists in-tree `<title>` and `<meta>` to the front of the server
stream, which lands them inside your body when you are filling one `<div>` rather than assembling
a document — so those get stripped, and a render error is rethrown so a broken page fails the
build instead of shipping.

The fallback is not the worst case. `renderToString` can write its own ERROR into the page: one
repo shipped a live, indexed reference page carrying React's "does not support Suspense" message,
a stack trace, and five copies of an absolute path from the machine that built it. Nothing in a
browser shows it, because the bundle replaces the body on load — so the only readers who ever saw
it were the ones who run no JavaScript, which is every crawler the page was built for. It was in
one of its two languages, too: the first render bails but resolves the `lazy()` promise, so the
next locale rendered the real component and looked perfect. `assertRendered` refuses that text now.

End your prerender script with `process.exit(0)`. Under bun, importing this renderer leaves the
process alive after the last file is written: `react-dom/server` exits, `react-dom/static.browser`
does not, and `process.getActiveResourcesInfo()` shows nothing either way, so the only symptom is a
script that finishes its work and never returns. Node exits either way. We do not call `exit` for
you — a library killing its host process is worse than the hang — and in CI the alternative is a
job that builds everything and then runs to its timeout.

## Flat files

That `pageFile` at the top writes `pricing.html`, not `pricing/index.html`. Nested routes keep
their folders — `/guides/errors` → `guides/errors.html`.

Every address your app puts in a canonical or a sitemap has to answer 200 rather than redirect. On
Cloudflare Pages that means flat files: it serves `pricing/index.html` at `/pricing/` and answers
`/pricing` with a 308. A flat file answers both.

Hosts differ, though. Firebase Hosting redirects `/pricing` to `/pricing/` by default, and serves
`pricing/index.html` at `/pricing` itself once `trailingSlash` is `false`. On a host like that,
write the directory form and set the flag. Either way, run `curl -I` on one page before you trust
the sitemap.

## Sitemap, robots, OG cards

`sitemapFor(origin, pages)` walks your page registry; `robotsTxt({ origin, sitemaps })` generates
the file, listing every sitemap in one, because a crawler only reads the one at the origin root —
a subdirectory app cannot ship its own.

`sitemapXml` takes `priority` **pre-formatted, as a string**. Ranking pages is a decision that
belongs to whoever walks the registry: one codebase reads a field off its own registry, another
gives the front door 1.0 and every guide 0.8 flat, because ranking one guide above another would
be a guess about a reader.

`writeOgCards` walks the registry and calls a renderer you supply, and `fitText` does the
text-fitting maths. When copy does not fit, it **records the overflow and refuses to write**
rather than appending an ellipsis — an ellipsis makes every string "fit", so copy that outgrew
its column has no failing case and ships.

`assertOgImages("dist", origin)` reads every page the build wrote and checks that each share card
it advertises is a file that exists. Run it last:

```ts
await assertOgImages("dist", "https://example.com");
```

Three codebases shipped a `404.html` whose `og:image` named a card nothing had ever rendered —
the card generator walks the page registry, and a not-found shell is not in it. Every share of a
dead link unfurled broken, and nothing in a browser shows it. `bakeHead` cannot catch this: it
writes the image it is handed, and a shell carrying the brand card is correct. The build can,
because by then the card is on disk or it is not. Cards on another host are skipped.

`loadTemplate` refuses a `dist/index.html` that is already a rendered page. `dist/index.html` is
both the file every page is baked _from_ and the home page's own output, so a second pass over a
written `dist/` reads a finished page as its blank and nests one render inside another. `vite
build` empties `dist/` and normally makes that impossible — a restored build cache and a hand-run
of the script both route around it.

## The vite preset

```ts
import { webPreset } from "@gusnips/vite/preset";

export default defineConfig(webPreset({/* … */}));
```

Its own subpath too, since it pulls in the React and Tailwind plugins.

MIT · part of [frontkit](https://github.com/gusnips/frontkit)
