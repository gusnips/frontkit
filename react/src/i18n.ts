/**
 * The i18next bootstrap two donors wrote nearly comment-for-comment.
 *
 * Each browser surface spreads these into its own init with its own bundled resources:
 *
 * ```ts
 * i18n.use(LanguageDetector).use(initReactI18next).init({ resources, ...i18nInitOptions({…}) })
 * ```
 *
 * Keeping the options here is what stops a console, a storefront and a docs site in the same
 * product from drifting apart on the details below — each of which is a bug somebody already
 * shipped.
 */

export interface I18nInitOptions {
  /** The language everything falls back to. */
  fallbackLng: string;
  /** Every language this app ships, as the exact tags used in the catalogs. */
  supportedLngs: readonly string[];
  /**
   * Where the reader's choice is remembered.
   *
   * One key everywhere is a convention, not a mechanism: `localStorage` is scoped to an ORIGIN,
   * so a console on `app.example.com` shares nothing with a storefront on `example.com` no
   * matter what the key is called. Which is why {@link queryKey} exists.
   */
  storageKey: string;
  /**
   * The query parameter that hands a language ACROSS an origin, e.g. `"lang"`.
   *
   * When set it is detected FIRST, ahead of storage and the browser — it is the only one of the
   * three that somebody chose on purpose and just now. A reader who picked Português on the
   * storefront and followed a link into the app means it more than their laptop's locale does.
   * It is cached on arrival, so it decides once and no URL inside the app has to carry it.
   *
   * Only one donor had this. The other has the same split-origin layout and the same problem.
   */
  queryKey?: string;
}

export function i18nInitOptions({
  fallbackLng,
  supportedLngs,
  storageKey,
  queryKey,
}: I18nInitOptions) {
  return {
    fallbackLng,
    supportedLngs: [...supportedLngs],
    load: "currentOnly" as const,
    interpolation: { escapeValue: false }, // React already escapes.
    detection: {
      order: queryKey
        ? ["querystring", "localStorage", "navigator"]
        : ["localStorage", "navigator"],
      caches: ["localStorage"],
      ...(queryKey ? { lookupQuerystring: queryKey } : {}),
      lookupLocalStorage: storageKey,
    },
    react: { useSuspense: false },
    // `nonExplicitSupportedLngs` is omitted deliberately. It breaks both shapes a catalog comes in.
    // Region-coded: it validates the BASE subtag against `supportedLngs`, "pt" is not in a list
    // that says "pt-BR", and the whole app silently renders English — both donors say so in the
    // same words. Base codes: an "en-US" browser keeps "en-US" as `i18n.language`. Beside
    // `currentOnly` no catalog matches it, so the reader gets the fallback language; beside
    // `languageOnly` the copy is right and every map an app keys by the tag misses — the third
    // migration shipped English copy as `lang="pt-BR"`. Without the flag "en-US" settles on "en".
  };
}

/**
 * Substitute `{{brand}}`-style placeholders through a bundled resource tree, once, before
 * i18next ever sees it.
 *
 * Done here rather than through interpolation because i18next v26 has no global interpolation
 * defaults, and these strings are often resolved by dynamic key — so a wrapping `t()` would not
 * reach them. The point is that a rename or a domain move is ONE edit in the brand constants
 * instead of a sweep across every locale file.
 *
 * Returns a fresh tree; the input is untouched. The placeholder names come from `vars`, so
 * adding one needs no change here — two donors hardcoded their own list in the regex and both
 * had to remember to update it.
 */
export function applyBrandVars<T>(resources: T, vars: Record<string, string>): T {
  const names = Object.keys(vars);
  if (names.length === 0) return resources;
  const pattern = new RegExp(
    `\\{\\{(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\}\\}`,
    "g",
  );

  const fill = (s: string): string => s.replace(pattern, (_, name: string) => vars[name] ?? "");

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return fill(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };

  return walk(resources) as T;
}
