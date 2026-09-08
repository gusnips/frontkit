import { describe, expect, it } from "vitest";
import {
  ogImagePath,
  pageFile,
  pageSlug,
  robotsTxt,
  siteOrigin,
  sitemapFor,
  sitemapXml,
} from "./sitemap.ts";

describe("pageFile", () => {
  // Invariant 5: Cloudflare Pages serves `pricing/index.html` at `/pricing/` and answers
  // `/pricing` with a 308 — so every address the canonical and the sitemap advertise would be
  // a redirect rather than a page.
  it("is flat, never a directory index", () => {
    expect(pageFile("/pricing")).toBe("pricing.html");
    expect(pageFile("/pricing")).not.toBe("pricing/index.html");
  });

  it("names the front page index.html", () => {
    expect(pageFile("/")).toBe("index.html");
  });

  it("keeps a nested route's folders", () => {
    expect(pageFile("/guides/errors")).toBe("guides/errors.html");
  });

  it("ignores a trailing slash rather than writing `pricing/.html`", () => {
    expect(pageFile("/pricing/")).toBe("pricing.html");
  });
});

describe("pageSlug", () => {
  it("flattens a path into one name a card and a catalog can both use", () => {
    expect(pageSlug("/")).toBe("home");
    expect(pageSlug("/pricing")).toBe("pricing");
    expect(pageSlug("/guides/errors")).toBe("guides-errors");
    expect(ogImagePath("/pricing")).toBe("/og/pricing.png");
  });
});

describe("siteOrigin", () => {
  it("drops the trailing slash the caller's path would double", () => {
    expect(siteOrigin("https://acme.com/")).toBe("https://acme.com");
    expect(`${siteOrigin("https://acme.com/")}/pricing`).toBe("https://acme.com/pricing");
  });

  // `VITE_SITE_URL=acme.com` looks right in a .env and turns every canonical on the site into
  // a relative URL. That is a bad build, not a bad page.
  it("refuses a value with no scheme", () => {
    expect(() => siteOrigin("acme.com")).toThrow(/absolute origin/);
  });
});

describe("sitemapXml", () => {
  it("carries each entry's own alternates, so a crawler that never reads the head has them", () => {
    const xml = sitemapXml([
      {
        loc: "https://acme.com/pricing",
        changefreq: "weekly",
        priority: "0.9",
        lastmod: "2026-09-07",
        alternates: [{ hreflang: "pt-BR", href: "https://acme.com/pt/pricing" }],
      },
    ]);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain("<loc>https://acme.com/pricing</loc>");
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="pt-BR"');
    expect(xml).toContain("<lastmod>2026-09-07</lastmod>");
  });

  it("leaves lastmod out when there is none to state", () => {
    const xml = sitemapXml([{ loc: "https://acme.com/", changefreq: "weekly", priority: "1.0" }]);
    expect(xml).not.toContain("lastmod");
  });

  // A bare `&` is not valid XML, and an invalid sitemap is rejected whole rather than per entry.
  it("escapes an address that carries a query string", () => {
    const xml = sitemapXml([
      { loc: "https://acme.com/s?a=1&b=2", changefreq: "daily", priority: "0.5" },
    ]);
    expect(xml).toContain("<loc>https://acme.com/s?a=1&amp;b=2</loc>");
  });

  it("prints a computed priority to one decimal", () => {
    const xml = sitemapFor("https://acme.com/", [
      { path: "/pricing", priority: 0.1 + 0.2, changeFrequency: "weekly" },
    ]);
    expect(xml).toContain("<priority>0.3</priority>");
    expect(xml).toContain("<loc>https://acme.com/pricing</loc>");
  });
});

describe("robotsTxt", () => {
  // A crawler reads only the robots.txt at the origin ROOT, so an app served from a
  // subdirectory cannot ship its own — this one file has to name every sitemap on the origin,
  // or nothing ever finds the second one.
  it("lists every sitemap on the origin, on the origin", () => {
    const txt = robotsTxt({
      origin: "https://acme.com/",
      sitemaps: ["/sitemap.xml", "/docs/sitemap.xml"],
    });
    expect(txt).toContain("Sitemap: https://acme.com/sitemap.xml");
    expect(txt).toContain("Sitemap: https://acme.com/docs/sitemap.xml");
  });

  // The bug this shape prevents: a donor's static robots.txt and its build's fallback name
  // different domains, and neither is checked against the other.
  it("cannot name a host it is not served from", () => {
    const txt = robotsTxt({ origin: "https://acme.com", sitemaps: ["/sitemap.xml"] });
    expect(txt.match(/https:\/\//g)).toHaveLength(1);
  });

  it("keeps a private path out of every index", () => {
    const txt = robotsTxt({
      origin: "https://acme.com",
      sitemaps: ["/sitemap.xml"],
      disallow: ["/opt-out/"],
    });
    expect(txt).toContain("Disallow: /opt-out/");
    expect(txt.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
  });
});
