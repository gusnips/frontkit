# @gusnips/react

The layer under a Vite + React SPA: the fetch client, the auth store, the route guards, the error
boundary, the query rules. No styling, no brand, no components you have to look at.

```bash
bun add @gusnips/react
```

```ts
import { createApiClient } from "@gusnips/react";

const api = createApiClient({
  baseUrl: "https://api.example.com",
  session: mySession,
  onSessionDead: () => window.location.replace("/sign-in"),
});

const user = await api.get<User>("/me");
```

`api.get` gives you `user`, not a `Response`. It attaches the token, unwraps the envelope, and
throws an `ApiError` carrying the code, the details and the request id when the server refuses.

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
that worked a minute ago.

Two halves. In your browser entry:

```ts
import { installPreloadErrorHandler } from "@gusnips/react";

installPreloadErrorHandler();
```

And in your error boundary:

```ts
if (isChunkLoadError(error) && reloadOnceForChunkError()) return null;
```

`reloadOnceForChunkError` reloads at most once a minute, because reloading on a chunk error the
reload does not fix is an infinite loop with a person inside it. Past that, a genuinely missing
chunk degrades to your error screen, which can at least say something.

The handler is the other half, and it is narrower than it looks: it swallows Vite's CSS _preload
hint_ failure and nothing else. A hint that fails is harmless — the import runs straight after
and usually works. Taking Vite's `preventDefault()` for every preload error instead resolves the
dynamic import with `undefined`, `React.lazy` reads `.default` off nothing, and you get a crash
screen plus a TypeError with only React frames in it, naming no chunk.

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

`hydrateOrMount` for prerendered pages, `ErrorBoundary`, an SSE reader split into a platform-free
parser and a stream wrapper, `i18nInitOptions`, and `cn`.

`createAuthStore` is at `@gusnips/react/store` — a zustand store whose `isLoading` starts `false`
where there is no window. A session bootstrap can only be in flight in a browser, and `true`
during a build is a wait that never ends: it once shipped a spinner as the indexable body of a
page whose whole job was to be found.

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

| Import from               | What is in it       | What you must have |
| ------------------------- | ------------------- | ------------------ |
| `@gusnips/react`          | the client and rest | react, react-dom   |
| `@gusnips/react/store`    | `createAuthStore`   | zustand            |
| `@gusnips/react/guards`   | the route guards    | react-router-dom   |
| `@gusnips/react/ui`       | the seven wrappers  | @base-ui/react     |
| `@gusnips/react/contract` | two prerender names | nothing            |

The rule behind that table: **a peer marked optional must not be reachable from the main entry
point.** An optional peer the barrel imports anyway is not optional — it is a required one whose
error moved from install time to your first build, which is the worse of the two places to learn
about it.

`@tanstack/react-query`, `i18next` and `react-i18next` are optional and stay in the main entry,
because only their types are used and types erase.

MIT · part of [frontkit](https://github.com/gusnips/frontkit)
