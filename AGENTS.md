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
├── react/              ← @gusnips/react  — the headless runtime. Peer: react.
│   └── src/ui/         ← the five Base UI wrappers, behind a subpath (see below)
├── vite/               ← @gusnips/vite   — the build rig. The ONLY package allowed node:fs.
├── scripts/            ← check-purity.ts, which enforces exactly that
└── AGENTS.md           ← this file
```

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
  sizes, a loading spinner) and 60 lines (4 variants, 3 sizes, no cva, and deliberately *no*
  `focus-visible:` styles because its one focus ring lives in the theme). They overlap on the
  idea and nothing else. A shared styled Button satisfying eight brands grows variant props
  forever. Share behavior, skin per product.
- **`EmptyState` / `ErrorState` ship as a contract, not a component.** They share a prop shape
  and one class string; the visual is a tinted icon badge, a branded Scene, or a mascot board.
  What ships is `EmptyStateProps` / `ErrorStateProps` — the *type* is what enforces "never dead
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

### …and five more for anything under `react/src/ui/`

The audit's headline finding was a NEGATIVE one: no wrapper in either donor adds scroll lock,
focus trap, ESC, outside-dismiss, focus return, roving focus or typeahead. Base UI does all of
it, and a wrapper that "adds" them is adding a second implementation of something that already
works. Twenty-two of the donor's twenty-seven wrappers were dropped on that basis.

What a wrapper legitimately buys is composition a caller cannot skip, required-a11y props
expressed as types, and the facts below — each of which cost somebody a debugging session:

12. **z-index goes on the Viewport, not the Popup.** `position: fixed` creates a stacking
    context, so a z-index on the Popup competes only INSIDE the Viewport's own `z-auto` context
    and paints under every `z-30` element on the page.
13. **A drawer TIES with dialog rather than beating it.** Ranked above, a drawer paints over
    every modal opened from inside it — the user taps, and nothing appears. At a tie the dialog
    wins on DOM order, because it portals second.
14. **Every part goes inside a Portal, including the ones that do not look like they need it.**
    Base UI throws error #26 otherwise, and a non-overlay "scoped" variant still portals — into
    a container rather than the body. Related: a combobox inside a portalled dialog is that
    dialog's SIBLING on `<body>`, so without a higher z it paints behind its own anchor.
15. **`outline-none` belongs on a popup container and nowhere else.** A popup takes focus
    programmatically, so it is the one element that legitimately suppresses the ring; anywhere
    else it deletes the app's only keyboard-focus affordance. Worth enforcing structurally — one
    donor budgets one reset per `<Primitive.Popup>` in a file, which cannot rot the way a
    filename allowlist does.
16. **Style off the accessibility attribute, never a parallel data attribute.** The primitive
    writes `aria-selected` and its own `data-*` from one state; styling the a11y contract is
    what keeps what a screen reader announces and what an eye sees from drifting apart.
17. **A shared control never hardcodes a colour it did not derive from a token.** `text-white`
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

## What the migrations taught

_(Filled in as migrations land. The audit that preceded the first line of code already taught
these.)_

- **The audit finds bugs in repos that are not the extraction source.** Reading the two donors
  against each other found a sign-out-on-a-Wi-Fi-blip in one, a `RequireStaff` in a third repo
  that was the exact code that donor had already fixed, and an unguarded module-scope
  `localStorage` in the other. None of these had a test. None broke anything visible. All would
  have shipped.
- **A negative result is a finding.** The donor had 27 Base UI wrappers and the hypothesis was
  that they added scroll lock, focus trap, ESC, outside-dismiss and focus return. They add none
  of it — Base UI already does. Only five earn a place, and the scope went from 27 to 5 before
  anything was written. Not extracting something is a valid outcome, and cheaper than extracting
  it and discovering later.
- **The best finding was not a bug in one repo, it was a landmine in another.** One repo
  prerenders with `react-dom/static` and documents why. A second uses `renderToString` and is
  safe *today* only because its site happens to have no `lazy()` routes. That is not a bug to
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
