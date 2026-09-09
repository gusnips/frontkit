import { describe, expect, it } from "vitest";
import { resolveKey } from "./catalog.ts";

const catalog = {
  seo: { home: { title: "Turn your WhatsApp into an API" } },
  faq: { q1: "Can my number get banned?" },
  nested: { notAString: { deeper: "x" } },
};

describe("resolveKey", () => {
  it("walks a dotted key to its string", () => {
    expect(resolveKey(catalog, "seo.home.title")).toBe("Turn your WhatsApp into an API");
    expect(resolveKey(catalog, "faq.q1")).toBe("Can my number get banned?");
  });

  // The key coming back is how a build makes a stale one visible: `seo.old.title` in the tab and
  // in the search result beats an empty tag nobody notices.
  it("hands back the key it could not find", () => {
    expect(resolveKey(catalog, "seo.pricing.title")).toBe("seo.pricing.title");
    expect(resolveKey(catalog, "faq.q1.deeper")).toBe("faq.q1.deeper");
    expect(resolveKey(catalog, "nested.notAString")).toBe("nested.notAString");
    expect(resolveKey(undefined, "seo.home.title")).toBe("seo.home.title");
  });

  // Both donors used `in`, which walks the prototype: this returned the literal string "Object"
  // and would have shipped it as a page title.
  it("never reaches a prototype member", () => {
    expect(resolveKey(catalog, "faq.constructor.name")).toBe("faq.constructor.name");
    expect(resolveKey(catalog, "seo.toString")).toBe("seo.toString");
  });
});
