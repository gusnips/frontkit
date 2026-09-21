/**
 * Where a language lives in an address, and how it crosses to another one.
 *
 * Six repos on this stack wrote this file. Four of its five functions are byte-identical in all
 * six — same regex, same asymmetry, same comments — and the fifth differs only in a parameter
 * name. What is NOT in all six is the half that decides whether a reader keeps the language they
 * picked: one repo had {@link Locales.localeUrl} and {@link Locales.localeQueryUrl}, and three
 * shipped the bug their absence causes.
 *
 * Zero dependencies and its own package, on purpose. An API server reads `asLocale` at its edges
 * — measured across six repos, that plus the locale list is ALL a server uses — and a server
 * depending on a package named "react" is a smell even when it costs nothing at runtime. Nothing
 * in frontkit depends on this one, so it is a leaf: no version of it can pin a sibling.
 */

/** The parameter that hands a language across an origin. One spelling, everywhere.
 *
 *  Pass it to `i18nInitOptions({ queryKey: LOCALE_QUERY_PARAM })` as well, and the reader and the
 *  writer of the language agree by construction. They are the same idea named twice otherwise,
 *  and one repo needed a test asserting the two strings matched — a test that only exists because
 *  there were two strings. */
export const LOCALE_QUERY_PARAM = "lang";

/** What {@link createLocales} returns: the address shape for one product's closed locale list. */
export interface Locales<L extends string> {
  /** Narrow an untrusted string — a column, a header, a query parameter — to a locale we ship. */
  asLocale: (value: string | null | undefined) => L | null;
  /** A locale's segment in a URL path: `""` for the default, `pt`, `es`. */
  localeSegment: (locale: L) => string;
  /** Where a locale's pages live: `""` for the default, `/pt`, `/es`. */
  localePrefix: (locale: L) => string;
  /** A route path in one locale: `("pt-BR", "/terms")` → `/pt/terms`. */
  localePath: (locale: L, path: string) => string;
  /** The inverse: which locale an address is for, and the route path under it. */
  splitLocalePath: (pathname: string) => { locale: L; path: string };
  /** A route on another of our origins that HAS per-locale addresses. */
  localeUrl: (origin: string, locale: L, path?: string) => string;
  /** A route on another of our origins that does NOT — the language rides a query parameter. */
  localeQueryUrl: (origin: string, locale: L, path?: string) => string;
}

/**
 * The address shape for one product's locales.
 *
 * The list and the default are the product's — they are its content plan, not plumbing, the same
 * way an API's error codes are its own vocabulary. Everything derived from them is here.
 *
 * ```ts
 * export const SUPPORTED_LOCALES = ["en", "pt-BR", "es"] as const;
 * export type Locale = (typeof SUPPORTED_LOCALES)[number];
 * export const DEFAULT_LOCALE: Locale = "en";
 *
 * export const { localePath, splitLocalePath, localeUrl, localeQueryUrl, asLocale } =
 *   createLocales(SUPPORTED_LOCALES, DEFAULT_LOCALE);
 * ```
 *
 * The default does not have to be English and is not in every repo on this stack, which is why it
 * is an argument rather than a lookup for `"en"`.
 */
export function createLocales<const L extends readonly string[]>(
  locales: L,
  defaultLocale: L[number],
  options: { queryParam?: string } = {},
): Locales<L[number]> {
  type Locale = L[number];
  const queryParam = options.queryParam ?? LOCALE_QUERY_PARAM;

  const asLocale = (value: string | null | undefined): Locale | null =>
    locales.find((locale) => locale === value) ?? null;

  /**
   * The BASE subtag, lowercase: `pt`, `es`.
   *
   * The path segment and the `hreflang` tag are allowed to differ, and only one of them has to be
   * real BCP-47: `hreflang="pt-BR"` does, a path segment does not. So the tag keeps the region and
   * the address does not. A segment is something people type, paste, shorten and read aloud, and
   * `/pt` is where every reader expects Portuguese to be — the region was carrying information
   * only the tag has to carry. Lowercase because paths are case-sensitive by spec and on
   * Cloudflare Pages, and half the tools that touch a link lowercase it, so a cased segment is a
   * 404 only some readers ever see.
   *
   * One donor moved from `pt-br` to `pt` and shipped the 301s in the same commit. The pair ships
   * together, or the change is a hole in the index.
   *
   * ponytail: two variants of ONE base language collide here — `pt-BR` and `pt-PT` would both want
   * `/pt`. That is the wall to hit before rethinking this, and the upgrade path is a per-locale
   * segment map, which is exactly what the region form was.
   *
   * Empty for the default locale, which is what makes every shape below asymmetric.
   */
  const localeSegment = (locale: Locale): string =>
    locale === defaultLocale ? "" : locale.replace(/-.*$/, "").toLowerCase();

  /**
   * The default locale is UNPREFIXED and every other one carries its segment.
   *
   * Asymmetric on purpose: every address already published stays valid, and the bare root needs no
   * redirect — the one thing a crawler handles worst, and what `x-default` points at, so it has to
   * be a real page rather than a hop.
   *
   * Why any of this exists: ONE address serving three languages by sniffing `navigator` cannot be
   * indexed. A crawler fetches an address once, and whatever language it happened to answer with
   * is the only thing that address will ever mean — so two thirds of the copy is unreachable no
   * matter how well it is written. One address per language is the whole fix.
   */
  const localePrefix = (locale: Locale): string => {
    const segment = localeSegment(locale);
    return segment === "" ? "" : `/${segment}`;
  };

  /** The root stays a bare `/` in the default locale and `/pt` — no trailing slash — elsewhere. */
  const localePath = (locale: Locale, path: string): string => {
    const prefix = localePrefix(locale);
    if (path === "/") return prefix === "" ? "/" : prefix;
    return `${prefix}${path}`;
  };

  /**
   * Matched against the SEGMENT rather than the tag — comparing a pathname to the locale list by
   * string equality is how `/pt/` fails to match `pt-BR` and gets debugged at 2am. An unprefixed
   * or unrecognized path is the default locale's, so `/es-AR/terms` reads as a default-language
   * page called `/es-AR/terms` (a 404) rather than silently becoming Spanish.
   */
  const splitLocalePath = (pathname: string): { locale: Locale; path: string } => {
    const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
    const segment = match?.[1]?.toLowerCase();
    const found = locales.find(
      (locale) => locale !== defaultLocale && localeSegment(locale) === segment,
    );
    if (match && found !== undefined) return { locale: found, path: match[2] ?? "/" };
    return { locale: defaultLocale, path: pathname };
  };

  /**
   * A route on ANOTHER of our origins, in this reader's language.
   *
   * The language does not survive an origin hop by itself. A storefront, a docs site and a console
   * on three subdomains are three ORIGINS, so one `localStorage` key spelled identically in all
   * three is a shared NAME with no shared storage behind it: a reader who picked Portuguese on the
   * storefront follows a link and gets whatever their browser guesses. No detection order fixes
   * that, because there is nothing to detect. The address is the only thing that crosses.
   *
   * Three repos shipped that bug and one of them had already written the fix down as "this would
   * take a cookie" — it does not; it takes putting the language in the link.
   *
   * This form is for a destination that HAS per-locale addresses. The root keeps the bare origin
   * rather than gaining a `/`: appending the default locale's `"/"` rewrites every link for
   * nothing, and a byte-identical build is what proves a migration lost nothing.
   */
  const localeUrl = (origin: string, locale: Locale, path = "/"): string => {
    const route = localePath(locale, path);
    return `${origin}${route === "/" ? "" : route}`;
  };

  /**
   * A route on an origin that has NO per-locale addresses — the language rides a query parameter.
   *
   * A console is auth-gated, never prerendered, and has one address per route, so there is nothing
   * in the path to put a language in. The destination detects this parameter AHEAD of storage and
   * the browser, because it is the only one of the three the reader chose on purpose and just now,
   * and caches it on arrival — so no address inside the console has to carry it and it never shows
   * up twice.
   *
   * It is emitted for the DEFAULT locale too, which looks like a default leaking and is not: a
   * reader on an unprefixed address has that language as their resolved preference, and dropping
   * the parameter there would let the destination re-sniff a browser that disagrees with what the
   * reader is plainly reading.
   *
   * The fragment is kept behind the query, which is the ordering a URL requires: written the
   * obvious way, `"/pricing#plans"` becomes `/pricing#plans?lang=pt-BR` and the whole parameter is
   * part of the fragment — the language silently does not arrive, which is the exact failure this
   * function exists to prevent.
   */
  const localeQueryUrl = (origin: string, locale: Locale, path = ""): string => {
    const hash = path.indexOf("#");
    const route = hash === -1 ? path : path.slice(0, hash);
    const fragment = hash === -1 ? "" : path.slice(hash);
    const separator = route.includes("?") ? "&" : "?";
    return `${origin}${route}${separator}${queryParam}=${encodeURIComponent(locale)}${fragment}`;
  };

  return {
    asLocale,
    localeSegment,
    localePrefix,
    localePath,
    splitLocalePath,
    localeUrl,
    localeQueryUrl,
  };
}
