# @gusnips/locale

Where a language lives in a URL, and how it crosses to another origin. No dependencies, and
nothing tied to a framework — your API server, your browser entry and your prerender script all
compile this same file.

```bash
bun add @gusnips/locale
```

```ts
import { createLocales } from "@gusnips/locale";

const { localePath } = createLocales(["en", "pt-BR"] as const, "en");

localePath("pt-BR", "/terms"); // → "/pt/terms"
```

## One list in, seven functions out

The list of languages and which one is the default are yours — they are your content plan, not
plumbing. Everything derived from them is here.

```ts
export const SUPPORTED_LOCALES = ["en", "pt-BR", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const { asLocale, localePath, splitLocalePath, localeUrl, localeQueryUrl } = createLocales(
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
);
```

Every function is typed on your list, so `localePath("fr", "/")` is a compile error.

|                                        |                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `localePath(locale, path)`             | `("pt-BR", "/terms")` → `/pt/terms`. The default locale is unprefixed. |
| `splitLocalePath(pathname)`            | The inverse: `/pt/terms` → `{ locale: "pt-BR", path: "/terms" }`.      |
| `localePrefix(locale)`                 | `""`, `/pt`, `/es` — the prefix on its own.                            |
| `localeSegment(locale)`                | `""`, `pt`, `es` — the segment without the slash.                      |
| `asLocale(value)`                      | Narrows an untrusted string to one of yours, or `null`.                |
| `localeUrl(origin, locale, path)`      | A link to another origin that has per-language addresses.              |
| `localeQueryUrl(origin, locale, path)` | A link to one that does not.                                           |

## Why the default language has no prefix

`/terms` and `/pt/terms`, not `/en/terms` and `/pt/terms`. Asymmetric on purpose: every address
you have already published stays valid, and the bare root needs no redirect — which is the thing
a crawler handles worst, and it is what `x-default` points at, so it has to be a real page.

The reason any of this exists is that **one address serving three languages by sniffing the
browser cannot be indexed.** A crawler fetches an address once, and whatever language came back
is the only thing that address will ever mean, so the other two languages are unreachable however
well they are written. One address per language is the whole fix.

## Send a reader to their language before the page shows

A bare address like `/pricing` is the only one that can be wrong for a reader. `/pt/pricing`
names its language; `/pricing` just gets the default. So a Portuguese reader who lands on
`/pricing` should end up on `/pt/pricing`.

If your app's entry file does that redirect, it happens too late. The browser shows the English
page while your JavaScript downloads, then jumps to Portuguese. That is a blink of about a
second, on every first visit.

`localeGateScript` decides before the page shows:

```ts
// vite.config.ts
import { localeGateScript } from "@gusnips/locale";
import { prePaintScript } from "@gusnips/vite";

prePaintScript({
  name: "locale",
  source: localeGateScript({
    locales: ["en", "pt-BR", "es"],
    defaultLocale: "en",
    storageKey: "app.locale",
  }),
  position: "head-prepend",
});
```

It picks the language in this order:

1. The language the reader chose before, which your language picker saved under `storageKey`.
   Choosing the default counts: that reader stays on the bare address.
2. The browser's languages, in the reader's own order. `pt-PT` and `pt` both find `pt-BR`.
3. Nothing matched: the reader stays where they are.

It never moves a reader off an address that already names a language, and it keeps the query and
the `#fragment`. A crawler that runs no scripts stays on the default page.

Three options, for sites that need them:

- `base: "/docs"` when the pages live under a path.
- `exclude: ["/login", "/app"]` for app screens served beside the site. They are never
  redirected, and neither is anything under them.
- `signedInKey: /^sb-.+-auth-token$/` leaves signed-in readers alone. Their language comes from
  their account, not their browser.

Serve it as a file, which is what `prePaintScript` does. A `script-src 'self'` policy blocks an
inline script without any error, and the blink comes back. Then take the redirect out of your
entry file: the entry just renders the language the address names.

## A language does not survive a jump to another origin

This is the part that gets written last and is usually a bug first. If your site is on
`example.com` and your app is on `app.example.com`, those are two origins. `localStorage` is
per-origin, so the same key name in both is not the same storage: a reader who picks Portuguese
on your site and clicks "Sign in" arrives at the app in whatever their browser guesses. There is
nothing to detect, because nothing crossed.

The link is what crosses. Which form depends on the destination:

```ts
// The docs site has a page per language: put it in the path.
localeUrl("https://docs.example.com", "pt-BR", "/guides/limits");
// → https://docs.example.com/pt/guides/limits

// The app is signed-in and has one address per route: put it in a parameter.
localeQueryUrl("https://app.example.com", "pt-BR", "/register");
// → https://app.example.com/register?lang=pt-BR
```

On the receiving side, read that parameter **before** storage and the browser, and cache it on
arrival — it is the only one of the three the reader chose on purpose and just now. With
`@gusnips/react`:

```ts
import { LOCALE_QUERY_PARAM } from "@gusnips/locale";

i18nInitOptions({ queryKey: LOCALE_QUERY_PARAM, storageKey: "app.locale", ... });
```

One constant on both ends, so the writer and the reader cannot drift apart.

The parameter is sent for the default language too. That looks like a default leaking and is not:
a reader on an unprefixed address has that language as their resolved preference, and leaving the
parameter off would let the app re-sniff a browser that disagrees with what the reader is plainly
reading.

## Two things it does not do

**It picks a language in one place only:** the redirect off a bare address, above. Inside an app,
detection is `@gusnips/react`'s `i18nInitOptions`.

**It does not write `og:locale`.** That tag needs a territory your list does not carry (`en` is
not valid there; `en_US` is), and which territory to claim is a product decision.
`@gusnips/vite`'s `bakeHead` writes it for you during a prerender.

## License

MIT
