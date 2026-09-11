import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { applyBrandVars, i18nInitOptions, type I18nInitOptions } from "./i18n.ts";

describe("applyBrandVars", () => {
  it("fills placeholders anywhere in the tree and leaves the input alone", () => {
    const input = { a: { b: ["Welcome to {{brand}}", "at {{brandDomain}}"] }, n: 1 };
    const out = applyBrandVars(input, { brand: "Example", brandDomain: "example.com" });

    expect(out).toEqual({ a: { b: ["Welcome to Example", "at example.com"] }, n: 1 });
    expect(input.a.b[0]).toBe("Welcome to {{brand}}");
  });

  // The names come from `vars`, so adding one needs no edit here. Both donors hardcoded their
  // own list inside the regex and both had to remember to keep it in step.
  it("derives the placeholder names from vars, not from a hardcoded list", () => {
    expect(applyBrandVars("{{anythingAtAll}}", { anythingAtAll: "yes" })).toBe("yes");
  });

  it("leaves an unknown placeholder alone rather than blanking it", () => {
    // Blanking would silently ship "Contact  for help". Leaving it visible fails loudly.
    expect(applyBrandVars("Contact {{nobody}}", { brand: "Example" })).toBe("Contact {{nobody}}");
  });

  it("is a no-op with no vars", () => {
    const input = { a: "{{brand}}" };
    expect(applyBrandVars(input, {})).toBe(input);
  });
});

/** For a browser saying `lng`: the app's `i18n.language`, and the catalog that answers. */
async function settle(
  options: Omit<I18nInitOptions, "storageKey">,
  lng: string,
): Promise<[language: string, catalog: string]> {
  const i18n = createInstance();
  const resources = Object.fromEntries(
    options.supportedLngs.map((tag) => [tag, { translation: { tag } }]),
  );
  await i18n.init({ ...i18nInitOptions({ ...options, storageKey: "app.locale" }), resources, lng });
  return [i18n.language, i18n.t("tag")];
}

describe("i18nInitOptions", () => {
  // `nonExplicitSupportedLngs` breaks both catalog shapes, and this pins both. Region-coded, the
  // app renders English for a pt-BR reader — the bug both donors' comments name. Base codes, an
  // "en-US" browser keeps "en-US" as `i18n.language`, which is what an app keys `<html lang>` and
  // `og:locale` by: the third migration's site missed its lookup and shipped English copy as
  // `lang="pt-BR"`.
  it("settles a browser's regional tag on a language the catalogs have", async () => {
    const baseCodes = { fallbackLng: "pt", supportedLngs: ["pt", "es", "en"] };
    expect(await settle(baseCodes, "en-US")).toEqual(["en", "en"]);
    expect(await settle(baseCodes, "es-419")).toEqual(["es", "es"]);
    expect(await settle(baseCodes, "fr-FR")).toEqual(["pt", "pt"]);

    const regionCoded = { fallbackLng: "en", supportedLngs: ["en", "pt-BR"] };
    expect(await settle(regionCoded, "pt-BR")).toEqual(["pt-BR", "pt-BR"]);
    expect(await settle(regionCoded, "en-GB")).toEqual(["en", "en"]);
  });

  // Only one donor had the query parameter, and it is the only detection source somebody chose
  // on purpose and just now — so it goes first, ahead of storage and the browser.
  it("detects the query parameter first when one is given", () => {
    expect(
      i18nInitOptions({
        fallbackLng: "en",
        supportedLngs: ["en"],
        storageKey: "app.locale",
        queryKey: "lang",
      }).detection,
    ).toMatchObject({
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lang",
    });
  });

  it("omits the query source entirely when no key is given", () => {
    const { detection } = i18nInitOptions({
      fallbackLng: "en",
      supportedLngs: ["en"],
      storageKey: "app.locale",
    });
    expect(detection.order).toEqual(["localStorage", "navigator"]);
    expect(detection).not.toHaveProperty("lookupQuerystring");
  });
});
