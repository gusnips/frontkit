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
knowing which they were. **That covers every file, code comment and commit message, because this
repo is public.** Say "the first adopter", "a donor" or "the second migration". Names already got
into the history once, and the only fix was rewriting all of it before the first push.

## Layout

```
frontkit/               ← repo root (this folder), git root
├── tokens/             ← @gusnips/tokens — one Tailwind 4 @theme file. Zero deps.
├── http/               ← @gusnips/http   — the envelope. Types only, zero deps, no framework.
├── locale/             ← @gusnips/locale — where a language lives in a URL. Zero deps, a leaf.
├── react/              ← @gusnips/react  — the headless runtime. One required peer: react.
│   └── src/ui/         ← the seven Base UI wrappers, behind a subpath (see below)
├── vite/               ← @gusnips/vite   — the build rig. The ONLY package allowed node:fs.
├── scripts/            ← check-purity.ts, check-exports.ts and check-release.ts, the guards
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

**Five packages, split by dependency profile.** That split is not taste; it is what each
consumer can afford to install:

- `tokens/` is imported by the Astro marketing sites too, so it cannot contain JavaScript.
- `http/` is imported by `apps/api`, so it cannot contain React. A server depending on a
  package named "react" is a smell even when it costs nothing at runtime.
- `locale/` is imported by `apps/api` for the same reason, and it is where the fifth package
  came from rather than a `@gusnips/react/locale` subpath. Measured across the six repos that
  have this module: every `apps/api` imports `asLocale` and the locale list, and **not one**
  imports a path helper. The list is product data that stays home either way, so the server's
  whole use of the shared half is one narrowing function — and putting that behind the react
  package's name would put react in six servers' dependency graphs to get it.
- `react/` runs in a browser AND inside a prerender, so it cannot contain `node:*`.
- `vite/` needs `node:fs`. Having somewhere for that to live is what lets the other three be
  strict.

Dependency edges run one way: `vite/ → react/ → http/`. Never the reverse. In particular
`PRERENDERED_ROUTE_ATTR` lives in `react/`, not `vite/`, because a **browser entry** reads it —
putting it in the build-time package would drag `node:` into the client bundle.

`locale/` is a **leaf**: nothing in frontkit imports it, deliberately. A package that depends on
it would pin it at an exact version at pack time, which is the hazard the `vite → react` pin
already costs us a paired bump for; a leaf has no version anyone else can get wrong. That is also
why `i18nInitOptions` does not read `LOCALE_QUERY_PARAM` itself — the adopter passes it, one line,
and the writer and the reader of the language still cannot drift.

Folder names state their ROLE, not an npm scope — the same rule as providerkit's `core/`.

## Commands

```bash
bun install                  # workspace root

bun run check                # lint → typecheck → purity → test, all four packages
bun run purity               # the platform guard on its own
bun run release:check        # what the REGISTRY would get — run before every publish
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
- **Release with `bun publish`, never `npm publish`.** `@gusnips/vite` depends on `@gusnips/react`
  at `workspace:*`, which npm cannot resolve — something has to rewrite it to a real version at pack
  time, and both ways of getting that wrong have already shipped. `npm publish` does not rewrite it
  at all, so `@gusnips/vite@0.4.0` went out with the literal string `workspace:*` and cannot be
  installed. `bun publish` rewrites it **from `bun.lock`, not from the sibling's package.json** —
  which is why `@gusnips/vite@0.3.0` pins `@gusnips/react@0.2.0` and gives an adopter a second,
  older copy of react nested under vite. Neither is visible from the source tree, where the
  workspace link makes every version correct.
- **Bumping a version does not update the lockfile. Delete `bun.lock` and re-install.** This is the
  sharp edge under the bullet above, and "run `bun install` first" — what this file said before —
  does not do it. bun rewrites a workspace's recorded `version` only when that workspace's
  _dependencies_ change; a version-only bump changes nothing bun looks at, so `bun install`,
  `bun install --force` and `bun install --lockfile-only` all report success and leave the old
  number in place. `bun publish` then pins the sibling to it. The only thing that reconciles the two
  is `rm bun.lock && bun install`, which also floats every unpinned dependency — do it deliberately,
  at release time, and run `bun run check` after.
- **`bun run release:check` packs each package and reads the manifest that comes out.** It is the
  only thing here that looks at what the registry will actually receive, and the only reason the
  bug above is a caught error rather than a broken tarball.
- **Publish in dependency order** — `tokens`, `http`, `locale`, `react`, `vite` — and bump `vite` whenever
  `react` ships, because the pin inside it changed even when none of its own code did.
- **And the adopter's half of that pin: the two carets move together, or the install grows a second
  copy of `react`.** That exact pin inside `vite` is reachable through the ADOPTER's `vite` caret,
  so a repo whose `react` caret sits a minor behind gets both. Measured by really installing
  `{"@gusnips/react": "^0.8.0", "@gusnips/vite": "^0.8.2"}` — two repos carry exactly that — which
  resolves `@gusnips/react` to **0.8.1 and 0.9.2 at once**, because `^0.8.2` floats vite to 0.8.6
  whose pin is `0.9.2` and a caret on a 0.x does not cross a minor. `{"^0.9.0", "^0.8.4"}` installs
  one copy, also measured. Nothing warns: `bun install` is silent, `release:check` reads what the
  REGISTRY gets and not what an adopter assembles, and the two `PRERENDERED_ROUTE_ATTR`s happened to
  be the same string, so even the failure invariant 2 describes stays quiet. The rule is that the
  pair is one decision: bump `react` and `vite` in the same commit, in the adopter too, never only
  the one whose changelog you were reading.

  **Two things about MEASURING it, both learned by getting them wrong an hour apart.** This bullet
  first said one repo, and the count was wrong because the scan read each repo's ROOT manifest only —
  which answers for the repos that keep a dependency catalog and silently skips every repo that
  declares the same dependency inside its workspaces. Three of twelve did, and one of those three was
  the second offender. A fleet-wide dependency question is asked of **every** `package.json`, never
  the root one.

  And this bullet first offered `find node_modules -path '*@gusnips/react/package.json'` as the
  one-line check. Under bun's isolated linker that is wrong in the direction that invents a problem:
  it walks `node_modules/.bun`, the content store, which keeps every version ever installed in that
  tree — so a range you have already corrected still reports two copies. Ask the resolver instead:
  `bun why @gusnips/react` prints one heading per RESOLVED version, and one heading is the whole
  test. Watched misfiring on a real tree before the replacement was believed, which is the only
  evidence a check ever has.

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

   **And it does not always render the fallback — sometimes it renders its own ERROR.** The eighth
   migration found a live, indexed reference page carrying React's "The server used renderToString
   which does not support Suspense" text, a stack trace, and five copies of an absolute path from
   the machine that built it. Nothing in a browser shows it: the bundle replaces the body on load,
   so the only readers who ever saw it are the ones who do not run JavaScript — which is every
   crawler the prerender exists for. It was in ONE language, and that half nobody would guess: the
   first render suspends and bails, but it also resolves the `lazy()` promise, so the next locale in
   the same loop rendered the real component. One loop, two language versions of one address, one of
   them a stack trace. Every cheap check passes it — the error text makes the file BIGGER, so a size
   floor reads it as a full page. `assertRendered` refuses that signature now, because the adopters
   still on `renderToString` are the ones who need it and they are exactly the ones not reading this.

   One cost comes with it, and it belongs beside the rule rather than in a bug report: under bun,
   importing that renderer holds the event loop open, so a prerender script that has written every
   file and printed its summary **will not exit on its own**. It ends with `process.exit(0)`.
   Measured by elimination, with no app code loaded: `react-dom/server` exits,
   `react-dom/static.browser` does not, node exits either way, and
   `process.getActiveResourcesInfo()` reports nothing — so the only symptom is a CI job that does
   all of its work and then runs to its timeout. A library must not call `exit` on its host, which
   is why this is written down in three places instead of fixed in one.

2. **A prerendered file names its own route**, and the entry hydrates only on a match.
   "Does the root have children" is the wrong question and getting it wrong is silent: a static
   host answers every address it does not publish with the nearest `404.html`, which has the
   not-found page rendered INTO it. Hydrating that is React reconciling two different pages — it
   recovers by throwing the tree away and logging, which is a page that works and a bug nobody
   sees.

   **And nothing random or clock-dependent may initialize prerendered state.** That is the same
   failure arriving from inside the tree instead of from the address. A front page whose hero did
   `useState(pickRandomIndex)` ran that initializer twice — once in the build, baking one variant
   into the file a crawler reads, and once in the browser, drawing another. One render, two
   independent draws, and React settles it by discarding the prerendered tree and redrawing: it
   looks perfect, and it costs the whole point of prerendering on the page that gets the most
   traffic. The tell is the only visible symptom and it is worth knowing on its own — **every build
   emits a different file**, so no byte-diff can separate a real change from a coin flip, and the
   verification a migration depends on quietly stops working. Three repos shipped it, and the
   third is the shape a search for `useState(` misses: suggestion chips sampled inside a `useMemo`,
   so search for the draw itself (`Math.random`), not for where it lands. Pick a constant, seed it,
   or move the draw into an effect that runs after mount — and for anything a reader aims at, take
   the constant, because the effect's swap lands just as the control becomes clickable.

3. **A failed refresh is not a dead session.** Only auth actually answering "no" signs anyone
   out; a network failure falls through and the request is retried. Collapsing the two means a
   Wi-Fi blip logs the user out mid-load. And a sign-out needs a fail-safe timer: awaiting
   `signOut()` before redirecting covers a rejection, not a hang, and a hang leaves someone
   signed out in name only — every request 401ing, nothing left that could redirect it.
4. **A failed query is not an answer.** `!me?.isStaff` reads a 500 as "not staff", so an
   operator arriving while `/auth/me` is down is told the page does not exist — the wrong cause,
   no retry, no request id to quote. A guard decides between waiting, failing and answering; only
   a real `false` reaches the refusal.
5. **Every address the app advertises answers 200 — on Cloudflare Pages, that means flat page
   files** (`pricing.html`), not `pricing/index.html`. Cloudflare Pages serves the directory form
   at `/pricing/` and answers `/pricing` with a 308 — so every address the app advertises in its
   canonical and its sitemap would be a redirect rather than a page. The file form is the host's
   call: Firebase Hosting redirects the other way by default and serves the directory form as
   itself with `trailingSlash: false`. A redirect costs twice, once for the crawler and once in the
   entry, where the address bar stops matching the route the file names (invariant 2).
6. **`og:locale` is not optional on a non-English page.** Absent, the Open Graph spec does not
   default it to "unknown" — it defaults to `en_US`, so a Portuguese page with a Portuguese
   `og:title` tells every share crawler the card is English.
7. **`isLoading` starts false where there is no window.** A session bootstrap can only be in
   flight in a browser. `true` during a build is a wait that never ends: it shipped a spinner as
   the indexable body of a page whose whole purpose was to be found.
8. **Never retry what waiting cannot fix, and when it says how long, believe it.** 402 and a
   durable 429 (`QUOTA_EXCEEDED`, `PAYMENT_REQUIRED`) clear by buying, not by waiting; retrying
   them burns another request against the limiter and says the same thing three times. Retry 408,
   a transient 429, 5xx, and no-response-at-all — nothing else.

   **Measured on the server side, where these are raised: of 13 raises of a 402 across five
   backends, none states a wait.** So the rule is not only a client-side policy — it is what every
   raiser in the fleet does today. Written that way on purpose: "no 402 in the fleet states a wait,
   in 13 raises" stays true forever, where "a 402 never states a wait" is a claim nobody measured
   and a card retry window or a transfer clearing overnight would contradict. The day an exception
   turns up it should read as a finding, not as this file being wrong — and the code already allows
   it, because the wait is available at every status.

   The number came out of building the same rule for the server
   kit, by counting raises rather than by arguing; and the count is worth more than its answer,
   because the same method answered three statuses three different ways. A 429 was the opposite
   (**34 of 40 raises already state a wait**, which is why a required argument was cheap there),
   and a 5xx was a third thing again (**16 of 94** — most of them "the database is unreachable",
   with no wait to state, so the wait stayed a capability and never became an obligation). One
   method, three answers, is what makes it evidence rather than a prior with a number stapled to
   it. Do not read the 429's 34-of-40 as agreeing with this rule: it counts a different thing,
   and quoting it here would suggest a 429 usually knows its wait, which is true, and that waiting
   therefore fixes it, which is the mistake the rule exists to stop.

   **And one axis this rule has never had: idempotency governs retry, not only transience.** A POST
   that failed with no answer may have succeeded, so retrying it duplicates; a GET cannot. One
   backend in the fleet writes it as `attempts: init.method === "POST" ? 1 : 3` and is the only
   copy anywhere that does. Everything above reasons about whether WAITING can help, which is the
   wrong question for a write: a transient 5xx on a charge is exactly the case this rule currently
   tells you to retry, and exactly the case where a retry can bill someone twice. Unless a request
   carries an idempotency key the server honours, a non-idempotent method gets one attempt.

   The second half arrived with the second migration: a refusal that states its own expiry has already answered the question, so a
   short wait is WAITED OUT (`retryDelay` takes the stated seconds over the backoff) and a long
   one is an answer (`shouldRetry` refuses past `maxRetryWaitSecs`, default 10s). Without it a
   per-minute limiter answering `Retry-After: 60` got retried at 1s and 2s — two more requests
   that could not succeed, charged against the same limiter, and three seconds of spinner before
   the screen said anything. **Read the wait from the HEADER first**: it is where HTTP puts it,
   and the package looked only in `details.retryAfterSecs` — one donor's body convention — so for
   every API that follows the spec, the one refusal that states its expiry read as silent.

   **And a reading that came from the other end of the fleet rather than from a donor: a refusal
   can state that waiting never helps AT ALL.** For a limit no amount of time clears — a
   concurrency slot that frees when somebody else's job ends, a cap on live objects that clears
   by archiving one — the server kit answers with an explicit body `retryAfterSecs` of `null`,
   and deliberately no header, because a `Retry-After` stating no time is worse than none. Its own words for why
   that is a value and not an omission: **"an omission is invisible in a diff; a `null` is a
   claim somebody has to read."** This package could not read it. `retryAfterSecs` answered
   `null` for "said nothing" and for "said never" alike, so `shouldRetry` fell through to the
   status and retried a 429 — and a durable 503 — that the server had explicitly said would never
   clear, while an adopter kept a `durableLimitCodes` entry for that one refusal, which is the
   hand-maintained list the server's `null` exists to delete. **Two halves of one fleet shipped
   one value with two readings, and each half is right about its own question.** So the fix is a
   second, narrow predicate rather than a wider return type: the countdown UIs reading
   `retryAfterSecs` want `null` for both cases and are correct to. Read the two halves of a fleet
   against each other the way two donors get read — a client that normalizes an explicit value
   into an absent one is where a server's deliberate claim disappears.

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
12. **A shell strips its canonical and its share URL, and names no card of its own.** Blanking
    is not stripping: an empty canonical is a claim about `""` and an empty `og:url` is a card
    pointing at the origin root. The image is the half that gets missed — one donor sets it
    before it branches on the shell, so its `404.html` advertises a card at
    `/og/__not-found__.png`, a file that has never existed. Every share of a missing address
    unfurls broken, and nothing in a browser shows it. **`bakeHead` strips the first two and
    cannot do the third**: it writes whatever `image` it is handed, and a shell with the brand
    card (`/og.png`, which exists) is correct, so an `image` beside `canonical: null` is not an
    error it can raise. The caller leaves `image` out. This invariant used to say the package
    "takes `og:image` with it", which the code never did.
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
  control boundary). One donor's was ~1.6:1, so every field border in two of its apps failed.
  Fixing the token did not reach its marketing site: that site passes its own `border-white/15`
  over the field, so it measured 1.5–1.8:1 until someone read the class string.
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

### Migration 1 (−513 lines, 12 commits)

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

### Migration 2 (−735 lines, 14 commits)

The first repo with three apps and a phone, and the first that is a **donor** rather than only an
adopter. That changes what a migration finds: instead of one app missing a lesson, there are two
siblings in one tree and only one of them ever got the fix.

- **A fleet-wide bug hid in `turbo.json`.** The `build` task hashed one env var, and the four
  `VITE_*` ones — which Vite **inlines into the bundle**, and one of which the prerender reads for
  every canonical, every `og:url` and the whole sitemap — were not in the hash. Staging and
  production pass different values. A build right after a staging build is a cache hit, so
  production ships pointing at `stg.` on every address and talking to the staging API, and nothing
  about it looks wrong. `"env": ["VITE_*"]` as a wildcard, because every variable with that prefix
  goes into the bundle by definition. **Every repo on this stack had the same file — all eleven
  carry the fix now (2026-09-11).** Check it only when a new repo joins the stack.
- **The sibling app is the finding.** Three times over, in one tree: the admin's own
  `isChunkLoadError` matched Chrome's phrasing and not Firefox's, so a stale deploy read as a hard
  crash on Firefox; the admin's `vite:preloadError` handler reloaded the whole page for a CSS
  _hint_ failure and swallowed real ones; and the admin's `themeStore` still read `localStorage`
  unguarded at module scope, the white screen the web app had fixed two days earlier. All three
  were already right in the app next door. Nothing merged them, so nothing found them.
- **The invariant-12 bug the audit read in this repo's code was live.** `404.html` advertised
  `og:image = /og/__not-found__.png`, a file the card generator has never rendered because it only
  renders pages in the registry. Same as the first adopter, found the same way — by reading the
  shell branch rather than the browser. (This bullet used to say "a THIRD repo". It was the donor
  invariant 12 describes, so it was the same repo, not a third.)
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
- **The dead code was in the CALLERS, not the file.** The app's second SSE transport carried a
  reconnect loop with backoff, a retry ceiling and three toasts — and both call sites passed
  `maxRetries: 0`, because the store above them has its own reconnect loop with its own deadline.
  Two dozen lines that had never run once, including a toast-per-attempt bug that could therefore
  never fire. Its `onClose` option was the same story: forwarded through two layers, set by nobody.
  Reading the file tells you what it does; reading its callers tells you what it does HERE.
- **A second transport does not stay a copy — it stays the OLD copy.** That same file had its own
  fetch, its own auth header, its own 401 retry and its own toasts, and not one fix made to the
  real client had ever reached it: the retry re-sent the token that had just been refused rather
  than refreshing it, nothing bounded the handshake, a dead session never redirected, and a fresh
  OAuth sign-in opened a stream before the account row existed. None of it was visible as a bug
  in that file — every line was reasonable when it was written. Routing it through the app's one
  client fixed four things at once and deleted 84 lines. It also killed the app's last
  `getAuthHeaders()`, which existed only to hand that transport a token.
- **Not migrating something is a result, and it is measured, not felt.** This repo's three auth
  stores are a strict superset of `createAuthStore`: each adds `isAnonymous` (denormalized from
  the user), and two add real product state the kit's fixed shape has no slot for — a
  post-login layout-restore guard, a one-shot sign-out notice. Adopting the factory would save
  about 25 lines and rewrite ~70 call sites (39 read `isAnonymous` off the store, 33 call
  `clearUser`). That is a migration that grows the risk and not the value, so it did not happen —
  and the finding is what the kit is missing, not that the adopter is wrong: a fixed store shape
  fits an app with no extras and nothing else. The first adopter's is one line; this one's cannot
  be.
- **A guard every adopter writes is a bug in the package.** Web, admin and mobile each checked
  `!message.startsWith("Request failed (")` before showing an error — three copies of one test
  against a string the PACKAGE writes, when an answer has no envelope and so no words of its own.
  The describer had no such check, so in the first adopter a gateway answering with HTML while the
  API restarts would put `Request failed (502)` on screen as the cause. The fix went into the
  describer (0.4.2) and all three copies were deleted. When the same defensive line shows up in
  every adopter, the thing it defends against is ours.
- **Describe at the edge that renders, never earlier.** The rewards store caught an API refusal,
  translated it, and rethrew `new Error(translatedText)` so a modal could show `err.message`.
  That works until anything reads the error as data: to a describer, an error that is not an
  `ApiError` is a request that never landed, so the modal would have said "check your internet"
  for "you already own this". Rethrow the error itself; turn it into words where it is shown.
  The same feature on the phone had its own translator, too, and the two disagreed about what an
  unknown code says — one showed the server's sentence, the other a flat "something went wrong".
- **The describer's one assumption is wrong for a second vendor.** Anything that is not an
  `ApiError` reads as "the request never landed", which is true for `fetch` and false for
  supabase-js: its `AuthError` is an answer, with a status and a `code`. Handed over as-is, a wrong
  password says "check your connection". This repo converts at its own edge — the `code` into an
  `ApiError`, the message dropped, because GoTrue's is English-only and often names the wrong
  cause — and resolves it under a second prefix. One adopter does not make that the kit's job;
  the second repo on Supabase Auth that needs the same six lines does.

### Migration 3 (−108 lines, 4 commits)

The first adopter on Firebase Hosting, the first whose apps have no react-query, and the first
whose CI runs no tests. Each of those moved a lesson somewhere it had not been before.

- **The file form is the host's call; the rule under it is not.** Invariant 5 said flat files,
  and that turned out to be a fact about Cloudflare Pages. Firebase Hosting redirects `/precos`
  to `/precos/` by default, and serves `precos/index.html` at `/precos` itself once
  `trailingSlash: false` is set. This adopter keeps the directory form, with the reason beside
  the line that names the file. Invariant 5 now leads with the rule that holds on both hosts: an
  address the app advertises answers 200.
- **The host's redirect also broke hydration, and nothing showed it.** Before that flag, the
  address bar said `/precos/` and the file said `/precos`. The entry compared them exactly, so
  every prerendered body was thrown away and drawn again, on a page that looks the same either
  way. The adopter had written its own slash-tolerant compare; `hydrateOrMount` has it now
  (0.4.4), so the next host cannot bring it back. The same adopter needed `null` for the other
  reader no file fits: its site prerenders one language and picks the reader's at runtime.
- **Invariant 12's bug was live in a third repo, and in this file.** The 404 advertised
  `/og/__not-found__.png`, a file its card generator has never rendered, and an `og:url` at the
  dead address. Reading the shell branch against the package found the other half: invariant 12
  said `canonical: null` "takes `og:image` with it", and the code never did. The docs were fixed,
  not the code, because a shell carrying the brand card is correct and `bakeHead` cannot tell a
  right `image` from a wrong one. The build can — an advertised card that is not a file in
  `dist/` — and now does: `assertOgImages(distDir, origin)` (0.4.6) reads the pages the build
  wrote and checks each card it advertises against the disk. It reads the OUTPUT rather than the
  registry on purpose, because the registry is exactly what the broken pages are missing from.
- **An old rig can know a tag the package does not.** This one wrote `og:image:alt` per page.
  `bakeHead` swapped the image and kept the template's alt, so every card would have been
  described with the front page's title, on the one tag written for somebody who cannot see the
  picture (0.4.4).
- **Check the deployed page, not only the diff.** Built before and after, every head was
  byte-identical except the 404's. `curl` on the live 404 then showed two robots tags: the
  template's `index, follow` and an appended `noindex`. The old rig appended it, and so did
  `bakeHead` — the extraction copied the bug faithfully. It now rewrites the template's tag
  (0.4.5). A byte-identical diff proves a migration kept the behaviour. It cannot tell you the
  behaviour was right.
- **Two donors named one way an i18n flag breaks; the third migration found the other.** Both
  donors' comments say `nonExplicitSupportedLngs` renders a region-coded `pt-BR` catalog in
  English. This adopter's catalogs use base codes, so its copy was right. But an `en-US` browser
  kept `"en-US"` as `i18n.language`, the site's `<html lang>` lookup keyed by `"en"` missed, and
  English and Spanish readers got `lang="pt-BR"` over their own language. The package's test had
  only asserted that the flag was absent. It now starts a real i18next and checks both the
  language and the catalog that answers, for both catalog shapes.
- **The package already had the fix; adopting it is what found the bug.** The shared error
  boundary reloaded after any chunk failure with no memory of having done it, so a chunk that was
  really gone reloaded the page every three seconds, forever, with the person inside.
  `reloadOnce` has guarded that since the audit. The same class's matcher missed
  Firefox's wording, the second hand-written matcher to do so after migration 2's sibling app,
  and it never cleared, so a crash on one screen was still there after the back button.
- **An error screen's words are a claim, and this one was false.** The crash page said the
  engineering team had already been notified. Nothing in the web app, the admin or the shared UI
  package reports an error anywhere. It now says what happened and what to do next.
- **Put a guard where CI will run it.** `--color-input` measured 1.12:1 in light, the third
  adopter of three under the token contract's floor, and the controls did not use it anyway: the
  shared ones drew `border-gray-300` at 1.24:1, and 21 fields bypassed the shared controls with
  class strings of their own. The first guard written was a contrast test. This repo's CI runs
  lint, typecheck and build, and no tests, so the test would have passed on a laptop and never
  run where it counts. The token generator refuses to write a value under 3:1 instead. **Read
  what CI runs before you choose where a check lives.**
- **Not migrating the transport, measured.** Web, admin and the phone each carry an axios client
  (525, 455 and 466 lines) that 29 service classes extend, with no react-query over them and no
  tests in CI. Replacing it means rewriting every service with nothing to catch a regression, so
  it waits for a migration of its own. Reading it still found four bugs for that list. It counts
  401s rather than failed refreshes and signs out on the third, so three requests that 401
  together sign the person out while the refresh they are waiting on is still in flight — the
  invariant 3 bug, reached a new way. Every web request carries a 16-minute timeout, sized for the
  largest report upload. With no token stored, a request still sends a `Bearer undefined`
  header. And a gateway 5xx with no body shows generic text.

  **All four were then fixed in place, and that is the lesson: a migration you decline still pays,
  if you write the bugs down.** None of the four needed the package. What they needed was somebody
  reading three copies of one file against each other, which is what a migration is even when it
  ends in "no". Two of them only came out that way: removing the 401 counter was impossible until
  the apps could tell a dead session from an unreachable one, and the counter turned out to be the
  only thing ending a dead session in the admin app — which had no dead-session path at all,
  because the app next door had one and nothing merged them. **The sibling app is the finding, for
  the third migration running.** The fix that landed is the one the package already teaches
  (invariant 3, `reachedAuth`), arrived at from the other end: not "adopt `createApiClient`", but
  "only auth answering no ends a session", applied to the transport the repo keeps.

- **`createAuthStore` met its second superset.** This adopter's store holds the session, a
  profile row, a remember-me choice that decides where the token is kept, and the sign-in methods
  themselves, with a React context beside it. Migration 2's stores added other fields for the
  same reason: the kit's shape is fixed and product state has nowhere to go. Two adopters in a
  row makes that the package's gap to close, not an adopter's quirk.

  Closed in 0.4.6, and the shape came from reading both supersets rather than from the phrase
  "extension point". `createAuthStore` owns its `create()` call, so it owns the whole store: no
  middleware, no extra action, no extra field. `authSlice` returns the same flags as a plain
  object to spread, and the adopter keeps `create`. The second argument is the part a generic
  slot would have missed — migration 2's stores derive `isAnonymous` from the user, which means
  it has to be rewritten by `setUser` and `clear`, the two writes the product no longer owns.
  That flips migration 2's measurement: the ~70 call sites it would have had to rewrite were
  only in play because `isAnonymous` had nowhere to live. **The gap was not "a fixed shape", it
  was "a fixed shape AND fixed writers"** — and only the second one costs call sites. The other
  superset still does not adopt, and that is the honest result: a 235-line store of sign-in
  methods under `persist` is product code that happens to hold a session, not plumbing.

### Migration 4 (−233 lines, 3 commits)

The first adopter that was **ahead of the package**, and that changes what a migration produces:
three separate fixes landed in the package FIRST, because adopting it unpatched would have been a
regression. A migration is not only "what does this repo lack" — it is also "what does the package
still get wrong, that only this repo's shape reveals".

- **Two guards for one regression, and neither could fire.** `assertRendered` refuses a page whose
  body is a loading screen. This adopter's looked for a spinner class its splash does not use. The
  package's was anchored at the root's FIRST tag and would have missed it too, because this splash
  centres its live region inside a `<main>`. Two independent checks against one failure, both
  written carefully, both dead. **A guard that has never fired is not evidence that it works** —
  and the only way to find out is to feed it the thing it is supposed to catch. Fixed in the
  package first (0.4.7).
- **A tag the package wrote in one spelling only.** `bakeHead` matched the `twitter:` tags by
  `property=`; this adopter's template spells them `name=`. `String.replace` with no match
  succeeds, so adopting it unpatched would have frozen all 48 prerendered files at the front door's
  card, in three languages, with nothing in a browser to show it. It now writes whichever attribute
  the template carries (0.4.7). Same class as the canonical bug in migration 1: a silent no-op is
  worse than a missing feature.
- **A guard can be worth adopting where it finds nothing.** `assertOgImages` reads every advertised
  card against the disk. This adopter passes it today, because it advertises one brand card
  everywhere — so it is not a fix here. It is what stops a per-page card quietly reintroducing the
  bug three sibling repos shipped. **"Already correct" is a reason to take the guard, not to skip
  it**, because what it pins is the thing a future change would break.
- **The file that decides every published page was typechecked by nothing.** `scripts/` was in no
  tsconfig's `include`, so neither `tsc -b` nor CI ever read the rig that writes every head, every
  canonical and the sitemap. It is in `tsconfig.node.json` now, which extends the React config
  because a prerender is a Node process that typechecks browser code. Read what your tsconfig
  actually covers; an `include` that misses a directory fails by saying nothing at all.
- **One predicament, three detectors, and the guard belongs to the tab.** A deploy landing under an
  open tab breaks it two ways and only one looks like a missing file: the next navigation asks for
  a chunk whose hash is gone, or the old bundle reads a field the API has renamed and throws a bare
  `TypeError`. Message matching is blind to the second by construction, so the server probe two
  adopters had written independently came up as `isStaleBuild`. It asks for the **page**, never the
  asset — a CDN serves assets with a long `s-maxage`, so a bundle retired an hour ago still answers
  200 from the edge and would report "current" during exactly the window when skew is likeliest.
  The two donors disagreed on the comparison, and the tiebreak was the failure DIRECTION: the
  anchored `src="…"` match is more precise and breaks if anything rewrites the markup on the way
  out, where a minifier changing quote style is enough — and breaking there reports a healthy tab
  as stale, a reload nobody can refuse.

  The rename is the half the adoption uncovered. Three detectors for one predicament, each with its
  own once-a-minute key, hands a broken deploy three reloads a minute to take turns with — which is
  exactly what this adopter would have got, its own probe on one key and the package's on another,
  each resetting the other's clock. `reloadOnceForChunkError` → `reloadOnce`, one key
  (`frontkit:reload-at`), exported because the one caller that cannot import it is an inline
  `<script>`. Breaking, so 0.5.0 — and a caret on a 0.x does not cross a minor, so the adopters on
  `^0.4.x` were untouched until they bump deliberately. **Check the range before paying for
  compatibility you do not owe.**

- **The deepest fix was in host config, which no package can ship.** A static host answers a missing
  `/assets/x.js` with the SPA fallback — `index.html`, 200, `text/html` — and that IS the browser's
  "MIME type text/html" module refusal. Hosts then match cache rules against the REQUEST PATH
  rather than the outcome, so an `immutable, max-age=31536000` rule written for hashed assets lands
  on that HTML body and poisons one asset URL for a year. This adopter removed the cause at the
  edge, with middleware turning a guarded miss into a real, uncacheable 404; a sibling repo built
  three layers of recovery around a cause it never removed. The package cannot ship either one, so
  the module doc and the README name it. **A package that cannot fix a cause can still refuse to
  let it go unwritten.**
- **`tsc` never removes output it did not just write.** `@gusnips/react@0.5.0` reached the registry
  carrying both `deploy-recovery.js` and the `chunk-reload.js` it replaced, because every package
  built with a bare `tsc` and `files: ["dist"]` ships whatever is sitting there. The dead copy was
  unreachable through the exports map — which is what made it worth fixing rather than shrugging
  at, because it still declared the old key that very release existed to remove, in a published
  artifact for somebody to grep a year from now and believe. Builds clean `dist/` first, and
  `release:check` now reads the packed tarball for `dist` files with no `src` behind them: a clean
  script is a claim about a command, the tarball is what the registry receives. **Verified by
  watching the new check fail before fixing what it caught** — against the dirty tree it named
  `dist/chunk-reload.*` and nothing else, with no false positive on the nested `react/src/ui/*` nor
  on `tokens`, which emits no `dist` at all.
- **The package shipped a bug this adopter had already avoided.** `i18nInitOptions` hardcoded
  `caches: ["localStorage"]`, so the detector wrote the stored locale back on every
  `changeLanguage`. That is right until an app offers "follow the browser": reaching that state
  means clearing the key and detecting again, and a caching detector writes the language it just
  detected straight into the key it was told to clear, so the choice re-pins itself and the option
  becomes unreachable. Three repos on this stack answer this three ways — the detector writes, the
  app writes, or both do — and the third is harmless only where there is no "follow the browser"
  state to break, which is how one hardcoded answer survived this long. `storageWriter: "app"`
  turns the write off and leaves the read alone (0.5.2). One writer per key, the same rule the
  reload guard arrived at from the other end.
- **A measurement that came out against the hypothesis, and that is the result.** The expectation
  was that this adopter's optional `detail` would challenge `EmptyStateProps.description` being
  required. Every one of its twelve empty-state call sites passes it, so the required field is
  confirmed rather than contradicted. The contract still did not get adopted — this adopter's prop
  names differ (`detail`, `children`, `footer`), so taking the type means renaming across twelve
  files for no behaviour change. Two honest outcomes from one reading, and neither is a commit.
- **A describer worth more than ours, and the answer was neither donor's design.** This adopter
  routes failures to catalog KEYS, carries a machine-readable recovery kind, and keeps the raw
  provider string; `createErrorDescriber` returned two resolved strings. Three differences,
  measured — and only two were worth anything, which is why this landed additive (0.5.3) rather
  than as the breaking rewrite it first looked like.

  **`recover` is the one that mattered, and copying the adopter would have been the wrong fix.**
  Both donors hardcode a recovery per error code, beside a `shouldRetry` already answering the
  same question for react-query. Two answers to one question drift, and this drift is visible: a
  screen offering "try again" for a refusal the query layer has already refused to retry, so the
  button does nothing and the reader presses it twice. So it is DERIVED from `shouldRetry` —
  one rule, two consumers, invariant 8 owning both. An arm can still narrow it, which is exactly
  what a spent quota needs: a 429 the rule would otherwise call `"wait"`.

  `reference` is the second, and it was free. `ErrorStateProps` has reserved a slot for a request
  id since the contract was written and nothing ever produced one to put in it. The same pass
  finally reads `expected` — the flag on the 401 the CLIENT raises during sign-out — so an error
  surface stops offering a retry for something nobody broke.

  The third, keys instead of prose, was **declined**, and that is the honest half. The package's
  `t` re-resolves at the render edge, which migration 2 had already made a rule; its tests assert
  key identity through an echoing `t`, so the adopter's purity argument is weaker against us than
  it reads; and converting the arms in the two repos that call it is a real rewrite, one of them
  nesting a `t()` inside a hint. **The gap was never the return type — it was a decision the type
  had no room for**, and a decision fits beside prose without replacing it.

### Migration 5 (−55 lines, 4 commits)

The first adopter whose migration turned up a bug that was **live on a public, indexed page**, and
the first where two separate declines were each worth more than the adoption would have been.

- **The same bug, in a second repo, in a file with the same path.** Its brand-variable substituter
  declared six placeholder names and matched three of them in the regex beside it, so the legal
  entity, its registration number and its address were substituted nowhere. The Terms and the
  Privacy policy told readers, in all three languages, that the service is operated by
  `{{legalEntity}}` (registration `{{legalEntityCnpj}}`). Measured on the deployed site before the
  fix: 36 raw placeholders across six prerendered pages — the same count as the earlier repo with
  the identical defect. What hides it in both is that `{{brand}}` on the neighbouring line resolves
  correctly, so half the placeholders work and the page reads as fine everywhere anyone looks.
  `applyBrandVars` derives its pattern from `Object.keys(vars)`, so adopting it fixes the class and
  not the instance: **a var you supply is a var that gets filled.** The second occurrence is what
  proves that derivation was the right fix rather than over-engineering — the first one only proved
  somebody had made a typo.
- **A decline can name the package's next gap more precisely than an adoption would.** `authSlice`
  did not land here, and measuring why found the seam it is missing. `derive(user)` covers product
  state COMPUTED FROM the user. This adopter holds an operator-impersonation token that is not
  computed from the user — it comes from session storage and an admin action — yet sign-out must
  still reset it AND remove its storage key, because that token is bound to the operator's own
  session. `clear` is a fixed writer with no seam for that, and spreading an override after the
  slice leaves a live `clear()` that does NOT end the impersonation sitting beside the app's own
  `clearUser()` that does: a sign-out footgun worse than the duplication it would remove. That is
  the **second** instance in the fleet — another repo's store carries a one-shot sign-out notice,
  which is the same class of state. **It was deliberately not built**, and that is the other half:
  unlike the gap `authSlice` itself closed, closing this one would produce no adoption today, so
  designing the seam now would be designing ahead of the code.
- **A measured decline needs a ratio, not a feeling.** `cn` is two byte-identical seven-line copies
  in one repo and the package ships the same function. Adopting it saves six lines and touches 168
  files — a worse ratio than an adoption already declined at ~25 lines for ~70 call sites. Nothing
  in it can drift, either: no options, no config, no product decision, which is exactly why all ten
  repos wrote it identically. And in a shared tree the purely mechanical rewrite is the change most
  likely to collide with work you cannot see.
- **The adopter's own test named the right home for a shared constant.** The list of refusals that
  do not clear by waiting is taken twice — once to decide whether to retry, once to decide which
  control to offer — so it has to be declared once. It went into the query client first, which put
  shared DATA inside the module that constructs a side-effectful singleton. A store test that mocks
  that module wholesale then read the constant as `undefined`. The failure was the altitude error
  talking: it belongs beside the error-code union it describes, where the comment stating the rule
  already lived, and where nothing has to be instantiated to read it.
- **A net-POSITIVE slice can still be right, and saying so beats hiding it.** The describer returns
  four things; this app rendered one, so the package was computing "what to do about it" and every
  error surface dropped it — 53 of them, all fixed in one file, because all four come from the one
  call that already yielded the cause. That slice is +29 lines. The net-negative rule is about a
  migration, and its reason is duplication: an adopter that GROWS because the cut line was drawn
  wrong. Rendering output the package already computes is not that, and the honest move is to state
  the number and the reason rather than pad the diff elsewhere. The migration closed at −55.
- **Check the vendor's own entry before adding a dependency — and resolve it the way the app
  does.** Invariant 3 needs the auth library's retryable-error predicate, and the module doc
  suggested an adapter. The first check, run with `node` from the repo root, reported the symbol
  missing and looked like proof a new dependency was needed. It was not: the package is hoisted
  into a store that node's resolver cannot walk from there, and the vendor's main entry re-exports
  the auth package wholesale. Re-run through the app's OWN resolver, the answer flipped and the
  dependency was already present. **A resolution check is only evidence when it resolves the way
  the consumer will.**

### Migration 6 (−282 lines, 5 commits)

The first adopter already running the package in three apps before the migration started, and the
first whose migration caught the package **contradicting itself** — two halves of one contract,
shipped in the same tarball, disagreeing about the name of a field.

- **A line every adopter writes is a fact the package failed to record.** Six prerender scripts
  across five adopters already ended with `process.exit(0)`, and every one of them was written
  against a DIFFERENT holder: an auth client whose token-refresh timer starts at module scope.
  None of them knew the renderer invariant 1 requires does it too, so the sixth adopter
  rediscovered it from scratch — through three refuted hypotheses and two builds killed by hand.
  This is migration 2's rule ("a guard every adopter writes is a bug in the package") arriving
  from the other end: the package could not fix the cause, so what it owed was the sentence.
- **A rename adapter in every adopter is an API we got wrong.** `ErrorStateProps` — the contract
  this package ships for the component that renders a described error — has always called the
  second half `fix`, while the describer returned `hint`. Every adopter wrote `fix={hint}` at
  every error surface, and `states.ts` had been documenting a `fix` the describer never returned.
  The tell that the rename was right rather than merely tidy: it made an existing doc comment
  TRUE instead of forcing an edit. It also cleared a collision, because in an adopter a form
  field's `hint` is the requirement text under the input.
- **A default whose price is invisible is not a kindness.** The describer humanized a stated wait
  itself, which put three ICU plural keys into the key union of every adopter's `t` whether or not
  a wait was ever rendered. Measured for one adopter through `Intl.PluralRules`, that is **24
  catalog entries** — three keys across one language's two plural categories and two languages'
  three — to satisfy a compiler for copy it already formatted correctly with
  `Intl.RelativeTimeFormat`. `formatWait` is required rather than defaulted, so the catalog you
  need is the one you can see; `humanizeWait` is still exported and is now what you pass.
- **The drift was real and ran the opposite way from the prediction.** The expectation was a "try
  again" offered for a refusal the query layer refuses to retry. Measured, it was the reverse: two
  503s that never clear on their own were shown as "write to us, no retry" while `shouldRetry`,
  seeing only a 5xx, spent two more requests and about three seconds of spinner on each. Deriving
  the button from the retry rule is what surfaced it, and the fix was one shared list rather than
  either consumer changing its mind.
- **A code that means two things is a contract gap, not a client decision.** A third 503 in that
  same family has two raisers — "not configured on this deployment" (durable) and "did not answer
  just now", which the server tags `severity: "transient"`. The envelope carries no severity, so
  the client cannot separate them and would be wrong for half the cases whichever way it chose. It
  stayed off the list, with the reason written beside the list. **Declining to guess is an
  outcome; leaving the guess undocumented is not.**
- **A bug class checked and found absent is a result worth the reading.** Migration 5's brand-var
  substituter bug — names declared but not matched, so legal text shipped raw placeholders — was
  checked here against the same file shape: four names declared, four matched. Clean. The check
  cost minutes and the alternative was assuming.
- **A byte-diff that changes files is a question, not a verdict.** 82 of 88 prerendered pages came
  out identical, asset hashes unmoved. The six that differed were the 404 shells, which now keep
  the brand `og:image` the template declares where the old rig stripped it — correct per invariant
  12, but only because the advertised card is a real file, which was checked on disk rather than
  assumed. Three sibling repos shipped that same tag pointing at a card that never existed.
- **`scripts/` typechecked by nothing, for the second migration running.** Both apps ran
  `typecheck` against their app tsconfig alone, so the `tsconfig.node.json` beside it — and with
  it every script that writes a head, a canonical and a sitemap — never executed at all. Migration
  4 found this in one repo and it was not a quirk of that repo.
- **Piping a build through `tail` throws away its exit code.** The pipeline reports `tail`'s
  status, so an `&&` chain advances past a failed build and a "completed, exit 0" notification
  means nothing. Two of this migration's dead ends trace to that one habit, including a "hang"
  that was a finished build waiting on the event loop above.

### Migration 7 (14 commits: −169 source across the adoptions, +125 over the range)

The first migration whose total came out **positive**, which made the accounting itself the
finding. Also the first adopter whose auth store was a clean SUBSET of the kit's rather than a
superset — the case three earlier migrations each declined for the opposite reason.

- **"Net-negative" has to name WHAT is counted and WHICH commits.** This range is +125 lines, and
  every part of that is fine once it is split. The seven commits that actually swap the adopter's
  code for this package are **−169 lines of source**. Tests are **+102, in two files** — a
  rewritten describer test and a guard test for behaviour nobody in the fleet had pinned. The
  remaining +178 is not an adoption at all: three live bug fixes, one prep refactor, and a
  cross-origin capability that did not exist before. Reaching a negative total would have meant
  deleting tests or leaving bugs alone. Measure the adoption commits, in source, and state the
  rest out loud.
- **The same dead-looking code meant the opposite thing here, and the SERVER is what said so.**
  Migration 2 found a reconnect loop with backoff and a retry ceiling that had never run once,
  because both callers disabled it. This adopter's stream client has that same shape and it is
  load-bearing in a way no caller reveals: the server ends any stream older than its ceiling
  **with no terminal frame, on purpose** — "a clean close mid-run reads as a dropped socket, which
  is exactly what we want", because an error frame would end the client's watching. The reconnect
  IS the continuation path for a long run, resuming from `Last-Event-ID`. Reading the callers
  answered migration 2; reading the producer answered this one. When a shape is ambiguous, the
  other end of the wire is the authority, and it often already has the comment.
- **Read the serializer, not the emitters.** The blocking question was whether that wire ever
  carries a frame with no `data:` line, which this package's parser drops by design. Grepping the
  code that emits frames was the wrong move and cost two passes: every frame there funnels through
  ONE `write` that always sends `data: JSON.stringify(...)`. One file answered for all of them,
  and handed over the rest of the slice's facts on the way — a 15-second heartbeat, and an `id`
  only where the producer numbers frames.
- **Two package bugs, found by the function-by-function read, neither visible in a green suite.**
  The describer gated known message keys on `Object.keys`, and i18next stores a plural as
  `name_one`/`name_other` while a server names the BASE — so **2 of that API's 112 thrown keys**,
  both plan limits, would have fallen back to the server's English at exactly the moment the
  specific sentence is the whole value. And the unmapped-code arm hands the reader `error.message`,
  which is right for the API of migration 2 (where the code names the copy) and exactly wrong for
  an adopter whose own docs call `message` the English line for the log: every coded 4xx with no
  key would have put developer English on screen in a three-language product. Both fixed in the
  package first (`fallback` takes an arm; the gate admits plural bases). **The old file's tests all
  passed against the old file** — which is the blind spot that rule exists for.
- **A language crosses in the URL or it does not cross.** A storefront and the app it sells are
  different origins, so they share no `localStorage` however identically the key is spelled — and
  a reader who picks a language on one and clicks through gets the browser's guess on the other,
  turning a choice they just made into a guess. `queryKey` exists for this. The half that is easy
  to miss: **a GET form REPLACES its action URL's query with its own field set**, so a language
  carried in the action is discarded the moment the form submits — on precisely the no-JavaScript
  path that is the reason the form is a real form. It rides as a hidden input or it does not ride.
- **React 19's static render writes the PROP name, not the attribute name.** `hrefLang="es"`
  reaches the HTML in camelCase. Browsers parse attribute names case-insensitively so the page is
  correct, and every grep written for the real spelling reports zero — which is how a verifier came
  back saying a build had no language links when it had all of them. Grep the built output for what
  React EMITS, not for what the spec calls it.
- **The first auth store that was a subset, and it still closed a gap.** The factory went in
  outright with zero call-site changes, because the adopter's guards were already taking that store
  as `SessionState`. What it fixed on the way is the thing the factory's own doc predicts: the
  package's `setUser` ends the loading state in the same write, where this store left `isLoading`
  alone and relied on a separate call. Here that call covered the boot lookup and **nothing covered
  the other path** — a session arriving through the auth channel while the lookup was still in
  flight set the user and left every guard on its loading screen. Three declines made the factory
  look like the wrong shape; the first subset showed the shape was right and the adopters were
  supersets.
- **A dead export survives a green gate when the tool calls it a hint.** A deleted module left its
  subpath behind in a package's export map. Nothing imported it, so nothing broke, and the dead-code
  check reported it as a configuration hint rather than an error — which is exactly how an entry
  like that outlives the person who remembers what it was for. An export map is a claim about what
  a package offers; this one advertised a module whose removal was the point of the commit.
- **`%CPU` is a lifetime average, and the evidence dies with the process.** A gate hung for
  12m40s and `ps` reported the stuck process at 99.9% CPU, which reads as an infinite loop. It was
  not: macOS averages `%CPU` over a process's whole life, and a `sample` showed every thread parked
  — blocked, not spinning. Sample before you kill. Two more from the same hour: a killed gate exits
  **143**, which is not a failing gate and must not be read as one, and zsh does not word-split, so
  a watchdog stashed in a variable is looked up as a command with a space in its name.

### Migration 8 (−185 lines, 6 commits)

The first adopter whose own rigs were good enough that the migration looked, going in, like pure
deduplication. It produced the strongest finding in the project so far, out of a file nobody had a
reason to open.

- **`renderToString` does not only render the fallback. It renders its own ERROR, into the page.**
  Invariant 1 had the gentle half. What this adopter shipped on a live, indexed reference page was
  React's "The server used renderToString which does not support Suspense" message, a stack trace,
  and five copies of an absolute path from the machine that ran the build. Nothing in a browser
  shows it — the bundle replaces the body on load — so the only readers who ever saw it are the
  ones who run no JavaScript, which is every crawler the prerender exists to serve. **It was in one
  of the page's two languages**, and that is the half nobody would guess: the first render suspends
  and bails, but it also resolves the `lazy()` promise, so the next locale in the same loop rendered
  the real component and looked perfect. One loop, two versions of one address, one a stack trace.
  Every cheap check passes it because the error text makes the file BIGGER — a size floor reads it
  as a full page, and the splash check is gated on a small file for the reason that gate exists.
  `assertRendered` refuses the signature now (0.8.1); it can only fire for an entry still on
  `renderToString`, which is the point, because those are the repos that have not read this.
- **A blocker dissolved by two commands that the audit had reasoned about for a paragraph.** The
  plan said adopting `renderTree` could hang the docs build, because the reference route fetches a
  live document and `react-dom/static` resolves Suspense where `renderToString` does not. Measured:
  the renderer imports fine with no DOM, and the hook behind it is an ordinary effect-driven state
  machine, so a build renders its loading branch and never touches the network. The guess cost a
  paragraph; checking it cost two commands. **Measure the blocker before you design around it.**
- **A slice order drawn from an audit can be wrong about a dependency the audit never had to
  execute.** The plan put the retry rule first and the transport second. Impossible: the kit's
  `shouldRetry` narrows on the kit's `ApiError` and the app still threw its own, so the drift could
  not be fixed until the transport landed. Reordered on contact with the code.
- **The green gate caught neither regression the manual read caught.** Swapping the transport made
  `String(error.code)` print the literal word "undefined" beside a request id (the old class always
  had a code; the kit's leaves it absent when there is no envelope), and made the transport's own
  `Request failed (502)` the sentence shown as the problem. Both shipped past a full green suite.
  This is the rule at the end of this file, earning itself again.
- **The third repo with the split-origin language bug — and the fix was already in the package.**
  `queryKey` was written for one donor with a storefront and an app on separate origins. This
  adopter has the same layout and the same hole: `localStorage` is per-origin, so one key NAME with
  three stores behind it, and a reader who picked a language on the storefront landed in English
  across ten links. Its own comment had concluded a cookie was what that would take. The whole
  point is the third repo, again.
- **An adopter AHEAD of the package, recorded rather than built.** `resolveKey` returns the KEY on a
  miss; this adopter's equivalent throws. At a call site feeding `<title>` and `description`,
  returning the key ships a raw catalog key to a crawler on a live page. The adopter is right and
  the package is weaker — but it can do this itself in fifteen lines, so it stays a note. One
  adopter's stricter policy is not yet the package's gap.
- **Invariant 15, reached from the adopter's side.** `pageSlug` and `ogImagePath` are byte-
  equivalent to the package's and were still declined: the adopter's page registry is import-free
  ON PURPOSE so the browser bundle can read it, and those helpers sit in the barrel whose node
  module imports `node:fs`. Taking them would pull Node into a browser bundle. **The rule cuts both
  ways — sometimes the adopter is the one who must not import.**
- **A note in your own roadmap ages like any other comment.** The constraint was written down as
  "81 non-frontend importers". Re-measured while checking it: 150 importers, 44 in the frontends,
  so 106. The constraint was stronger than its own record. Re-read before quoting yourself.
- **When a migration changes every file, assert the SHAPE of the change.** Adopting the shared rig
  moved `og:locale` from replaced-in-place to stripped-and-appended, so all 38 prerendered pages
  differed and a file-by-file read would have been theatre. The check that meant something was
  mechanical: normalise the bundle hashes, then assert that **no changed line was anything but a
  console href** — 38 changed, 0 unexpected. A diff too big to read is not a diff you skip; it is
  one you write a predicate for.
- **Two slices were net POSITIVE on purpose, and saying so is the point.** A crash screen and a
  language that survives a subdomain hop are capabilities the repo did not have at all; a blank
  page costs zero lines. Migration 5 settled that this is not the duplication the net-negative rule
  exists to catch. The migration closed at −185 without anything being trimmed to get there.
- **`git diff --name-only` cannot see a file git has never seen.** Formatting the changed files
  through that pipeline silently skipped the one new test, and the gate failed on it. A "changed
  files" pipeline that feeds a formatter needs the untracked ones too.

### Migration 9 (−81 lines, 3 commits)

The last of the nine, the smallest, and the first where the package had to correct **itself** —
twice, once for a comment it had inherited and once for a claim this migration put into an
adopter's history before measuring it.

- **A grep proxy is not a measurement, and it was wrong three times in one sitting.** The sweep
  asked "does this entry-server call `renderTree`" and reported 17 of 19 as still on
  `renderToString` — an alarm that would have opened pull requests against a dozen healthy repos.
  Re-asked as "what does this file actually import", the answer was **zero**: seven go through the
  package, twelve reach `react-dom/static` directly, pre-kit. The follow-up query repeated the
  error one level down, matching the word `renderToString` inside comments explaining why the file
  does not use it; a third pass counted `lazy(` in a comment saying no route is lazy. What settled
  it was the built output — grep every `dist/` for React's own error sentence — after the detector
  was first run against a file known to contain it. **A search that returns nothing proves nothing
  until you have watched it find something.**
- **A guard's reach is the caret, not the publish.** The `renderToString` check shipped in
  `@gusnips/vite@0.8.1` and was written specifically for adopters who have not migrated. They sit
  at `^0.4.3`, `^0.4.6`, `^0.5.2`, `^0.5.4`, `^0.6.0` and `^0.6.2`, and a caret on a 0.x does not
  cross a minor — so **not one of them can receive it**, and the only repo that can is the one that
  no longer needs it. Migration 4 learned to check the range before paying for compatibility; this
  is the same fact from the other side. A guard reaches nobody until each repo deliberately bumps,
  which makes the bump the deliverable, not the guard.
- **The comment that was wrong, and the six lines it cost.** This rig carried a second meta setter
  because a comment said the first one's pattern "cannot see" a tag whose attributes span three
  lines. `[^>]*` is a negated character class; it matches newlines. Run against the real template,
  both patterns match every multi-line tag in it, and the second one's is strictly the narrower.
  Two call sites and six lines for a problem that never existed — and the test beside them asserted
  the behaviour while crediting it to the wrong function.
- **And the one this migration got wrong itself.** `pageFile`'s comment said a flat file is served
  at `/pricing` AND `/pricing/`, "200 either way". That sentence was repeated into an adopter's
  commit message as a live hydration bug. `curl -I` on the deployment: the slashed form answers
  **308** with `location:` the unslashed one, which then answers 200. The host normalizes before
  the bundle runs, so the slash-tolerant compare **cannot fire there at all**. The rule survives —
  the advertised form is the one that must be a page, and it is — but the parenthetical was a donor
  comment nobody had checked, and the README's own next paragraph says to run that `curl -I`.
  Adopting the shared compare is still right; claiming it fixed something live was not.
- **The sibling finding, inside a single file tree.** One screen refuses to navigate on an
  unconfirmed session and writes down why: "navigating anyway would bounce the just-authenticated
  user back to login with no explanation." The gate next door read _every_ `/me` failure as "signed
  out" — a 401, a dropped connection and a 502 mid-deploy all landing on one `setMe(null)` — and
  redirected to the login form. So a signed-in person on a flaky connection was sent to sign in
  again, to fix a session that was never broken. Invariant 3, reached a fourth way, in a context
  provider rather than a transport, with the fix already written one file away.
- **A verification script is code, and it can be wrong in the direction that flatters you.** The
  bundle-hash normaliser behind the byte diff excluded `-` from its hash class, and Vite's
  base64url hashes contain one. It reported 11 changed files where there were 3 — and it had passed
  the earlier run only because that build's hashes happened to have no internal hyphen. Migration
  4's "a guard that has never fired is not evidence that it works", applied to the tooling doing
  the checking.
- **Four measured declines, one of them a first.** The token package: this brand's vocabulary is
  entirely its own and shares **zero** of the 19 semantic names, so there is nothing to override —
  and with no `--color-input` at all, the contrast floor three earlier migrations failed has no
  instance here. The vite preset: a 7-line config, no placeholders, and **0** imports through the
  `@` alias it would add. The auth store: a React context, with no zustand in the catalog. The
  error describer: it needs a `t` and a catalog of known keys, and this app has no i18n at all —
  one language, written in place. And `cn`, which has **0 call sites**: the first adopter where the
  answer is not a ratio but an absence.
- **What the donor knew that the package did not take.** Its prerender reads the site's origin out
  of the canonical the template declares, rather than from an env var the script would have to
  resolve — one file is the answer for the head Vite ships and for every file written after it, and
  there is no second place for a domain to drift to. Kept as-is. Its `process.exit(0)` comment also
  documents the bun idle-hang independently, from the symptom end, where the package documents it
  from the cause end.
- **Adopting a generator can be proved by the bytes it replaces.** `robotsTxt` took over a static
  file that had the origin typed into it a second time, and the generated output was
  **byte-identical**. That is the whole argument: no behaviour changed, and one place a domain
  could drift is gone.
- **The rig swap was −256; the migration closed at −81.** Two slices added capability the app did
  not have — an error state that states its cause instead of bouncing, and a crash screen instead
  of a white page — and they are stated rather than trimmed to. Migration 5 settled that this is
  not the duplication the net-negative rule exists to catch. Verified the same way migration 8 was:
  normalise the bundle hashes, then assert no changed line is anything but the two deliberate ones
  — 9 of 12 files byte-identical, 3 changed, 0 unexplained.
- **A boundary belongs outside the router, and out of the prerender.** Outside the router because
  the session provider every screen renders under throws before any route does; out of
  `entry-server.tsx` because a boundary inside a prerendered tree can bake its own crash screen into
  the file as that page's indexable body. Both checked against the written output, not reasoned
  about: no prerendered file contains a crash string. The placement has a consequence the fallback
  has to respect — with no router context, every link in it is a plain `<a>`, or it throws inside
  the screen that exists to handle a throw.

### Migrations 10–12 (three sibling repos, −196 source each, one reading)

Three repos that are one product under three brands, and the first time ONE migration's reading
served three adoptions. Their prerender rigs differed by a 404 title and two comment lines, so the
slice that landed in the first applied to the other two verbatim. That is what collapsing the fork
was supposed to buy, obtained through the package instead of through a repo merge.

- **The roadmap's own numbers had aged, and re-measuring changed the track.** It recorded 558
  byte-identical files, a `packages/ui` identical file-for-file, and ~3,050 lines of plumbing each,
  and concluded the three should be merged into one repo. Measured: **429** source files identical
  across all three of ~1,750 shared paths — a quarter, not a fork — with 45 of ~74 `packages/ui`
  files identical, 1,213 shared paths differing between just two of them, and **two of the three
  sharing no git history with the third at all**. The collapse is a multi-week merge; the adoption
  was an afternoon. Migration 8's rule about quoting yourself applies to a plan, not just a comment.
- **Invariant 12, occurrences four, five and six — and this time the code said why.** All three
  advertised `/og/__not-found__.png` on their 404, a file each card generator has never rendered
  because it only renders pages in the registry. The mechanism was one line: the image was computed
  BEFORE the branch that decides a page is a shell, so the shell stripped the canonical and both
  share URLs and kept the card. Six repos now, and the fix is the absence of an argument.
- **Migration 3's double-robots bug, also in all three.** The old rig APPENDED
  `<meta name="robots" content="noindex">` beside the template's `index, follow`, so every 404
  shipped two contradictory tags and left the tie-break to each crawler's own rule. Written down in
  0.4.5, and found in three more repos the first time anyone read the bytes rather than the diff.
- **Grep the sentence — but a paraphrase survives the grep.** The house rule says correcting a
  comment means grepping for its sentence. The flat-file sentence corrected one release earlier had
  three more verbatim copies, which the grep found, and a FOURTH in a test comment phrased
  differently, which it did not. That one surfaced only because the file was being rewritten anyway.
  A wrong idea spreads in paraphrase, and no exact-match search will ever find that copy.
- **A build that changes every run is not a failed migration — it is a measurement problem, with a
  real bug under it.** Two of the three baked a RANDOMLY CHOSEN demo conversation into the front
  page, via `useState(pickRandomIndex)`. Two builds of byte-identical source produced two different
  names, so the byte-diff that proves a migration lost nothing could not run on `index.html` at all.
  What proved it instead was rebuilding until the same variant came up and comparing then —
  byte-identical on the fourth try in one repo and the fifth in the other. The bug underneath is
  worse than the noise it makes: a random value used as SSR state cannot agree with the client's
  first render, so the front page hydrates against markup that is not a render of its own state.
  Both are fixed, and the fix carries its own check: two consecutive builds of one source now emit
  a byte-identical `index.html`, which is worth running against any prerendered page. The rule went
  into invariant 2, because that is what it is — invariant 2 reached from a direction no route
  check can see.
- **Strip before you measure, not after.** The old rigs removed the FAQ JSON-LD from the BAKED page
  while `assertRendered` compared that page against the UNstripped template — so the growth floor
  measured two different documents, short by ~3 KB on one side only. A small page could have failed
  "nothing rendered" while rendering perfectly. Stripping the template first makes the two
  comparable. Nobody had hit it; the rig had carried it latent for as long as it had existed.
- **The optional-peer split paid, and the receipt is a version.** These repos run vite 7 and
  plugin-react 5, where the preset declares vite 8 and plugin-react 6. The install was clean and the
  rig unaffected, because the barrel imports neither and the preset sits behind its own subpath.
  That is invariant 15's payoff stated as something an adopter simply does not have — and it is why
  `webPreset` was declined here, with the version named rather than a shrug.
- **A clean negative on the hole three migrations found.** `scripts/` typechecked by nothing was
  migration 4's finding, then migration 6's, then migration 9's. All three of these repos include
  `**/*`, so their scripts were covered before anyone asked. The check cost one command, and
  assuming would have cost a wrong bullet in this file.
- **The shared tree bit twice, two different ways, and a guard is what made pushing safe.** One repo
  went from clean to nine foreign dirty files in the minutes between the audit and the install;
  another had two unpushed commits belonging to somebody else, so its slice is committed and
  deliberately NOT pushed. Pushing "your own completed unit" in a shared tree means asserting it:
  refuse unless the commits ahead of the remote are exactly yours. The rule about never staging
  foreign FILES has a twin about never shipping foreign COMMITS.

### Migration 13 (an audit of an already-migrated adopter)

The first pass over a repo that had **already** adopted the package, looking only at whether the
adoption was right. It found the package shipping the hazard rather than the adopter, which is the
strongest argument yet for auditing after a migration instead of closing the ticket at green.

- **A return target is written into a QUERY STRING, so it must not carry what a fragment carries.**
  `createRequireAuth` built it as `pathname + search + hash`, and that guard renders exactly when
  there is no session yet — which is the state an implicit-flow callback is in while its client
  reads the fragment. Point an OAuth `redirectTo` at a guarded route and the bounce is
  `/login?next=/app%23access_token%3D…%26refresh_token%3D…`: a refresh token in `Referer`, in
  access logs, and in history. `returnPathFromLocation` keeps the page and drops only a fragment
  carrying a credential, because the page is the part worth returning to and the anchor is the part
  that is dangerous.
- **The default nobody passes was the one that mattered, and it is the opposite of the guess.**
  supabase-js declares no `flowType` of its own, so GoTrueClient's fallback stands and it is
  **implicit**, not PKCE — the callback comes back in the fragment. Across the fleet **10 of 12
  frontends set no `flowType` at all**; two ask for PKCE. Measured through an app's own resolver
  rather than by reading a changelog, because migration 5 already learned that a resolution check
  is only evidence when it resolves the way the consumer will: run from the wrong directory, the
  same question answers differently.
- **A rule stated in a README is not a rule the code keeps.** The README said the guard carries
  "path, query and hash", and it did, literally. The sentence was right about intent and the
  concatenation under it was the bug — which is why correcting it meant grepping the sentence and
  rewriting the claim, not patching the line.
- **The adopter's remaining hole was the one this project has closed five times.** An invite link's
  `?next=` used `startsWith("/")` under a comment promising it would "never follow an external
  URL". It would: a parser folds `//evil.test` and `/\evil.test` into another origin and strips a
  tab before deciding. The comment was the tell — a claim the code one line below does not deliver.
- **A guard reaches nobody until the caret lets it.** The two repos that call `createRequireAuth`
  sit at `^0.9.0` and `^0.8.0`. The first takes 0.9.2 on its next lockfile update; the second
  **cannot receive it at all**, because a caret on a 0.x does not cross a minor — and it is the one
  whose `redirectTo` points at a guarded route, so it holds the live instance. Migration 9 learned
  this from the guard's side; this is the same fact from the bug's side, and it makes the bump the
  deliverable rather than the release.
- **Two plan items did not survive contact with the branch, in opposite directions.** A note to
  check a GoTrue nonce variable before removing it was stale — the repo had already deleted it, and
  the local checkout was 58 commits behind, which is the only reason the note looked live. The
  adapter the plan proposed adopting was already adopted. Re-read before you write the finding
  down, and re-read the REMOTE, because a stale checkout makes every version claim about the fleet
  wrong in the same direction.

### How to migrate a repo — the check that is not optional

**Read the code you are deleting against the code replacing it, function by function. Its
tests are not enough.** A green suite after a migration means the donor's tests still pass. It
says nothing about the donor behaviour nobody wrote a test for, which is most of what this layer
does. So for every file being deleted: list what it does, and find each one here. What is
missing comes UP into the package before the delete lands — that is the whole point, and it is
how the other eleven repos get it.

**Every migration must be net-negative in lines — measured on the ADOPTION commits, in source.**
If the code that swaps an adopter's copy for this package grows, the cut line was drawn in the
wrong place and the fix belongs here, not in the adopter. But a migration also fixes the bugs it
finds and sometimes builds what it discovers is missing, and those commits can carry the whole
range positive with nothing wrong; tests that pin behaviour nobody had pinned do the same. So
split the number and say which part is which. What is never allowed is padding the diff to reach
a negative total — deleting tests, or leaving a bug alone, to make an arithmetic look right.
Migration 7 is the worked example: +125 over the range, −169 of source across its seven adoptions,
+102 of it tests in two files.

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

  **And the copy a grep cannot reach is the one already sent to somebody.** A sentence in a
  reviewer's inbox, in a message to another agent, in a report someone is reading right now — no
  search finds it, only remembering you said it. That is not a completeness rule, it is an
  ORDERING one, and the ordering is what changes what you do first: **the in-flight copy is the
  only one with a deadline.** The code comment will still be wrong in ten minutes and still be
  fixable; the sentence somebody already has may already have been acted on. So the correction
  goes out before your own tree is clean, not after — which cuts against the instinct to wait
  until you have the fix in hand, because sending twice feels like admitting the mistake twice.
  Learned twice in one afternoon (2026-09-17), both times on our own text rather than a donor's:
  an overclaimed measurement was corrected in a code comment and a report, and the copy that
  mattered was the one inside a merge already in flight — it reached `main` and had to be
  cherry-picked out.
