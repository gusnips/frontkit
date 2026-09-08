import { describe, expect, it } from "vitest";
import { applyBrandVars, i18nInitOptions } from "./i18n.ts";

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

describe("i18nInitOptions", () => {
  // The comment in both donors names the bug: `nonExplicitSupportedLngs` validates the BASE
  // subtag, which rejects "pt-BR" (its base "pt" is not listed) and silently falls the whole
  // app back to English. Its absence is load-bearing.
  it("does not set nonExplicitSupportedLngs", () => {
    const options = i18nInitOptions({
      fallbackLng: "en",
      supportedLngs: ["en", "pt-BR"],
      storageKey: "app.locale",
    });
    expect(options).not.toHaveProperty("nonExplicitSupportedLngs");
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
