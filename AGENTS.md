Entry point for AI agents working on this repo.

# frontkit

**The layer under a Vite + React SPA.** The build rig, the fetch client, the auth store, the
guards, the tokens — everything twelve products wrote twelve times. Deliberately **not** a
component library: no styled Button, no brand, no illustrations. Those are where a product
lives and they stay in the app.

MIT · open source · npm scope `@gusnips`

## Why it exists

Extracted from twelve private frontends in `~/dev` that had each independently grown the same
layer — roughly **48,000 lines of plumbing across nine independent repos**, on one stack:
Vite 8 + React 19 + react-router-dom 7 + Tailwind 4 + zustand + TanStack Query + i18next,
Bun workspaces, `apps/{web,api,site}` + `packages/{ui,server,shared}`.

Six filenames exist in all twelve: `vite.config.ts`, `main.tsx`, `App.tsx`,
`entry-server.tsx`, `prerender.ts`, `publicPages.ts`. Nine have `authStore.ts`. Ten have
`Button.tsx` and ten define their own `cn()`.

They are **not copies**, and that is the entire point. `prerender.ts` runs 104–424 lines with
1–82% line overlap; `ErrorState.tsx` across seven repos overlaps 9–37%. The same problem was
solved from scratch a dozen times, and **each copy knows something the others do not.**
Reading them against each other is what this package is; the merge is worth more than the
dedup. Three examples from the first audit alone:

- Three repos independently invented `PRERENDERED_ROUTE_ATTR = "data-prerendered-route"` —
  same name, same string, same hydrate-or-mount decision, same explaining comment.
- Three repos independently invented single-flight token refresh, because GoTrue rotates the
  refresh token and six parallel queries would each invalidate the winner.
- Three repos wrote three different react-query retry rules, and **each one is right about
  something the other two get wrong** (see invariant 8).

The source repos are private and are not named here; nothing about the package depends on
knowing which they were.

## Layout

```
frontkit/               ← repo root (this folder), git root
├── tokens/             ← @gusnips/tokens — one Tailwind 4 @theme file. Zero deps.
├── http/               ← @gusnips/http   — the envelope. Types only, zero deps, no framework.
├── react/              ← @gusnips/react  — the headless runtime. One required peer: react.
│   └── src/ui/         ← the seven Base UI wrappers, behind a subpath (see below)
├── vite/               ← @gusnips/vite   — the build rig. The ONLY package allowed node:fs.
├── scripts/            ← check-purity.ts and check-exports.ts, the two repo-level guards
└── AGENTS.md           ← this file
```

**Subpaths, and the rule that decides them.** Anything needing a peer the main entry does not
already require lives behind one, so an adopter installs a dependency only by importing the thing
that uses it — `@gusnips/react/ui` (`@base-ui/react`), `/store` (`zustand`), `/guards`
(`react-router-dom`), `/hydrate` (`react-dom`), `/contract` (nothing), `@gusnips/vite/preset` and
`/render` (React). See invariant 15; `bun run exports` is what holds the line.

`react` is the only peer `@gusnips/react`'s main entry requires, and that is deliberate rather
than incidental: it is what makes the package importable from **React Native**, which has no
react-dom to give. See migration 2.

**Four packages, split by dependency profile.** That split is not taste; it is what each
consumer can afford to install:

- `tokens/` is imported by the Astro marketing sites too, so it cannot contain JavaScript.
- `http/` is imported by `apps/api`, so it cannot contain React. A server depending on a
  package named "react" is a smell even when it costs nothing at runtime.
- `react/` runs in a browser AND inside a prerender, so it cannot contain `node:*`.
- `vite/` needs `node:fs`. Having somewhere for that to live is what lets the other three be
  strict.

Dependency edges run one way: `vite/ → react/ → http/`. Never the reverse. In particular
`PRERENDERED_ROUTE_ATTR` lives in `react/`, not `vite/`, because a **browser entry** reads it —
putting it in the build-time package would drag `node:` into the client bundle.

Folder names state their ROLE, not an npm scope — the same rule as providerkit's `core/`.

## Commands

```bash
bun install                  # workspace root

bun run check                # lint → typecheck → purity → test, all four packages
bun run purity               # the platform guard on its own
bun run build
bun run format
```

Per package: `cd react && bun run test`, etc.

## Naming and publishing — decided

- **Scope `@gusnips`**, already owned (`@gusnips/asaas` lives there). Not `@providerkit`, even
  though that org is free: "providerkit" means LLM-provider abstraction, so `@providerkit/tokens`
  would inherit the wrong noun. providerkit stays narrow and keeps `@providerkit/react` for real
  React bindings to its agent loop.
- Scoped packages publish restricted by default; `publishConfig.access` is `public` on all four
  so a release cannot silently go private.
- **Adopters resolve from the registry** — never `link:` or `file:`. providerkit's lesson: a
  `file:` dependency resolves on exactly one machine, and it drags the package's own
  devDependencies into the adopter's lockfile.

## What must NOT be shared

This rule is what keeps the package alive; violating it is how design systems die. Each of
these was checked against the code, not assumed.

- **`packages/ui/src/brand/` stays in each product.** One product has a colibri, one has a
  mascot named Jack, one has a Scene set. That is the product, not the plumbing.
- **Styled `Button.tsx` stays put.** The two best copies are 104 lines (cva, 11 variants, 10
  sizes, a loading spinner) and 60 lines (4 variants, 3 sizes, no cva, and deliberately _no_
  `focus-visible:` styles because its one focus ring lives in the theme). They overlap on the
  idea and nothing else. A shared styled Button satisfying eight brands grows variant props
  forever. Share behavior, skin per product.
- **`EmptyState` / `ErrorState` ship as a contract, not a component.** They share a prop shape
  and one class string; the visual is a tinted icon badge, a branded Scene, or a mascot board.
  What ships is `EmptyStateProps` / `ErrorStateProps` — the _type_ is what enforces "never dead
  end the user" — plus the error→copy machinery behind them. The rendering stays home.
- **App scaffolding** (`main.tsx`, `App.tsx`, folder layout) is a template copied once, not a
  dependency.
- **Colours.** `tokens/` defines the token NAMES and the dark-mode MECHANISM; each product fills
  the values.
- **Error code lists.** `http/` ships the envelope generic over a product's own code union. The
  codes themselves are that API's vocabulary.

## Invariants — do not regress these

Each cost someone a production incident, or is one lazy route away from costing one. The tests
pin them; if one fails, a lesson is being un-learned.

1. **Prerender with `react-dom/static`, never `renderToString`.** With `lazy()` routes behind a
   `<Suspense>`, `renderToString` renders the **fallback** — a loading screen written into every
   file, passing every gate that only asks whether the root has children. Two more halves of the
   same lesson, from two other repos: `renderToString` also answers `""` for a basename/location
   mismatch with no error and no warning (so **assert non-empty output per route**), and React 19
   hoists in-tree `<title>`/`<meta>`/`<link>` to the FRONT of the server stream — which lands
   inside the body when you are filling one `<div>` rather than assembling a document. Strip
   them, and rethrow `onError` so a render failure fails the build.
2. **A prerendered file names its own route**, and the entry hydrates only on a match.
   "Does the root have children" is the wrong question and getting it wrong is silent: a static
   host answers every address it does not publish with the nearest `404.html`, which has the
   not-found page rendered INTO it. Hydrating that is React reconciling two different pages — it
   recovers by throwing the tree away and logging, which is a page that works and a bug nobody
   sees.
3. **A failed refresh is not a dead session.** Only auth actually answering "no" signs anyone
   out; a network failure falls through and the request is retried. Collapsing the two means a
   Wi-Fi blip logs the user out mid-load. And a sign-out needs a fail-safe timer: awaiting
   `signOut()` before redirecting covers a rejection, not a hang, and a hang leaves someone
   signed out in name only — every request 401ing, nothing left that could redirect it.
4. **A failed query is not an answer.** `!me?.isStaff` reads a 500 as "not staff", so an
   operator arriving while `/auth/me` is down is told the page does not exist — the wrong cause,
   no retry, no request id to quote. A guard decides between waiting, failing and answering; only
   a real `false` reaches the refusal.
5. **Flat page files** (`pricing.html`), not `pricing/index.html`. Cloudflare Pages serves the
   directory form at `/pricing/` and answers `/pricing` with a 308 — so every address the app
   advertises in its canonical and its sitemap would be a redirect rather than a page.
6. **`og:locale` is not optional on a non-English page.** Absent, the Open Graph spec does not
   default it to "unknown" — it defaults to `en_US`, so a Portuguese page with a Portuguese
   `og:title` tells every share crawler the card is English.
7. **`isLoading` starts false where there is no window.** A session bootstrap can only be in
   flight in a browser. `true` during a build is a wait that never ends: it shipped a spinner as
   the indexable body of a page whose whole purpose was to be found.
8. **Never retry what waiting cannot fix.** 402 and a durable 429 (`QUOTA_EXCEEDED`,
   `PAYMENT_REQUIRED`) clear by buying, not by waiting; retrying them burns another request
   against the limiter and says the same thing three times. Retry 408, a transient 429, 5xx, and
   no-response-at-all — nothing else.
9. **A wrapper forwards its rest props.** A closed prop list removes `name`, `required`, `form`
   and `data-*` from a form control. Four wrappers in the donor repo did exactly this: they did
   not add form integration, they removed it.
10. **No Node built-ins in `tokens/`, `http/` or `react/`.** `bun run purity` is the guard, and
    tsc cannot replace it — a root-level `@types/node` is visible to every workspace, so a stray
    `node:fs` import typechecks fine and breaks a browser bundle. Nor can any grep catch the
    sibling failure: a **browser global read at module scope** inside `react/` crashes a
    prerender rather than a bundle. That one is checked by eye at every extraction.
11. **Never `import.meta.dir`.** It is bun-only, and two donor scripts used it. Use
    `fileURLToPath(import.meta.url)`.
12. **A shell strips its canonical, and takes `og:image` with it.** Blanking is not stripping:
    an empty canonical is a claim about `""` and an empty `og:url` is a card pointing at the
    origin root. The image is the half that gets missed — one donor sets it before it branches
    on the shell, so its `404.html` advertises a card at `/og/__not-found__.png`, a file that
    has never existed. Every share of a missing address unfurls broken, and nothing in a browser
    shows it.
13. **Sitemap `priority` arrives pre-formatted.** The two donors rank pages by different rules —
    one reads a field off its registry, the other gives the front door 1.0 and every guide 0.8
    flat, because ranking one guide above another would be a guess about a reader. A function
    that formats the number owns a decision belonging to whoever walks the registry.
14. **The template is also a destination.** `dist/index.html` is both the file every page is
    baked FROM and the home page's own output, so a second pass over a `dist/` already written
    reads a finished page as its blank and nests one render inside another. `vite build` empties
    `dist/` and normally makes this impossible; a restored build cache and a hand-run of the
    script both route around that. Refuse a template that already carries the prerendered-route
    attribute — and declare `dist-ssr/**` as a build output beside `dist/**`, or a cache replay
    restores written pages with no renderer beside them.
15. **A barrel imports what its lightest caller needs, and nothing else.** A re-export is a
    runtime import: `export { renderTree } from "./render.ts"` loads `react-dom/static.browser`
    for a script that only wanted `sitemapXml`. This has now happened three times, once in our
    own code — `hydrate.ts` sat in `react/`'s barrel beside the two prerender constants, so a
    build script reading a string constant pulled in the browser renderer. The fix each time was
    a subpath (`@gusnips/react/contract`, `@gusnips/vite/preset`, `@gusnips/vite/render`), and
    the payoff is that the peer can then be `optional`: an adopter who only generates a sitemap
    installs no React, and one on Radix installs no Base UI. Verify against the BUILT barrel's
    import graph, never the source — a type-only re-export looks identical in source and
    disappears at runtime, so reading `index.ts` answers a different question than the one that
    matters.

    **The mechanical form, which is what `bun run exports` checks: a peer marked `optional` must
    not be reachable from that package's `"."` entry.** Stated that way there is no judgement
    call about weight, and it caught the fourth instance the day it was written — `@gusnips/react`
    declared `zustand` and `react-router-dom` optional and imported both unconditionally from the
    one entry point every adopter loads. An optional peer the barrel imports anyway is not
    optional; it is a required peer whose error has been moved from install time, where a package
    manager explains it, to the adopter's first build, where a bundler blames one of OUR files for
    a package THEY never installed. `createAuthStore` and the guards moved to
    `@gusnips/react/store` and `@gusnips/react/guards`, and the main barrel now imports `react`,
    `react-dom` and `@gusnips/http` and nothing else. The three peers that stayed optional AND
    stayed in the barrel — `@tanstack/react-query`, `i18next`, `react-i18next` — are safe for the
    reason above: only their types are used, and types erase.

### …and six more for anything under `react/src/ui/`

The audit's headline finding was a NEGATIVE one: no wrapper in either donor adds scroll lock,
focus trap, ESC, outside-dismiss, focus return, roving focus or typeahead. Base UI does all of
it, and a wrapper that "adds" them is adding a second implementation of something that already
works. Twenty of the donor's twenty-seven wrappers were dropped on that basis.

What a wrapper legitimately buys is composition a caller cannot skip, required-a11y props
expressed as types, and the facts below — each of which cost somebody a debugging session:

16. **z-index goes on the Viewport, not the Popup.** `position: fixed` creates a stacking
    context, so a z-index on the Popup competes only INSIDE the Viewport's own `z-auto` context
    and paints under every `z-30` element on the page.
17. **A drawer TIES with dialog rather than beating it.** Ranked above, a drawer paints over
    every modal opened from inside it — the user taps, and nothing appears. At a tie the dialog
    wins on DOM order, because it portals second.
18. **Every part goes inside a Portal, including the ones that do not look like they need it.**
    Base UI throws error #26 otherwise, and a non-overlay "scoped" variant still portals — into
    a container rather than the body. Related: a combobox inside a portalled dialog is that
    dialog's SIBLING on `<body>`, so without a higher z it paints behind its own anchor.
19. **`outline-none` belongs on a popup container and nowhere else.** A popup takes focus
    programmatically, so it is the one element that legitimately suppresses the ring; anywhere
    else it deletes the app's only keyboard-focus affordance. Worth enforcing structurally — one
    donor budgets one reset per `<Primitive.Popup>` in a file, which cannot rot the way a
    filename allowlist does.
20. **Style off the accessibility attribute, never a parallel data attribute.** The primitive
    writes `aria-selected` and its own `data-*` from one state; styling the a11y contract is
    what keeps what a screen reader announces and what an eye sees from drifting apart.
21. **A shared control never hardcodes a colour it did not derive from a token.** `text-white`
    on a primary fill is the common one and it is broken by construction: across two donors
    `--color-primary-foreground` in dark mode is `#ffffff` and a near-black, so white-on-primary
    is correct in one and unreadable in the other. Always `text-primary-foreground`,
    `bg-scrim`, `border-border` — and never `bg-black/40`, which one donor wrote as two
    different values for the same job.

### The token contract, measured

Across the two donors, **25 token names are spelled identically and the values agree on
exactly four** — all of them the literal `#ffffff`. That is the argument for this split in one
sentence: the names are the contract, the values are the brand, and there is no shared palette
to find. Two of those names carry a floor rather than a preference, and a brand overriding them
needs to know it:

- `--color-input` must clear **3:1 against `--color-background`** (WCAG 1.4.11 — it is a
  control boundary). One donor's is ~1.6:1, so every field border in two of its apps fails.
- `--color-primary` must be **re-tuned in dark mode, not reused**. Holding one brand colour in
  both modes is the trap; the donor that lifts it and flips `--color-primary-foreground` to a
  near-black is the one whose primary control is legible on a card either way.

And one trap that is not about contrast at all:

- **`--duration-*` is not a Tailwind namespace.** Defining `--duration-standard: 250ms` in
  `@theme` compiles no utility, so `duration-standard` in a `className` is dead text and the
  transition silently runs at Tailwind's default. `--ease-*` beside it DOES work, which is
  exactly what hides it — the easing lands and the duration does not. One donor has 61 of
  these. Use `duration-[250ms]`, or keep the token and write
  `transition-duration: var(--duration-standard)` in a real rule. The token package's compile
  check pins this so it cannot be rediscovered a third time.

  It is not the only one. The same donor defines `--weight-regular|medium|semibold|bold`, and
  Tailwind's namespace is `--font-weight-*` — four more dead tokens, harmless only because
  nothing reads them. And `--radius-sm|md|lg|xl` are **already stock Tailwind names**, so both
  donors were retuning built-ins rather than inventing a scale; `rounded-full` is a static
  utility compiling to `calc(infinity * 1px)` and needs no token at all. So the general rule:
  **before defining a token, check the namespace exists** — `@theme` accepts any `--name` you
  write and silently generates nothing for a namespace Tailwind does not have. That is why
  this package ships colours only, and why the compile check asserts the absent ones stay
  absent: if Tailwind ever adds `--duration-*`, the check fails and tells us we can ship them.

## What the migrations taught

### Migration 1 (−502 lines, 10 commits)

- **An API this package got wrong shows up as an adapter in the adopter.** `MeQuery`'s first
  state was `"loading"`, so wiring `createRequireProfile` to a react-query hook needed six
  hand-written lines whose entire job was renaming one string. Eight of the twelve repos are on
  react-query and would each have written it, with three states to map and three chances to map
  one wrong. react-query's own word is `"pending"`; with the words matching, a `UseQueryResult`
  satisfies `MeQuery` structurally and the hook goes in directly. **A six-line adapter in the
  first adopter is a design review, not a chore.** Pin the shape with a type-level assertion so
  it cannot drift back.
- **The house's own patterns are part of the contract.** `createErrorDescriber` took
  `t: (key: string) => string`, which no app on this stack can supply: every one declares
  i18next's `CustomTypeOptions.resources`, which types `t` to accept only the keys its catalog
  has — so a typed `t` is not assignable to anything asking for `string`, and the only way
  through is the cast the house rules forbid. The fix was to name the keys each function looks
  up. That is strictly better anyway: the doc comment listing seven required catalog keys became
  a type, so a catalog missing one is a compile error rather than a raw key on screen.
- **The whole point is the third repo.** The audit found `og:image` surviving onto a shell in one
  donor (invariant 12). This adopter — not a donor, not read during the audit — was shipping three
  404 shells advertising `/og/__not-found__.png`, a file its card generator has never rendered
  because it only renders pages in the registry. Every share of a dead link unfurled broken, in
  three languages, and nothing in a browser shows it.
- **A rig written twice in ONE repo is the strongest possible signal.** This adopter had two
  prerender rigs — site and docs — each with its own `escapeAttr`, `setMeta`, `pageFile`,
  `assertRendered`, `loadTemplate`, `loadRenderer` and sitemap writer. `resolve` was
  byte-identical between them, comment included. Both are the package now, and both sitemaps came
  out byte-identical to the previous build, which is the check that says the merge lost nothing.
- **Migrating a file rereads it, which is what finds the dead code.** The site's `index.html`
  carried 43 lines of `FAQPage` JSON-LD that the baker stripped from every page and rebuilt from
  the catalog — dead, and already drifted to four questions where the page renders seven. The
  site's error boundary had `crash.title`, `crash.body` and `crash.reload` written in all three
  locales and rendered none of them, showing a hardcoded English "Reload" instead. The
  dashboard's crash text had `{...rise(0.15)}` followed by `className="…"`, so JSX's later prop
  won and the animation class was silently dropped.
- **A contract can be a lint the adopter never ran.** `@gusnips/tokens` was NOT imported —
  its 808-line theme already defines 19 of the 20 semantic names, and the values are the
  brand, so importing placeholder greys to override them all would have been net-positive in
  lines for nothing. Reading the contract against the theme was still worth the whole exercise:
  `--color-input` measured **1.43:1** in light and **1.58:1** in dark against a 3:1 floor, so
  every field border in the product failed WCAG 1.4.11 in both modes. **Not importing a package
  and still using it is a real outcome.**
- **A silent no-op is worse than a missing feature.** `bakeHead` threw on a `<meta>` it was asked
  to set and could not find, but wrote the canonical with `String.replace` — which succeeds when
  it matches nothing. A template with no canonical would have shipped every page without one,
  quietly. Found because the docs template is exactly that template.

_(The audit that preceded the first line of code already taught these.)_

- **The audit finds bugs in repos that are not the extraction source.** Reading the two donors
  against each other found a sign-out-on-a-Wi-Fi-blip in one, a `RequireStaff` in a third repo
  that was the exact code that donor had already fixed, and an unguarded module-scope
  `localStorage` in the other. None of these had a test. None broke anything visible. All would
  have shipped.
- **A negative result is a finding.** The donor had 27 Base UI wrappers and the hypothesis was
  that they added scroll lock, focus trap, ESC, outside-dismiss and focus return. They add none
  of it — Base UI already does. The scope went from 27 to 5 before anything was written. Not
  extracting something is a valid outcome, and cheaper than extracting it and discovering later.
  Two then came back, and how they came back is the other half of the lesson: **menu** because
  the donor that had one knew a fact no comment can enforce (`GroupLabel` outside its `Group`
  throws — `Base UI error #31`, plus a link to look it up, naming neither the file, the part nor
  the component — so the part is not exported and the caption is a prop), and **tabs** because
  `overflow-x: auto` forces `overflow-y` off `visible`, and a self-scrolling rail therefore
  crops the focus ring on the tab the keyboard is on. Seven, not five. A wrapper earns its place
  by knowing something, never by styling something.
- **The best finding was not a bug in one repo, it was a landmine in another.** One repo
  prerenders with `react-dom/static` and documents why. A second uses `renderToString` and is
  safe _today_ only because its site happens to have no `lazy()` routes. That is not a bug to
  file; it is a trap to remove for everyone, which is what a package can do and a code review
  cannot.
- **When two donors disagree, check before taking the older one.** One repo's missing
  `ssr.noExternal` looked like a bug against another's documented one. Measured: the SSR bundle
  was 2.09 MB with zero bare imports, because Vite does not externalize linked workspace deps.
  The declaration is insurance, not a fix. Say which it is in the commit.
- **Split the envelope from the framing wherever both exist.** One repo's SSE reader is
  spec-correct but welded to `TextDecoderStream`; another's is a platform-free `feed(text)` that
  a React Native app shares — and it silently overwrites repeated `data:` lines. Neither is the
  answer alone. Export the parser beside the client, and expect the same shape elsewhere.

### Migration 2 (in progress)

The first repo with three apps and a phone, and the first that is a **donor** rather than only an
adopter. That changes what a migration finds: instead of one app missing a lesson, there are two
siblings in one tree and only one of them ever got the fix.

- **A fleet-wide bug hid in `turbo.json`.** The `build` task hashed one env var, and the four
  `VITE_*` ones — which Vite **inlines into the bundle**, and one of which the prerender reads for
  every canonical, every `og:url` and the whole sitemap — were not in the hash. Staging and
  production pass different values. A build right after a staging build is a cache hit, so
  production ships pointing at `stg.` on every address and talking to the staging API, and nothing
  about it looks wrong. `"env": ["VITE_*"]` as a wildcard, because every variable with that prefix
  goes into the bundle by definition. **Every repo on this stack has the same file. Check it.**
- **The sibling app is the finding.** Three times over, in one tree: the admin's own
  `isChunkLoadError` matched Chrome's phrasing and not Firefox's, so a stale deploy read as a hard
  crash on Firefox; the admin's `vite:preloadError` handler reloaded the whole page for a CSS
  *hint* failure and swallowed real ones; and the admin's `themeStore` still read `localStorage`
  unguarded at module scope, the white screen the web app had fixed two days earlier. All three
  were already right in the app next door. Nothing merged them, so nothing found them.
- **The invariant-12 bug was live in a THIRD repo.** `404.html` advertised
  `og:image = /og/__not-found__.png`, a file the card generator has never rendered because it only
  renders pages in the registry. Same as the first adopter, found the same way — by reading the
  shell branch rather than the browser.
- **`og:url` on a shell was the half nobody wrote down.** This repo did not blank it (which
  invariant 12 warns about); it set it to the ORIGIN, which is a different wrong: every share of a
  dead link unfurls as the home page. The package strips it, and the app's two other shells —
  `app.html` and `record.html`, which are the raw template rather than a bake — needed the same
  three tags removed by hand.
- **A rule can only be enforced if the template carries the tag.** The old rig APPENDED a canonical
  before `</head>`; the package REPLACES one, and refuses a template without it. So `index.html`
  gained a `<link rel="canonical">` it never had. That is the point: `String.replace` with no match
  succeeds, so the enforceable version needs something to fail against.
- **An adopter's API convention came up into the package.** The first adopter's server names a
  sentence with `messageKey`; this one has no such field and lets the **`code`** name it — 98 of
  them, `errors.FORECAST_NOT_FOUND` and siblings — which its client resolved itself. That is how
  i18n ended up inside a transport. `serverSentence` now reads the code under the same prefix and
  through the same `knownMessageKeys` gate, after `messageKey`. Second convention, same claim.
- **A version bump can be forced by a pin you cannot see.** `@gusnips/vite` depends on
  `@gusnips/react` at `workspace:*`, and npm rewrites that to an EXACT version at pack time. A
  react release therefore obsoletes the published vite: left alone, an adopter taking the new react
  gets a second nested copy of it under vite, with a second `PRERENDERED_ROUTE_ATTR`. The two ship
  in lockstep, react first.
- **Two audit findings did not survive contact with the code.** The audit said this repo sends no
  `og:locale` (it does, `pt_BR` plus two alternates, in `index.html`) and that its two robots files
  disagree about the domain (both name the same one). Neither went into a commit message. **Re-read
  before you write the finding down** — an audit note ages, and a bug claimed in a commit that was
  never true is worse than one that was never found.

### How to migrate a repo — the check that is not optional

**Read the code you are deleting against the code replacing it, function by function. Its
tests are not enough.** A green suite after a migration means the donor's tests still pass. It
says nothing about the donor behaviour nobody wrote a test for, which is most of what this layer
does. So for every file being deleted: list what it does, and find each one here. What is
missing comes UP into the package before the delete lands — that is the whole point, and it is
how the other eleven repos get it.

**Every migration must be net-negative in lines.** If an adopting repo grows, the cut line was
drawn in the wrong place and the fix belongs here, not in the adopter.

The tree is shared. Other agents work the same branch concurrently with uncommitted work you
cannot see — providerkit's fourth migration was started and backed out for exactly that. Commit
your own slice per file, by pathspec, and never touch a foreign dirty file.

## House rules

- 2-space, printWidth 100, double quotes (matches `.prettierrc`).
- Source imports keep real `.ts` extensions; `rewriteRelativeImportExtensions` emits `.js`.
- No `as any` / `as unknown as T`. Fix the type.
- Comments explain **why**, especially the non-obvious production reason. That is most of the
  value being preserved here — a rule without its reason gets "simplified" away next quarter.
  When a comment in a donor file names a real incident, it comes across with the code.
- **Correcting a comment means grepping for its sentence, not fixing its line.** A comment good
  enough to be true and memorable gets quoted into this file, so the copy that misleads someone
  is usually the one you are not looking at. That already happened once here: `menu.tsx` said a
  Base UI production error arrives as "the bare number 31", the fix landed in `menu.tsx`, and the
  same sentence sat uncorrected in "What the migrations taught" — the document people read
  BEFORE the code.
