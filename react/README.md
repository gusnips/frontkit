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

**A refresh that never reached the server is not a "no".** Dropping a packet tells you nothing
about whether a session is good. So `refresh()` answers `{ token, reachedAuth }`, and only a real
refusal signs anyone out. Before that split, a Wi-Fi blip logged people out mid-load.

**A sign-out has a fail-safe timer.** Awaiting `signOut()` before redirecting covers a rejection,
not a hang — and a hang leaves someone signed out in name only: every request 401ing, nothing
left that could redirect it.

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

## Never dead-end anyone

```ts
import type { ErrorStateProps } from "@gusnips/react";
```

No component ships — seven codebases have an `ErrorState.tsx` and they overlap 9–37%, because one
draws a tinted icon, one an illustration, one a mascot. What they share is the prop shape, and
the prop shape _is_ the rule: `problem`, `cause`, `fix`, and `action`. **`fix` and `action` are
required.** A required prop is the only version of "always offer a way out" that a caller in a
hurry cannot skip.

`createErrorDescriber` turns a thrown `ApiError` into the `cause` and `fix` to put in it.

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

`@gusnips/react` itself needs `react`, `react-dom` and nothing else. Anything that needs more
lives behind a subpath, so you install a dependency only if you import the thing that uses it:

| Import from               | What is in it                  | What you must have |
| ------------------------- | ------------------------------ | ------------------ |
| `@gusnips/react`          | the client and rest            | react, react-dom   |
| `@gusnips/react/store`    | `createAuthStore`, `authSlice` | zustand            |
| `@gusnips/react/guards`   | the route guards               | react-router-dom   |
| `@gusnips/react/ui`       | the seven wrappers             | @base-ui/react     |
| `@gusnips/react/contract` | two prerender names            | nothing            |

The rule behind that table: **a peer marked optional must not be reachable from the main entry
point.** An optional peer the barrel imports anyway is not optional — it is a required one whose
error moved from install time to your first build, which is the worse of the two places to learn
about it.

`@tanstack/react-query`, `i18next` and `react-i18next` are optional and stay in the main entry,
because only their types are used and types erase.

MIT · part of [frontkit](https://github.com/gusnips/frontkit)
