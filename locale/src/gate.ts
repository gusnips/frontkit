/**
 * The locale gate's body: the one redirect off an unprefixed address, decided before first paint.
 *
 * `localeGateScript` (in `index.ts`) serializes this function with `toString()` and writes it
 * into a file a page loads as a classic script in `<head>`. So everything it uses has to be
 * inside it: a helper, a constant or an import from this module would be a `ReferenceError` in
 * the page, where nothing reports it and the reader just lands on the wrong language. The test
 * runs the serialized text in a bare context for exactly that reason.
 *
 * It takes the page's global object as an argument instead of reading `window`: this package is
 * imported by API servers, and nothing in it may touch a browser global on its own.
 */

/** What the script carries into the page. Built by `localeGateScript`; not public API. */
export interface GateConfig {
  locales: readonly string[];
  defaultLocale: string;
  /** `[locale, segment]` for every locale whose pages carry a prefix. */
  prefixed: ReadonlyArray<readonly [string, string]>;
  storageKey: string;
  base: string;
  exclude: readonly string[];
  signedIn: { source: string; flags: string } | null;
}

/** The part of a browser's global object the gate reads. */
export interface GatePage {
  location: { pathname: string; search: string; hash: string; replace: (url: string) => void };
  navigator: { languages?: readonly string[]; language?: string };
  /** A getter that can THROW (site data blocked), not only return nothing. */
  localStorage: {
    getItem: (key: string) => string | null;
    key: (index: number) => string | null;
    readonly length: number;
  };
  document: { documentElement: { style: { visibility: string } } };
}

export function runLocaleGate(config: GateConfig, page: GatePage): void {
  try {
    const { location } = page;

    let path = location.pathname;
    if (config.base !== "") {
      if (path !== config.base && !path.startsWith(`${config.base}/`)) return;
      path = path.slice(config.base.length) || "/";
    }

    // A prefixed address was asked for by name, and is never second-guessed.
    const first = /^\/([^/]+)/.exec(path)?.[1]?.toLowerCase();
    if (config.prefixed.some(([, segment]) => segment === first)) return;

    const route = path.length > 1 ? path.replace(/\/$/, "") : path;
    if (config.exclude.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))) {
      return;
    }

    let storage: GatePage["localStorage"] | null = null;
    try {
      storage = page.localStorage;
    } catch {
      // Site data blocked: nothing was chosen here, so the browser's list decides.
    }
    const read = (key: string): string | null => {
      try {
        return storage === null ? null : storage.getItem(key);
      } catch {
        return null;
      }
    };

    // A signed-in reader's language comes from their account, and so does one whose sign-in is
    // arriving in this very address.
    if (config.signedIn !== null) {
      if (location.hash.includes("access_token=") || /[?&]code=/.test(location.search)) return;
      const signedIn = new RegExp(config.signedIn.source, config.signedIn.flags);
      try {
        for (let i = 0; storage !== null && i < storage.length; i++) {
          if (signedIn.test(storage.key(i) ?? "")) return;
        }
      } catch {
        // Unreadable storage holds no session to protect.
      }
    }

    const asLocale = (value: string | null): string | null =>
      config.locales.find((locale) => locale.toLowerCase() === value?.toLowerCase()) ?? null;

    // Their explicit choice outranks their browser, and a choice of the default is still a choice:
    // it stops here rather than falling through to a browser that disagrees with it.
    let wanted = asLocale(read(config.storageKey));
    if (wanted === null) {
      const { languages, language } = page.navigator;
      const tags = languages !== undefined && languages.length > 0 ? languages : [language ?? ""];
      // Their list, in THEIR order: a reader on [es, en] wants Spanish even though we list
      // English first. Exact tag first, then the base subtag, so `pt-PT` finds our `pt-BR`.
      for (const tag of tags) {
        const base = tag.split("-")[0]?.toLowerCase();
        wanted =
          asLocale(tag) ??
          config.locales.find((locale) => locale.split("-")[0]?.toLowerCase() === base) ??
          null;
        if (wanted !== null) break;
      }
    }
    if (wanted === null || wanted === config.defaultLocale) return;

    const segment = config.prefixed.find(([locale]) => locale === wanted)?.[1];
    if (segment === undefined) return;

    // `location.replace` starts a navigation and returns; the parser keeps going and the old
    // body could paint before the new page answers. Hidden, it paints nothing but its background.
    page.document.documentElement.style.visibility = "hidden";
    location.replace(
      `${config.base}/${segment}${path === "/" ? "" : path}${location.search}${location.hash}`,
    );
  } catch {
    // A gate that cannot decide leaves the reader on the page they asked for.
  }
}
