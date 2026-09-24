import { describe, expect, it } from "vitest";
import { createLocales, LOCALE_QUERY_PARAM } from "./index.ts";

// The three shapes the fleet actually ships: English-default with three languages, a
// Portuguese-default (the default is not always "en", which is why it is an argument), and a
// two-language product.
const EN = createLocales(["en", "pt-BR", "es"] as const, "en");
const PT = createLocales(["pt-BR", "en", "es"] as const, "pt-BR");

describe("the address shape", () => {
  it("leaves the default locale unprefixed and gives every other one its base subtag", () => {
    expect(EN.localePrefix("en")).toBe("");
    expect(EN.localePrefix("pt-BR")).toBe("/pt");
    expect(EN.localePrefix("es")).toBe("/es");
    // Flipping the default flips which language owns the bare addresses, and nothing else.
    expect(PT.localePrefix("pt-BR")).toBe("");
    expect(PT.localePrefix("en")).toBe("/en");
  });

  it("keeps the root a bare address rather than a prefix with a trailing slash", () => {
    expect(EN.localePath("en", "/")).toBe("/");
    expect(EN.localePath("pt-BR", "/")).toBe("/pt");
    expect(EN.localePath("pt-BR", "/terms")).toBe("/pt/terms");
  });

  it("round-trips a path through its locale", () => {
    for (const locale of ["en", "pt-BR", "es"] as const) {
      for (const path of ["/", "/terms", "/guides/bans"]) {
        expect(EN.splitLocalePath(EN.localePath(locale, path))).toEqual({ locale, path });
      }
    }
  });

  it("reads an unknown segment as the default locale's page, not as a language", () => {
    // `/es-AR/terms` is a 404 in the default language — never silently Spanish. The alternative
    // is a page that renders in a language the address did not ask for.
    expect(EN.splitLocalePath("/es-AR/terms")).toEqual({ locale: "en", path: "/es-AR/terms" });
    expect(EN.splitLocalePath("/terms")).toEqual({ locale: "en", path: "/terms" });
  });

  it("reads a localized root with or without a trailing slash as /", () => {
    // The prerender's filenames, the router's basename and the hydration marker all lean on
    // this: a host that normalizes one form to the other must not change which page it is.
    expect(EN.splitLocalePath("/pt")).toEqual({ locale: "pt-BR", path: "/" });
    expect(EN.splitLocalePath("/pt/")).toEqual({ locale: "pt-BR", path: "/" });
  });

  it("does not read the default locale's own tag as a segment", () => {
    // The default locale HAS no segment, so its own tag in a path is just a path: `/en/terms`
    // under an English default is a 404 called `/en/terms`, never a second address for the page
    // at `/terms`. Two live addresses for one page is the duplicate a canonical exists to
    // prevent. It is the case below — match the segment, not the tag — reached from the
    // default's side, and it is the half an adopter's test knew and the package's did not.
    expect(EN.splitLocalePath("/en/terms")).toEqual({ locale: "en", path: "/en/terms" });
    expect(PT.splitLocalePath("/pt-BR/termos")).toEqual({ locale: "pt-BR", path: "/pt-BR/termos" });
  });

  it("does not answer to a region-coded segment", () => {
    // One donor moved from `/pt-br` to `/pt` and 301s the old form at the edge. The app must
    // NOT resolve it as a second spelling — two live addresses for one page is the duplicate a
    // canonical exists to prevent.
    expect(EN.splitLocalePath("/pt-br/terms").locale).toBe("en");
  });

  it("never emits a capital in a segment, for any locale in the list", () => {
    for (const locale of ["en", "pt-BR", "es"] as const) {
      expect(EN.localeSegment(locale)).toBe(EN.localeSegment(locale).toLowerCase());
    }
  });

  it("matches the segment, not the tag", () => {
    // Comparing a pathname to the locale list by string equality is how `/pt` fails to match
    // `pt-BR`. The regionless segment is what is in the address.
    expect(EN.splitLocalePath("/pt/terms")).toEqual({ locale: "pt-BR", path: "/terms" });
    expect(EN.splitLocalePath("/PT/terms")).toEqual({ locale: "pt-BR", path: "/terms" });
  });

  it("narrows an untrusted string and refuses everything else", () => {
    expect(EN.asLocale("pt-BR")).toBe("pt-BR");
    expect(EN.asLocale("pt")).toBeNull();
    expect(EN.asLocale(null)).toBeNull();
    expect(EN.asLocale(undefined)).toBeNull();
    expect(EN.asLocale("")).toBeNull();
  });
});

describe("crossing to another origin", () => {
  const SITE = "https://docs.example.com";
  const APP = "https://app.example.com";

  it("puts the language in the path for a destination that has per-locale addresses", () => {
    expect(EN.localeUrl(SITE, "pt-BR")).toBe("https://docs.example.com/pt");
    expect(EN.localeUrl(SITE, "pt-BR", "/guides/bans")).toBe(
      "https://docs.example.com/pt/guides/bans",
    );
  });

  it("gives the default locale's root the path the caller passed", () => {
    // `origin + "/"`, not the bare origin: the default path IS "/", and a helper that drops it
    // is discarding an argument. Identical request either way; no special case is the tiebreak.
    expect(EN.localeUrl(SITE, "en")).toBe("https://docs.example.com/");
    expect(EN.localeUrl(SITE, "en", "/pricing")).toBe("https://docs.example.com/pricing");
  });

  it("puts the language in a query parameter for a destination that has none", () => {
    expect(EN.localeQueryUrl(APP, "pt-BR", "/register")).toBe(
      "https://app.example.com/register?lang=pt-BR",
    );
    expect(EN.localeQueryUrl(APP, "pt-BR")).toBe("https://app.example.com?lang=pt-BR");
  });

  it("emits the parameter for the default locale too", () => {
    // A reader on an unprefixed address has that language as their RESOLVED preference. Dropping
    // the parameter would let the destination re-sniff a browser that disagrees with what the
    // reader is plainly reading.
    expect(EN.localeQueryUrl(APP, "en", "/login")).toBe("https://app.example.com/login?lang=en");
  });

  it("appends to a query the caller already wrote", () => {
    expect(EN.localeQueryUrl(APP, "es", "/register?plan=pro")).toBe(
      "https://app.example.com/register?plan=pro&lang=es",
    );
  });

  it("keeps the fragment behind the query", () => {
    // Written the obvious way this reads `/pricing#plans?lang=es`, where the whole parameter is
    // part of the fragment and the language never arrives — the exact failure this prevents.
    expect(EN.localeQueryUrl(APP, "es", "/pricing#plans")).toBe(
      "https://app.example.com/pricing?lang=es#plans",
    );
  });

  it("uses one spelling of the parameter, and lets a product override it", () => {
    expect(LOCALE_QUERY_PARAM).toBe("lang");
    const custom = createLocales(["en", "pt-BR"] as const, "en", { queryParam: "hl" });
    expect(custom.localeQueryUrl(APP, "pt-BR", "/x")).toBe("https://app.example.com/x?hl=pt-BR");
  });
});

describe("reading what a reader asks for", () => {
  it("walks the reader's list in their order, exact tag before base subtag", () => {
    expect(EN.matchLocale(["es", "en"])).toBe("es");
    // i18next's own matcher answers English here: it takes an exact match anywhere in the list
    // before it tries a base subtag. The reader put Portuguese first.
    expect(EN.matchLocale(["pt-PT", "en"])).toBe("pt-BR");
    expect(EN.matchLocale(["pt"])).toBe("pt-BR");
    expect(EN.matchLocale(["PT-br"])).toBe("pt-BR");
    expect(EN.matchLocale(["de", "es-MX"])).toBe("es");
    expect(EN.matchLocale(["de", "fr"])).toBeNull();
    expect(EN.matchLocale(["", " "])).toBeNull();
    expect(EN.matchLocale([])).toBeNull();
  });

  it("takes an exact tag over an earlier locale that only shares its base", () => {
    const both = createLocales(["pt-BR", "pt-PT"] as const, "pt-BR");
    expect(both.matchLocale(["pt-PT"])).toBe("pt-PT");
    // A bare base names neither; the first one listed answers.
    expect(both.matchLocale(["pt"])).toBe("pt-BR");
  });

  it("reads every tag of an Accept-Language header, not just the first", () => {
    // A German speaker who also reads Portuguese. Reading only the first tag saved the default
    // language on their account, and with it every e-mail after.
    expect(EN.localeFromAcceptLanguage("de-DE,de;q=0.9,pt-BR;q=0.8,en;q=0.7")).toBe("pt-BR");
    expect(EN.localeFromAcceptLanguage("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("pt-BR");
    expect(EN.localeFromAcceptLanguage("es-MX")).toBe("es");
  });

  it("ranks by weight, keeps the order sent for equal weights, and drops q=0", () => {
    expect(EN.localeFromAcceptLanguage("en;q=0.5, es;q=0.8")).toBe("es");
    expect(EN.localeFromAcceptLanguage("es, pt-BR")).toBe("es");
    expect(EN.localeFromAcceptLanguage("pt-BR;q=0.7, es;q=0.7")).toBe("pt-BR");
    // `q=0` means "not this one", so the tag it sits on is no answer at all.
    expect(EN.localeFromAcceptLanguage("pt-BR;q=0, fr")).toBeNull();
    expect(EN.localeFromAcceptLanguage("pt-BR;Q=0.000, es;q=0.1")).toBe("es");
  });

  it("answers null for a header that asks for nothing we ship", () => {
    expect(EN.localeFromAcceptLanguage(null)).toBeNull();
    expect(EN.localeFromAcceptLanguage(undefined)).toBeNull();
    expect(EN.localeFromAcceptLanguage("")).toBeNull();
    expect(EN.localeFromAcceptLanguage("*")).toBeNull();
    expect(EN.localeFromAcceptLanguage("fr-FR,fr;q=0.9")).toBeNull();
  });
});
