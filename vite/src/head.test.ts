import { describe, expect, it } from "vitest";
import { PRERENDERED_ROUTE_ATTR } from "@gusnips/react";
import { assertRendered, bakeHead, ogLocale } from "./head.ts";

/**
 * Every failure `bakeHead` has is invisible until somebody reads a search result months later
 * — a canonical that survived onto a 404, an `og:locale` still claiming English on a Portuguese
 * file, a body that never went in. `assertRendered` checks a written page as a whole; this
 * checks the branches it cannot see the inside of.
 */

/** A template carrying the full donor tag set: OG, Twitter, and the `name="title"` two of the
 *  three donors ship. */
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <title>front</title>
    <meta name="title" content="front" />
    <meta name="description" content="front" />
    <link rel="canonical" href="https://acme.com/" />
    <meta property="og:title" content="front" />
    <meta property="og:description" content="front" />
    <meta property="og:url" content="https://acme.com/" />
    <meta property="og:image" content="https://acme.com/og.png" />
    <meta property="twitter:title" content="front" />
    <meta property="twitter:description" content="front" />
    <meta property="twitter:url" content="https://acme.com/" />
    <meta property="twitter:image" content="https://acme.com/og.png" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

/** The leaner set a third donor ships: no `name="title"`, no `twitter:` pair. */
const LEAN_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <title>front</title>
    <meta name="description" content="front" />
    <link rel="canonical" href="https://acme.com/" />
    <meta property="og:title" content="front" />
    <meta property="og:description" content="front" />
    <meta property="og:url" content="https://acme.com/" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const BASE = { title: "T", description: "D", canonical: "https://acme.com/pricing" };

describe("bakeHead", () => {
  it("writes the page's own title, description and share text", () => {
    const html = bakeHead(TEMPLATE, { ...BASE, ogTitle: "share", ogDescription: "sub" });
    expect(html).toContain("<title>T</title>");
    expect(html).toContain('<meta name="description" content="D" />');
    expect(html).toContain('<meta property="og:title" content="share" />');
    expect(html).toContain('<meta property="twitter:description" content="sub" />');
    expect(html).toContain('<link rel="canonical" href="https://acme.com/pricing" />');
    expect(html).toContain('<meta property="og:url" content="https://acme.com/pricing" />');
  });

  it("falls back to the page's own words for the share tags", () => {
    const html = bakeHead(TEMPLATE, BASE);
    expect(html).toContain('<meta property="og:title" content="T" />');
    expect(html).toContain('<meta property="twitter:title" content="T" />');
  });

  it("escapes what it writes into an attribute", () => {
    const html = bakeHead(TEMPLATE, { ...BASE, description: 'a "quote" & <tag>' });
    expect(html).toContain('content="a &quot;quote&quot; &amp; &lt;tag&gt;"');
  });

  // The whole reason `setMeta` throws: editing index.html must fail the build, never ship a
  // page quietly wearing the front door's description.
  it("refuses a template missing a tag a crawler depends on", () => {
    const stripped = TEMPLATE.replace(/<meta property="og:title"[^>]*>/, "");
    expect(() => bakeHead(stripped, BASE)).toThrow(/og:title/);
  });

  // …and the exception: nothing reads `name="title"`, and X reads `og:` when `twitter:` is
  // absent. A template without them is correct, so demanding them would break a real app.
  it("skips the optional tags a template does not carry", () => {
    const html = bakeHead(LEAN_TEMPLATE, BASE);
    expect(html).toContain('<meta property="og:title" content="T" />');
    expect(html).not.toContain("twitter:");
    expect(html).not.toContain('name="title"');
  });

  it("strips the canonical and the share URL rather than blanking them", () => {
    const html = bakeHead(TEMPLATE, { ...BASE, canonical: null, noindex: true });
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(html).not.toContain('property="twitter:url"');
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });

  // An empty canonical is a claim about "" and an empty og:url is a share card pointing at the
  // origin root, which is what the strip exists to avoid.
  it("leaves no blank URL behind on a page with no canonical", () => {
    const html = bakeHead(TEMPLATE, { ...BASE, canonical: null });
    expect(html).not.toContain('href=""');
    expect(html).not.toContain('content=""');
  });

  // The card is a picture, not a claim about this address: a dead link that still unfurls the
  // brand card is fine, and a 404 with no image at all is not better.
  it("keeps the share card on a page with no canonical", () => {
    const html = bakeHead(TEMPLATE, { ...BASE, canonical: null });
    expect(html).toContain('<meta property="og:image" content="https://acme.com/og.png" />');
  });

  it("lists every alternate, reciprocally, including this page's own", () => {
    const html = bakeHead(TEMPLATE, {
      ...BASE,
      alternates: [
        { hreflang: "en", href: "https://acme.com/pricing" },
        { hreflang: "pt-BR", href: "https://acme.com/pt/pricing" },
        { hreflang: "x-default", href: "https://acme.com/pricing" },
      ],
    });
    expect(html.match(/rel="alternate"/g)).toHaveLength(3);
    expect(html).toContain('hreflang="pt-BR" href="https://acme.com/pt/pricing"');
  });

  it("marks the file's own language for a crawler and a screen reader", () => {
    const html = bakeHead(TEMPLATE, { ...BASE, lang: "pt-BR" });
    expect(html).toContain('<html lang="pt-BR">');
  });

  it("refuses a template whose <html> has no lang to rewrite", () => {
    const stripped = TEMPLATE.replace('<html lang="en">', "<html>");
    expect(() => bakeHead(stripped, { ...BASE, lang: "pt-BR" })).toThrow(/<html lang>/);
  });

  // Invariant 6: absent, `og:locale` does not default to "unknown" — it defaults to en_US, so
  // a Portuguese page with a Portuguese og:title told every share crawler the card was English.
  it("states og:locale, and the other languages the page exists in", () => {
    const html = bakeHead(TEMPLATE, {
      ...BASE,
      lang: "pt-BR",
      alternates: [
        { hreflang: "en", href: "https://acme.com/pricing" },
        { hreflang: "pt-BR", href: "https://acme.com/pt/pricing" },
        { hreflang: "x-default", href: "https://acme.com/pricing" },
      ],
    });
    expect(html).toContain('<meta property="og:locale" content="pt_BR" />');
    expect(html).toContain('<meta property="og:locale:alternate" content="en_US" />');
    // Not itself, and not x-default — neither is another language this page exists in.
    expect(html.match(/og:locale:alternate/g)).toHaveLength(1);
  });

  // A template that already carries one would otherwise end up with two, and a crawler reading
  // the first would get the template's language on every page.
  it("replaces an og:locale the template already carries", () => {
    const withLocale = TEMPLATE.replace(
      "</head>",
      '  <meta property="og:locale" content="en_US" />\n  </head>',
    );
    const html = bakeHead(withLocale, { ...BASE, lang: "pt-BR" });
    expect(html.match(/property="og:locale"/g)).toHaveLength(1);
    expect(html).toContain('content="pt_BR"');
  });

  it("puts the render inside the root and names the route it is a render of", () => {
    const html = bakeHead(TEMPLATE, {
      ...BASE,
      body: { route: "/pricing", html: "<main>hi</main>" },
    });
    expect(html).toContain(
      `<div id="root" ${PRERENDERED_ROUTE_ATTR}="/pricing"><main>hi</main></div>`,
    );
  });

  it("refuses to bake a page into a page", () => {
    const once = bakeHead(TEMPLATE, { ...BASE, body: { route: "/", html: "<main>hi</main>" } });
    expect(() =>
      bakeHead(once, { ...BASE, body: { route: "/x", html: "<main>x</main>" } }),
    ).toThrow(/root/);
  });

  it("carries structured data through untouched", () => {
    const html = bakeHead(TEMPLATE, {
      ...BASE,
      headExtra: '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
    });
    expect(html).toContain('<script type="application/ld+json">{"@type":"FAQPage"}</script>');
  });
});

describe("ogLocale", () => {
  it("gives en and es the territory Open Graph will not infer", () => {
    expect(ogLocale("en")).toBe("en_US");
    expect(ogLocale("es")).toBe("es_ES");
  });

  it("respells a tag that already carries its territory", () => {
    expect(ogLocale("pt-BR")).toBe("pt_BR");
  });
});

describe("assertRendered", () => {
  const shell = `<html lang="en"><head><title>T</title></head><body><div id="root"></div></body></html>`;
  const page = (body: string): string => shell.replace('<div id="root"></div>', body);
  const long = `<main>${"x".repeat(800)}</main>`;

  it("passes a page with a real body in it", () => {
    expect(() =>
      assertRendered("pricing.html", page(`<div id="root">${long}</div>`), shell),
    ).not.toThrow();
  });

  // Invariant 1: a router whose basename does not match its location renders "" with no error
  // and no warning. Only the bytes catch it.
  it("catches a root that rendered to nothing", () => {
    expect(() => assertRendered("pricing.html", shell, shell)).toThrow(/nothing rendered/);
  });

  // The size floor is not enough, and a donor proved it: a route rendered its LoadingScreen at
  // 1,174 bytes, comfortably over the floor, with an element inside the root and a good title.
  it("catches a file whose body is the loading screen", () => {
    const spinner = `<div id="root"><div role="status" aria-label="Loading">${"x".repeat(800)}</div></div>`;
    expect(() => assertRendered("pricing.html", page(spinner), shell)).toThrow(/loading screen/);
  });

  // The reason the check slices rather than matching in one pattern: a regex that skips
  // Suspense markers can backtrack across the whole document and find a `role="status"` 40 KB
  // down in a perfectly good page.
  it("does not mistake a status role deep in a real page for a spinner", () => {
    const deep = `<div id="root"><main>${"x".repeat(2000)}<div role="status">saved</div></main></div>`;
    expect(() => assertRendered("pricing.html", page(deep), shell)).not.toThrow();
  });

  it("sees past React's Suspense comment markers", () => {
    const suspended = `<div id="root"><!--$--><main>${"x".repeat(800)}</main><!--/$--></div>`;
    expect(() => assertRendered("pricing.html", page(suspended), shell)).not.toThrow();
  });

  it("catches an unsubstituted html placeholder", () => {
    const raw = page(`<div id="root"><main>%BRAND_NAME% ${"x".repeat(800)}</main></div>`);
    expect(() => assertRendered("pricing.html", raw, shell)).toThrow(/%BRAND_NAME%/);
  });

  // `/caf%C3%A9` contains `%C3%`, and an accented slug is not a broken build.
  it("does not mistake a percent-encoded link for a placeholder", () => {
    const link = `<div id="root"><main><a href="/caf%C3%A9">x</a>${"x".repeat(800)}</main></div>`;
    expect(() => assertRendered("pricing.html", page(link), shell)).not.toThrow();
  });

  it("catches a file that is not marked as the language it was baked for", () => {
    const html = page(`<div id="root">${long}</div>`);
    expect(() => assertRendered("pt/pricing.html", html, shell, { lang: "pt-BR" })).toThrow(
      /not marked as pt-BR/,
    );
  });
});
