import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createLocales, localeGateScript, type LocaleGateOptions } from "./index.ts";

const EN = ["en", "pt-BR", "es"] as const;
const PT = ["pt-BR", "en", "es"] as const;

interface Visit {
  address: string;
  languages?: readonly string[] | undefined;
  language?: string;
  stored?: Record<string, string>;
  storage?: "ok" | "blocked" | "throws";
}

/**
 * A page with nothing in it but the global object a classic `<head>` script gets. The script is
 * run from its TEXT, the way the browser runs the file: a helper or import the serialized
 * function reaches for outside itself is a `ReferenceError` here, as it would be in the page.
 */
function visit(options: LocaleGateOptions<readonly string[]>, v: Visit) {
  const url = new URL(v.address, "https://example.test");
  const stored = v.stored ?? {};
  const keys = Object.keys(stored);
  const storage = {
    getItem: (key: string) => {
      if (v.storage === "throws") throw new Error("SecurityError");
      return stored[key] ?? null;
    },
    key: (index: number) => keys[index] ?? null,
    get length() {
      return keys.length;
    },
  };
  let replaced: string | null = null;
  const style = { visibility: "" };
  const page = {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace: (to: string) => {
        replaced = to;
      },
    },
    navigator: { languages: "languages" in v ? v.languages : ["en-US"], language: v.language },
    get localStorage() {
      if (v.storage === "blocked") throw new Error("SecurityError: site data blocked");
      return storage;
    },
    document: { documentElement: { style } },
  };
  runInNewContext(localeGateScript(options), page);
  // Hidden exactly when it leaves: the page that stays must never be blanked.
  expect(style.visibility).toBe(replaced === null ? "" : "hidden");
  return replaced;
}

const site = { locales: EN, defaultLocale: "en", storageKey: "app.locale" } as const;

describe("localeGateScript", () => {
  it("sends a reader off an unprefixed address to their language", () => {
    expect(visit(site, { address: "/pricing", languages: ["pt-BR", "en"] })).toBe("/pt/pricing");
    expect(visit(site, { address: "/", languages: ["pt-BR"] })).toBe("/pt");
    expect(visit(site, { address: "/pricing/", languages: ["es"] })).toBe("/es/pricing/");
  });

  it("keeps the query and the fragment", () => {
    expect(visit(site, { address: "/pricing?plan=pro#faq", languages: ["pt-BR"] })).toBe(
      "/pt/pricing?plan=pro#faq",
    );
  });

  it("never second-guesses an address that names its language", () => {
    expect(visit(site, { address: "/pt/pricing", languages: ["es"] })).toBeNull();
    expect(visit(site, { address: "/es", languages: ["pt-BR"] })).toBeNull();
    expect(visit(site, { address: "/PT/pricing", languages: ["es"] })).toBeNull();
  });

  it("stays put for a reader who wants the default or a language we do not ship", () => {
    expect(visit(site, { address: "/pricing", languages: ["en-GB", "pt-BR"] })).toBeNull();
    expect(visit(site, { address: "/pricing", languages: ["fr", "de"] })).toBeNull();
  });

  it("puts a stored choice ahead of the browser, including a choice of the default", () => {
    const stored = (value: string) => ({ "app.locale": value });
    expect(visit(site, { address: "/x", languages: ["pt-BR"], stored: stored("es") })).toBe(
      "/es/x",
    );
    expect(visit(site, { address: "/x", languages: ["pt-BR"], stored: stored("en") })).toBeNull();
    expect(visit(site, { address: "/x", languages: ["pt-BR"], stored: stored("klingon") })).toBe(
      "/pt/x",
    );
  });

  // Two copies walked OUR list and asked whether the reader's contained it, which hands a reader
  // on [es, en] English because we list it first, and misses `pt` and `pt-PT` entirely.
  it("walks the reader's languages in their order, exact tag before base subtag", () => {
    expect(visit(site, { address: "/x", languages: ["es", "en"] })).toBe("/es/x");
    expect(visit(site, { address: "/x", languages: ["pt-PT"] })).toBe("/pt/x");
    expect(visit(site, { address: "/x", languages: ["pt"] })).toBe("/pt/x");
    expect(visit(site, { address: "/x", languages: ["pt-br"] })).toBe("/pt/x");
    expect(visit(site, { address: "/x", languages: ["de", "es-MX"] })).toBe("/es/x");
    expect(visit(site, { address: "/x", languages: undefined, language: "es-MX" })).toBe("/es/x");
  });

  // One copy read storage unguarded, so blocked site data threw before the app could mount.
  it("falls back to the browser when storage is blocked or refuses a read", () => {
    const stored = { "app.locale": "es" };
    expect(visit(site, { address: "/x", languages: ["pt-BR"], stored, storage: "blocked" })).toBe(
      "/pt/x",
    );
    expect(visit(site, { address: "/x", languages: ["pt-BR"], stored, storage: "throws" })).toBe(
      "/pt/x",
    );
  });

  it("works under a mount point and leaves the rest of the origin alone", () => {
    const docs = { ...site, base: "/docs/" };
    expect(visit(docs, { address: "/docs/errors", languages: ["pt-BR"] })).toBe("/docs/pt/errors");
    expect(visit(docs, { address: "/docs", languages: ["pt-BR"] })).toBe("/docs/pt");
    expect(visit(docs, { address: "/docs/pt/errors", languages: ["es"] })).toBeNull();
    expect(visit(docs, { address: "/pricing", languages: ["pt-BR"] })).toBeNull();
    expect(visit(docs, { address: "/docsx", languages: ["pt-BR"] })).toBeNull();
  });

  it("never touches an app screen served beside the public site", () => {
    const app = { ...site, exclude: ["/w/", "/login"] };
    expect(visit(app, { address: "/w/gus", languages: ["pt-BR"] })).toBeNull();
    expect(visit(app, { address: "/w", languages: ["pt-BR"] })).toBeNull();
    expect(visit(app, { address: "/login", languages: ["pt-BR"] })).toBeNull();
    expect(visit(app, { address: "/wall", languages: ["pt-BR"] })).toBe("/pt/wall");
  });

  it("leaves a signed-in reader, and one signing in right now, to their account's language", () => {
    const app = { ...site, signedInKey: /^sb-.+-auth-token$/g };
    const session = { "sb-db-auth-token": "{}" };
    expect(visit(app, { address: "/", languages: ["pt-BR"], stored: session })).toBeNull();
    expect(visit(app, { address: "/#access_token=abc", languages: ["pt-BR"] })).toBeNull();
    expect(visit(app, { address: "/?code=abc", languages: ["pt-BR"] })).toBeNull();
    expect(visit(app, { address: "/", languages: ["pt-BR"], stored: { other: "1" } })).toBe("/pt");
  });

  it("follows the product's default, which is not always English", () => {
    const pt = { locales: PT, defaultLocale: "pt-BR", storageKey: "k" } as const;
    expect(visit(pt, { address: "/precos", languages: ["en-US"] })).toBe("/en/precos");
    expect(visit(pt, { address: "/precos", languages: ["pt-BR"] })).toBeNull();
    expect(visit(pt, { address: "/en/precos", languages: ["pt-BR"] })).toBeNull();
  });

  // The addresses come from `createLocales`, so the gate and the router cannot disagree.
  it("sends every reader to the address createLocales gives their language", () => {
    const { localePath } = createLocales(EN, "en");
    for (const [locale, tag] of [
      ["pt-BR", "pt-BR"],
      ["es", "es"],
    ] as const) {
      for (const path of ["/", "/terms", "/guides/bans"]) {
        expect(visit(site, { address: path, languages: [tag] })).toBe(localePath(locale, path));
      }
    }
  });
});
