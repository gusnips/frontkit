# frontkit

The layer under a Vite + React SPA: the build rig, the fetch client, the auth store, the
guards, the tokens.

Not a component library. There is no Button here, and there never will be — the ten copies
across the repos this came from overlap 4–7% because they are supposed to look different.
Behaviour is shared, skin is not.

```bash
bun add @gusnips/react
```

```ts
import { cn } from "@gusnips/react";

cn("p-2", "p-4"); // → "p-4"
```

## Four packages

| Package           | What it is                              | Depends on  |
| ----------------- | --------------------------------------- | ----------- |
| `@gusnips/tokens` | one Tailwind 4 `@theme` file            | nothing     |
| `@gusnips/http`   | the request/response envelope, as types | nothing     |
| `@gusnips/react`  | the headless runtime                    | react       |
| `@gusnips/vite`   | the prerender rig and the vite preset   | node, react |

They are four and not one because of what each consumer can afford to install. An Astro
marketing site wants the tokens and no JavaScript. An API server wants the envelope and no
React. A browser bundle wants the runtime and no `node:fs`. The build script is the only thing
that needs the filesystem, so it is the only thing that gets it.

## What it does

**Talks to your API.** One client, so nothing else calls `fetch`. It carries the token,
refreshes it once when a 401 comes back, and unwraps the envelope.

```ts
import { createApiClient } from "@gusnips/react";

const api = createApiClient({
  baseUrl: "https://api.example.com",
  session: mySessionAdapter,
  onSessionDead: () => window.location.replace("/sign-in"),
});

const user = await api.get<User>("/me");
```

Two things in there took a production incident each to learn. Six queries firing at once send
**one** refresh, not six — the auth server rotates the refresh token, so the losers of that race
each invalidate the winner and sign the person out mid-load. And a refresh that never _reached_
the auth server does not count as a refusal: dropping a packet says nothing about whether a
session is good, so a Wi-Fi blip no longer signs anyone out.

**Survives your deploys.** An app with `lazy()` routes serves chunks by hashed filename. Deploy
while someone has a tab open and their next click asks for a file that no longer exists — a
white screen on a button that worked a minute ago.

```ts
import { installPreloadErrorHandler, isChunkLoadError } from "@gusnips/react";
```

**Prerenders pages a crawler can read.** Nothing that reads a link for a living runs your
bundle, so a shipped `<div id="root"></div>` is a page that can be listed and never quoted.

**Keeps you from dead-ending anyone.** `ErrorStateProps` requires both a `fix` and an `action`.
A required prop is the only version of that rule a caller in a hurry cannot skip.

## Where it came from

Twelve private frontends, all on the same stack, that had each independently grown the same
layer — about 48,000 lines solving one problem nine times. Six filenames exist in all twelve.

They were not copies, and that is the point. Three of them separately invented the same
hydration guard, down to the attribute name. Three separately invented single-flight token
refresh. Three wrote three different retry rules, and **each one was right about something the
other two got wrong** — one allowed 408 through, one knew a spent quota does not clear by
waiting, one refetched on reconnect. All three are in here now.

Reading them against each other found nine live bugs, in repos that were not even the source.

## Docs

`AGENTS.md` in this repo is the real document: the twenty-one invariants, each with the incident
behind it, and the rule for migrating a repo onto this.

MIT.
