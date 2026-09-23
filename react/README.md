# @gusnips/react

The layer under a Vite + React SPA: the fetch client, the auth store, the route guards, the error
boundary, the query rules. No styling, no brand, nothing that decides how your app looks.

```bash
bun add @gusnips/react
```

```ts
const user = await api.get<User>("/me");
```

That is the whole call. `user` is a `User` — not a `Response`, not `res.json()`, not a null
check. The client attached the token, unwrapped the envelope, and threw a typed `ApiError`
carrying the code and the request id if the server refused.

You build `api` once, wherever you keep that sort of thing:

```ts
import { createApiClient } from "@gusnips/react";

const api = createApiClient({
  baseUrl: "https://api.example.com",
  session: mySession,
  onSessionDead: () => window.location.replace("/sign-in"),
});
```

## The client knows three things people learn the hard way

**Six queries firing at once send one refresh, not six.** The auth server rotates the refresh
token when you use it, so the losers of that race each invalidate the winner — and the person is
signed out in the middle of a load that was working. Three separate codebases arrived at
single-flight refresh independently. This is that.

**Only auth ANSWERING is a "no".** Dropping a packet tells you nothing about whether a session is
good, and neither does a 500 — that is auth failing, not auth answering. So `refresh()` answers
`{ token, reachedAuth }`, and only a real refusal signs anyone out. Before that split, a Wi-Fi
blip logged people out mid-load; without the second half, one bad minute at the auth server signs
out everybody whose token happened to need refreshing.

**A sign-out has a fail-safe timer.** Awaiting `signOut()` before redirecting covers a rejection,
not a hang — and a hang leaves someone signed out in name only: every request 401ing, nothing
left that could redirect it.

### Supabase sessions

```ts
import { createSupabaseSessionAdapter } from "@gusnips/react/supabase";

const session = createSupabaseSessionAdapter(supabase.auth);
```

Pass `session` to `createApiClient`. The adapter reads the current token, refreshes it and signs
out. More importantly, it keeps a network failure separate from GoTrue refusing the refresh token,
so losing Wi-Fi does not become a logout. It lives behind a subpath because it imports
`@supabase/supabase-js`; the main entry does not.

The test it makes that decision with is exported, because a refresh is not the only place an app
asks it:

```ts
import { isAuthOutage } from "@gusnips/react/supabase";

// A callback that just failed to trade its one-use link.
if (isAuthOutage(error))
  showRetry(); // the link was never spent — the same one still works
else showLinkSpent(); // auth said no: only a new link helps
```

`isAuthOutage` is true when auth FAILED rather than answered — a request that never landed, or a
5xx. Only a real refusal is an answer, and only an answer may end a session or a link. Use it
anywhere that decision is made; the sentence you show is a separate question, and a narrower one
— "check your connection" is true of a request that never landed and false of a 502, which is
ours. auth-js marks "nothing came back", and only that, with status 0.

It is safe to hand it the `error` from a `{ data, error }` result without checking it first:
`null` answers false. That is worth stating because `null` is the SUCCESS value of every
supabase-js auth call, so the obvious `if (isAuthOutage(error))` is written against it constantly.

Supabase email links have two complete patterns. Keep either one, never half of each:

- A link carrying `token_hash` needs one explicit `verifyOtp` call. Guard it against React
  StrictMode because the hash is single-use.
- A link carrying `ConfirmationURL` needs `detectSessionInUrl` enabled. That reader consumes an
  implicit `#access_token` or a PKCE `?code`; it does not consume `token_hash`.

Either pattern can carry a destination — the `token_hash` one has to be asked. GoTrue hands every
template a `{{ .RedirectTo }}`: the `redirectTo` the app passed, already checked against the
allowlist, falling back to the Site URL when it was absent or not on it. A `{{ .ConfirmationURL }}`
link carries it for you. A template that writes its own landing drops it unless it asks:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next={{ .RedirectTo }}
```

Leave that parameter off and `redirectTo` and `emailRedirectTo` do nothing on every e-mail flow,
however carefully the app sets them — four of the codebases this came from pass one that the
template throws away, so a person bounced off a protected page signs in and lands on the front
door. Nothing reports it: the app's call is correct, the link works, and the destination was
dropped in an HTML file hosted somewhere else.

`{{ .RedirectTo }}` arrives as an absolute URL rather than a path, so the landing reads it as one:

```ts
const raw = new URLSearchParams(location.search).get("next");
const url = raw ? new URL(raw, location.origin) : null;
const next = url?.origin === location.origin ? safeInternalPath(url.pathname + url.search) : null;
```

Validate it on arrival even though GoTrue already did: that check is against a list of origins,
so it says the link may come back here, not which page it may open.

Recovery and invite links continue to the new-password screen after the session opens. A callback
must also tell a used or expired link apart from a request that never landed — or one that landed
and came back 5xx: the first needs a new link, and the other two can retry the same one, because
the hash was never spent.

`parseAuthCallback` reads a callback address and says what arrived:

```ts
import { parseAuthCallback } from "@gusnips/react/supabase";

parseAuthCallback("?token_hash=abc&type=recovery");
// → { kind: "email-link", tokenHash: "abc", type: "recovery" }
```

There are four kinds. `email-link` needs your one `verifyOtp` call. `session` is a PKCE `code` or
implicit-flow tokens; in a browser the client has already taken it, so wait for the session, and on
React Native hand `credential` to `exchangeCodeForSession` or `setSession`. `error` is a failure
GoTrue wrote into the address. `invalid` is a link that was cut short or edited.

Pass the fragment too — `parseAuthCallback(location.search, location.hash)`. GoTrue writes a
failure into the fragment every time and into the query only sometimes: after an implicit-flow
email link it is in the fragment alone, so a query-only reader shows nothing to somebody whose
link expired.

Choose the words by `code` (GoTrue's `error_code`, such as `otp_expired`), not by `error`.
`access_denied` covers an expired link, a banned user and a disabled signup as well as a person
pressing Cancel at Google; only the last one arrives with no code, and that is what `cancelled`
means. A cancel was their choice, so say nothing or offer the button again.

A handler you mount for Google's refusals also receives every email link's. An expired magic link
or reset link comes back with the same parameters, to whatever page `redirectTo` named. If that
handler only knows Google copy, the person whose link ran out is told Google failed. Check `code`
before you reach for provider copy: `otp_expired` is a link, never a provider.

Every email link type is accepted, `invite` included, even if your templates never send it. An
operator can still send one from Studio. Name a destination for each with
`Record<EmailLinkType, string>`, so a new type is a compile error rather than a wrong page.

There is also a deadline on every request, which none of the codebases this came from had. A
request with no timeout is a spinner with no end.

## Never retry what waiting cannot fix

```ts
import { queryDefaults } from "@gusnips/react";

new QueryClient({
  defaultOptions: queryDefaults({ durableLimitCodes: ["QUOTA_EXCEEDED", "PAYMENT_REQUIRED"] }),
});
```

Retries 408, a transient 429, 5xx, and no-response-at-all. Nothing else — every other 4xx is an
answer, and a second attempt just says it again.

`durableLimitCodes` is the part a status code cannot tell you. A spent monthly quota and a burst
limit both arrive as 429, but one clears by waiting and the other clears by buying. Retrying the
second burns another request against the limiter to hear the same thing three times, so you name
those codes and they are never retried.

You only need that list where your API stays quiet. If it answers `Retry-After: 2`, the wait is
sat out; past `maxRetryWaitSecs` (10 seconds by default) the wait is the answer and the screen
says so instead of holding a spinner. And if it sends `details.retryAfterSecs: null`, it is
saying waiting will never fix this — a cap that frees only when somebody deletes something, a
slot that frees when another job ends. That `null` is read as the claim it is, not as a field
somebody forgot, so the code never reaches your list.

## A failed refresh is not a failed page

```tsx
import { queryView } from "@gusnips/react";

const view = queryView(numbers); // what useQuery returned

if (view.state === "waiting") return <Spinner />;
if (view.state === "failed") return <ErrorScreen error={view.error} />;
return <Numbers data={view.data} />;
```

Don't write `isError ? <ErrorScreen /> : <Numbers />`. `isError` is also true when a refresh fails
in the background while the numbers are already on screen: the window gets focus back, a poll
runs, a save reloads the list. One dropped request then swaps a working screen for an error.
`queryView` shows the error only when there is nothing else to show.

When a refresh fails, the view stays `ready` and `refreshError` holds the error. Use it to say the
numbers may be out of date, with a button to try again.

`waiting` also covers a query that is switched off until something else loads. `isLoading` is
false there, so `isLoading ? <Spinner /> : <List />` shows an empty list, as if the answer were
"nothing".

It reads only `data` and `error`, so a test can pass `{ data: 2, error: null }`. Which button to
offer comes from `describeError(view.error).recover`, below.

## Survives your deploys

An app with `lazy()` routes serves chunks by hashed filename. Deploy while someone has a tab
open, and their next click asks for a file that no longer exists — a white screen on a button
that worked a minute ago. The same deploy breaks a second way that looks nothing like the first:
the old bundle reads a field your API just renamed, and throws a plain `TypeError` with nothing
in it about a deploy.

**Fix the cause in your host config first.** This package cannot do it for you and it is worth
more than everything below. A static host answers a missing `/assets/x.js` with your SPA
fallback — `index.html`, at a 200, as `text/html` — and that is what the browser's "MIME type
text/html" module-script refusal actually is. Hosts then match cache rules against the _request
path_ rather than the outcome, so the `immutable, max-age=31536000` rule you wrote for hashed
assets lands on that HTML body: one poisoned asset URL, at the edge and in every browser that
touched it, for a year. Keep the fallback off `/assets/`, and answer a miss there with a real,
uncacheable 404.

Then two detectors, for the two failures:

```ts
if (await isStaleBuild()) reloadOnce();
```

`isStaleBuild` asks the server instead of reading the error — it compares the entry script this
document loaded against the one the live page names. That is the only thing that catches the
renamed-field crash, where the message carries no signal at all. It asks for the page, not for
the asset: a CDN serves assets with a long `s-maxage`, so a bundle retired an hour ago still
answers 200 from the edge and would report "current" during exactly the window when skew is most
likely. Anything ambiguous — offline, a non-200, a timeout — answers `false`, because dressing a
real bug up as an update hides it from you too.

```ts
if (isChunkLoadError(error) && reloadOnce()) return null;
```

`isChunkLoadError` matches the message, which is all you have for a failure that never reaches a
boundary — an `unhandledrejection`, or a listener. Every browser's phrasing is in there.

`reloadOnce` reloads at most once a minute, and there is **one** stamp for every reason to
reload. A tab can reload because a chunk 404'd, because the server says it is behind, or from a
guard inlined in `index.html` that runs before any module does. Three detectors, one predicament
— give each its own key and a broken deploy gets three reloads a minute to take turns with. That
inline guard cannot import anything, so the key it has to copy is exported as `RELOAD_GUARD_KEY`.

And in your browser entry:

```ts
import { installPreloadErrorHandler } from "@gusnips/react";

installPreloadErrorHandler();
```

It is narrower than it looks: it swallows Vite's CSS _preload hint_ failure and nothing else. A
hint that fails is harmless — the import runs straight after and usually works. Taking Vite's
`preventDefault()` for every preload error instead resolves the dynamic import with `undefined`,
`React.lazy` reads `.default` off nothing, and you get a crash screen plus a TypeError with only
React frames in it, naming no chunk.

## Guards that can tell "no" from "I don't know"

```tsx
import { createRequireProfile } from "@gusnips/react/guards";

const requireProfile = createRequireProfile(useMe, { loading: <Spinner /> });

const RequireStaff = requireProfile(
  (me) => me.isStaff,
  <NotFound />,
  (error) => <ErrorScreen error={error} />,
);
```

`onDenied` and `onError` are separate because `!me?.isStaff` reads a 500 as "not staff". An
operator arriving while `/auth/me` is down gets told the page does not exist: the wrong cause, no
retry, and no request id to quote. A guard has three answers — wait, fail, refuse — and only a
real `false` reaches the refusal.

`createRequireAuth` sends an anonymous visitor to `?next=`, carrying path, query and hash. The URL
survives reloads, OAuth and email links; router state does not. Read it through the main entry's
validator before navigating yourself:

```ts
import { safeInternalPath } from "@gusnips/react";

const next = safeInternalPath(new URLSearchParams(location.search).get("next")) ?? "/";
```

`createRequireAnonymous` already performs that check and falls back to the home path you gave it.

Writing a return target down is the other direction, and it has its own hazard. A Supabase client
with no `flowType` is on the **implicit** flow — the default — so a callback comes back as
`#access_token=…&refresh_token=…`. A guard renders exactly when there is no session yet, which is
that callback's own state while the client parses the fragment: point an OAuth `redirectTo` at a
guarded route and a concatenated `pathname + search + hash` puts a refresh token into a query
string, where it rides in `Referer`, lands in access logs and stays in history.

```ts
import { returnPathFromLocation } from "@gusnips/react";

// Takes anything shaped like the current page: `window.location`, or `useLocation()`.
const returnTo = returnPathFromLocation(window.location);
```

It keeps the page and drops only a fragment carrying a credential, because the page is the part
worth returning to. `createRequireAuth` uses it; use it anywhere else you record where someone was
— a dead-session redirect is the common one.

## Never dead-end anyone

```ts
import type { ErrorStateProps } from "@gusnips/react";
```

No component ships — seven codebases have an `ErrorState.tsx` and they overlap 9–37%, because one
draws a tinted icon, one an illustration, one a mascot. What they share is the prop shape, and
the prop shape _is_ the rule: `problem`, `cause`, `fix`, and `action`. **`fix` and `action` are
required.** A required prop is the only version of "always offer a way out" that a caller in a
hurry cannot skip.

`createErrorDescriber` turns a thrown `ApiError` into the `cause` and `fix` to put in it — plus
which control to offer, and the request id to print under it:

```ts
const { cause, fix, recover, reference } = describeError(error);
// recover: "retry" | "signin" | "wait" | "none"
```

The field is `fix`, the same word as the prop above. It was `hint` until 0.6.0, which left every
adopter writing `fix={hint}` at every error surface.

`recover` is derived from `shouldRetry` — the same rule react-query retries on — so the button a
reader sees and the retry that actually happens cannot disagree. Give it the same
`durableLimitCodes` list you give `queryDefaults`, and a spent quota offers no button instead of
one that cannot work.

You also say how a stated wait becomes words:

```ts
formatWait: (secs) => humanizeWait(t, secs, "errors."); // three ICU plural keys
formatWait: (secs) => formatIn(secs, locale); // or your own Intl formatter
```

It is required because the default hid its price: `humanizeWait` reads `waitSeconds`,
`waitMinutes` and `waitHours` out of your catalog, so an app that already formats relative time
with `Intl` had to add six entries per language before it would compile.

An error your `codes` map does not name falls back to the server's own `message`. Pass `fallback`
when that message is written for a log rather than for a person:

```ts
fallback: ({ says, wait }) => ({
  cause: says ?? t("errors.invalid"),
  fix: wait ? t("errors.retryIn", { when: wait }) : undefined,
});
```

Some APIs write `message` for whoever reads the screen. Some write it for whoever reads the log —
in English, in an app that ships three languages. Your arm also gets the stated wait, which the
default has nowhere to put.

## Light, dark, or the system's

```ts
const { mode, resolved, setMode } = useTheme();
```

`mode` is what the person picked: `"light"`, `"dark"` or `"system"`. `resolved` is what is on
screen. `setMode("dark")` switches, saves the choice, and every other open tab follows.

You make `useTheme` once, with the storage key your app already uses:

```ts
// src/theme.ts
import { createTheme, type ThemeOptions } from "@gusnips/react/theme";

export const THEME = { key: "app.theme" } satisfies ThemeOptions;
export const { useTheme } = createTheme(THEME);
```

Then give the same options to the Vite plugin, which paints the page in the right theme before
its first frame. Without it, a reader who chose dark sees one light frame on every load.

```ts
// vite.config.ts
import { themeScript } from "@gusnips/vite/theme";
import { THEME } from "./src/theme";

export default defineConfig({ plugins: [themeScript(THEME)] });
```

What it does that the copies it replaced each missed at least once:

- A browser that blocks site data throws when you touch `localStorage`. Here that is not a white
  page: the default applies, and a choice made after that lasts until the page is left.
- The script that runs before paint is not a second copy. The plugin writes this function's own
  source into a file, so the two cannot disagree about a stale value or blocked storage.
- That file is a real file, not an inline script, so a `script-src 'self'` policy lets it run.
  An inline one under that policy never runs, and nothing tells you.
- `"system"` follows the OS live, even when the person switched to it mid-page. A laptop that
  turns dark at sunset takes the page with it.
- It writes to the page only when the theme changes. A page that removes `dark` for as long as
  it is open, like a booking page that is always light, stays light until the theme really
  changes.
- `themeColor: { light: "#fff", dark: "#111" }` moves `<meta name="theme-color">` too, so the
  browser toolbar matches the page instead of the OS.
- `attribute: "data-theme"` writes `data-theme="dark"` instead of the `dark` class, and
  `defaultMode` picks what an empty key means (`"system"` unless you say otherwise).

In jsdom tests, mock `window.matchMedia`, which jsdom does not have, and run
`delete window.__frontkitTheme` between tests. There is one controller per page, and a jsdom
window lasts the whole file.

## Also here

`ErrorBoundary`, an SSE reader split into a platform-free parser and a stream wrapper,
`i18nInitOptions`, and `cn`.

Pass `storageWriter: "app"` to `i18nInitOptions` when your own language control writes the stored
locale. Leave it out and the detector writes it, which is right until you offer "follow the
browser": going back to that means clearing the key and detecting again, and a detector that
writes on every change puts the language it just detected straight back in. One writer per key.

`createAuthStore` is at `@gusnips/react/store` — a zustand store whose `isLoading` starts `false`
where there is no window. A session bootstrap can only be in flight in a browser, and `true`
during a build is a wait that never ends: it once shipped a spinner as the indexable body of a
page whose whole job was to be found.

When your store needs more than those flags, `authSlice` in the same place gives you them as a
plain object to spread, so `create` stays yours — and with it `persist`, your own actions, and
fields of your own:

```ts
const useAuthStore = create<AuthState<User> & { isAnonymous: boolean }>((set) => ({
  ...authSlice<User, { isAnonymous: boolean }>(set, (user) => ({
    isAnonymous: !!user?.isAnonymous,
  })),
}));
```

The second argument is what makes this more than spreading extra keys in yourself: a field read
off the user has to be rewritten whenever the user changes, and `setUser` and `clear` are the two
writes you no longer own.

`hydrateOrMount` is at `@gusnips/react/hydrate`, and the guards are at `@gusnips/react/guards`.

## On a phone

The main entry works in React Native. It imports `react` and nothing else you would have to go
find — no `react-dom`, no router, no store — so the fetch client, the retry rule and the SSE
parser all come along, and the four things that need a browser stay behind the subpaths above.

## The Base UI wrappers

```ts
import { Dialog, Drawer, Select, Combobox, Menu, Tabs, Input } from "@gusnips/react/ui";
```

Seven, behind a subpath, so an app on Radix or on nothing never resolves `@base-ui/react`.

They are seven because the audit that produced them started with 27 and the hypothesis was wrong:
no wrapper added scroll lock, focus trap, ESC, outside-dismiss, focus return, roving focus or
typeahead. Base UI already does all of that, and a wrapper "adding" them is a second
implementation of something that works. Twenty were dropped.

What the remaining seven buy is composition you cannot skip — no caller can ship a scrimless
dialog — required a11y props expressed as types, and a handful of facts that each cost somebody
an afternoon. z-index goes on the Viewport, not the Popup, because `position: fixed` makes a
stacking context. A drawer _ties_ with dialog rather than beating it, or a modal opened from
inside a drawer never paints. A wrapper earns its place by knowing something, not by styling
something.

## Subpaths, and what each one costs you

`@gusnips/react` itself needs `react` and nothing else. Anything that needs another runtime peer
lives behind a subpath, so you install a dependency only if you import the thing that uses it:

| Import from               | What is in it                            | What you must have    |
| ------------------------- | ---------------------------------------- | --------------------- |
| `@gusnips/react`          | the client and rest                      | react                 |
| `@gusnips/react/store`    | `createAuthStore`, `authSlice`           | zustand               |
| `@gusnips/react/guards`   | the route guards                         | react-router-dom      |
| `@gusnips/react/hydrate`  | `hydrateOrMount`                         | react-dom             |
| `@gusnips/react/supabase` | the session adapter, `parseAuthCallback` | @supabase/supabase-js |
| `@gusnips/react/ui`       | the seven wrappers                       | @base-ui/react        |
| `@gusnips/react/contract` | two prerender names                      | nothing               |
| `@gusnips/react/theme`    | `createTheme`, `startTheme`              | react                 |

The rule behind that table: **a peer marked optional must not be reachable from the main entry
point.** An optional peer the barrel imports anyway is not optional — it is a required one whose
error moved from install time to your first build, which is the worse of the two places to learn
about it.

`@tanstack/react-query`, `i18next` and `react-i18next` are optional and stay in the main entry,
because only their types are used and types erase.

MIT · part of [frontkit](https://github.com/gusnips/frontkit)
