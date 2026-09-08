/**
 * The head a crawler sees, baked at build time.
 *
 * A Vite SPA ships one `index.html` and draws everything else with JavaScript. Nothing that
 * reads a link for a living runs that bundle — not Google's first pass, not Bing, not an LLM
 * crawler, not whatever draws the preview card in Slack. So the build rewrites the template
 * once per route and writes a real file per page, with a real `<head>` AND a real body.
 *
 * Pure string work, on purpose: no `node:` import anywhere in this file, so every branch is
 * unit-testable without a filesystem. The reading and writing lives in `node.ts`.
 */
import { PRERENDERED_ROUTE_ATTR } from "@gusnips/react";
import { escapeAttr, escapeRegex } from "./escape.ts";

/** The empty root a template must carry — `bakeHead` fills it, and refuses a filled one. */
export const EMPTY_ROOT = '<div id="root"></div>';

/** `[^>]*` on both sides tolerates the attributes being split across lines, as Vite emits them. */
const metaRe = (selector: string): RegExp =>
  new RegExp(`(<meta[^>]*${escapeRegex(selector)}[^>]*content=")[^"]*(")`);

/**
 * Replace the `content` of one `<meta …>`. Throws when the tag is missing, so an edit to
 * `index.html` fails the build instead of silently shipping the front door's description to
 * every crawler.
 */
function setMeta(html: string, selector: string, value: string): string {
  const re = metaRe(selector);
  if (!re.test(html)) throw new Error(`prerender: <meta ${selector}> not found in index.html`);
  return html.replace(re, `$1${escapeAttr(value)}$2`);
}

/**
 * The same, for a tag a template is allowed not to carry.
 *
 * Only the `twitter:` pair and `name="title"` get this. X reads the `og:` tags when the
 * `twitter:` ones are absent, and no crawler reads `name="title"` at all — so a template that
 * omits them is correct, and demanding them would break an app that never had them. A template
 * that DOES carry one and gets a stale value is still a bug, which is why they are written
 * rather than ignored. Everything a crawler actually depends on goes through `setMeta`.
 */
function setMetaIfPresent(html: string, selector: string, value: string): string {
  const re = metaRe(selector);
  return re.test(html) ? html.replace(re, `$1${escapeAttr(value)}$2`) : html;
}

/** One `<link rel="alternate" hreflang>` — this page's address in another language. */
export interface Alternate {
  /** A BCP-47 tag, or `x-default` for the address a crawler should show when it has no reason
   *  to prefer one. */
  hreflang: string;
  href: string;
}

export interface HeadTags {
  /** `<title>`, and the share title unless overridden. */
  title: string;
  /** `name="description"`, and the share description unless overridden. */
  description: string;
  /**
   * The page's own URL, for `<link rel="canonical">` and the share tags.
   *
   * `null` means this page has no canonical URL and must not claim one — the 404 shell, which
   * is served for every address that does not exist and would otherwise tell a crawler that
   * all of them are the front page.
   */
  canonical: string | null;
  ogTitle?: string;
  ogDescription?: string;
  /** Absolute URL of the share card. Omit where the template carries no `og:image` tag at all
   *  — setting one there is a build error, by design. */
  image?: string;
  /** Markup inserted before `</head>` — structured data, and nothing else so far. Emitted here
   *  because its only reader is a crawler. */
  headExtra?: string;
  /** Keep this page out of every index. Pairs with `canonical: null`. */
  noindex?: boolean;
  /**
   * `<html lang>`, when this page is not in the template's language, and the `og:locale` that
   * goes with it.
   *
   * A crawler and a screen reader both read `lang`, and neither runs the bundle that would
   * otherwise set it — so a Portuguese file whose `<html>` still says `en` is announced in the
   * wrong voice and indexed as the wrong language.
   */
  lang?: string;
  /**
   * Every language this page exists in, INCLUDING this one, plus `x-default`.
   *
   * Reciprocal by contract: a crawler ignores the whole set unless each address in it points
   * back at the others, which is why the caller passes the full list to every page rather than
   * "the other two".
   */
  alternates?: readonly Alternate[];
  /**
   * The rendered page, injected into `<div id="root">`, and the route it is a render OF.
   *
   * The head alone was never enough. A shipped `<div id="root"></div>` is a page whose entire
   * content is a description tag — it can be listed, and it can never be read, quoted or
   * answered from.
   *
   * The two travel together because markup alone is not enough to hydrate against. A static
   * host answers every unpublished address with the nearest `404.html`, and that file has a
   * rendered body in it — so a route served from the shell would find a full root and hydrate
   * the not-found page into a page that is not it. The marker is what the browser entry
   * compares its own route against before deciding to hydrate or to mount fresh.
   */
  body?: { route: string; html: string };
}

/**
 * A BCP-47 tag in Open Graph's spelling: underscore, and a TERRITORY it will not infer.
 *
 * `og:locale` wants `language_TERRITORY` and quietly ignores anything else, which is the same
 * outcome as omitting it — the `en_US` default. So a Portuguese page with a Portuguese
 * `og:title` and no `og:locale` tells every share crawler the card is English. `pt-BR` already
 * carries its territory; `en` and `es` do not, so one is chosen here rather than left to a
 * crawler. `es_ES` is not a claim that the copy is peninsular Spanish — it is the most widely
 * recognised Spanish value, and the tag's job is to be understood, not precise about dialect.
 */
export function ogLocale(tag: string): string {
  const TERRITORY: Record<string, string> = { en: "en_US", es: "es_ES" };
  return TERRITORY[tag] ?? tag.replace("-", "_");
}

/**
 * One page's `<head>` and body, written into the built template.
 *
 * Every tag is SET rather than appended, and `setMeta` throws on a tag the template does not
 * carry — so the failure mode of editing `index.html` is a red build, never a page quietly
 * shipping somebody else's description.
 */
export function bakeHead(template: string, tags: HeadTags): string {
  const shareTitle = tags.ogTitle ?? tags.title;
  const shareDescription = tags.ogDescription ?? tags.description;

  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(tags.title)}</title>`);
  html = setMeta(html, 'name="description"', tags.description);
  html = setMeta(html, 'property="og:title"', shareTitle);
  html = setMeta(html, 'property="og:description"', shareDescription);
  html = setMetaIfPresent(html, 'name="title"', tags.title);
  html = setMetaIfPresent(html, 'property="twitter:title"', shareTitle);
  html = setMetaIfPresent(html, 'property="twitter:description"', shareDescription);

  if (tags.image !== undefined) {
    html = setMeta(html, 'property="og:image"', tags.image);
    html = setMetaIfPresent(html, 'property="twitter:image"', tags.image);
  }

  if (tags.canonical === null) {
    // Strip rather than blank: an empty canonical is a claim about "" and an empty og:url is a
    // share card pointing at the origin root. The image is left alone — it is a picture, not a
    // claim about this address, and a dead link that still unfurls the brand card is fine.
    html = html
      .replace(/\s*<link rel="canonical"[^>]*>/, "")
      .replace(/\s*<meta property="(?:og|twitter):url"[^>]*>/g, "");
  } else {
    html = setMeta(html, 'property="og:url"', tags.canonical);
    html = setMetaIfPresent(html, 'property="twitter:url"', tags.canonical);
    html = html.replace(
      /(<link rel="canonical" href=")[^"]*(")/,
      `$1${escapeAttr(tags.canonical)}$2`,
    );
  }

  if (tags.alternates?.length) {
    const links = tags.alternates
      .map(
        (alt) =>
          `    <link rel="alternate" hreflang="${escapeAttr(alt.hreflang)}" href="${escapeAttr(alt.href)}" />`,
      )
      .join("\n");
    html = html.replace("</head>", `${links}\n  </head>`);
  }

  if (tags.lang !== undefined) {
    // `og:locale` is not the same claim as `<html lang>` and is read by different machines.
    // APPENDED rather than set, because a Vite template carries no such tag — but one that
    // does would end up with two, and a crawler reading the first would get the template's
    // language on every page. So drop whatever is there before writing this page's own.
    html = html.replace(/\s*<meta property="og:locale(?::alternate)?"[^>]*>/g, "");
    const alternates = (tags.alternates ?? [])
      .filter((alt) => alt.hreflang !== "x-default" && alt.hreflang !== tags.lang)
      .map(
        (alt) =>
          `    <meta property="og:locale:alternate" content="${escapeAttr(ogLocale(alt.hreflang))}" />`,
      );
    html = html.replace(
      "</head>",
      `    <meta property="og:locale" content="${escapeAttr(ogLocale(tags.lang))}" />\n${
        alternates.length ? `${alternates.join("\n")}\n` : ""
      }  </head>`,
    );
  }

  if (tags.noindex)
    html = html.replace("</head>", `    <meta name="robots" content="noindex" />\n  </head>`);
  if (tags.headExtra) html = html.replace("</head>", `    ${tags.headExtra}\n  </head>`);

  if (tags.lang !== undefined) {
    const re = /(<html[^>]*\blang=")[^"]*(")/;
    if (!re.test(html)) throw new Error("prerender: <html lang> not found in index.html");
    html = html.replace(re, `$1${escapeAttr(tags.lang)}$2`);
  }

  if (tags.body !== undefined) {
    // Empty on purpose in the template, and it must STAY empty there: a second bake over an
    // already-filled root would nest one render inside another.
    if (!html.includes(EMPTY_ROOT))
      throw new Error(`prerender: ${EMPTY_ROOT} not found in index.html`);
    html = html.replace(
      EMPTY_ROOT,
      `<div id="root" ${PRERENDERED_ROUTE_ATTR}="${escapeAttr(tags.body.route)}">${tags.body.html}</div>`,
    );
  }

  return html;
}

export interface RenderedChecks {
  /** The BCP-47 tag this file must be marked with — the same `lang` passed to `bakeHead`. */
  lang?: string;
  /** Bytes the page must have gained over the template before it counts as rendered.
   *  500 is the floor both donor builds ran with. */
  minGrowth?: number;
}

/**
 * What every written file must be true of before the build is allowed to pass.
 *
 * The regression this exists for is a root that renders to nothing. A router whose location
 * does not match its routes yields empty markup with no error and no warning — it looks fine
 * in every browser and is invisible to everything that reads a link. Checking the bytes we
 * actually wrote is the only thing that catches it, and it needs no browser, so it gates the
 * BUILD rather than sitting in a test suite.
 *
 * The loading-screen check is the half a size floor misses. With `lazy()` routes behind one
 * `<Suspense fallback={<Spinner />}>`, a render that resolves nothing still produces a
 * plausible body: one donor shipped a 1,174-byte spinner with a perfect title and an element
 * inside the root. A file whose body is a spinner is WORSE than an empty one, because every
 * cheap check passes.
 */
export function assertRendered(
  file: string,
  html: string,
  template: string,
  checks: RenderedChecks = {},
): void {
  function fail(why: string): never {
    throw new Error(`prerender: ${file} ${why}`);
  }

  // Measured against the template rather than by matching the root's closing tag — the body is
  // thousands of nested `</div>`s and no regex should be asked to find the right one.
  // Everything this file has over the shell it was baked from is the page.
  const floor = checks.minGrowth ?? 500;
  const grew = html.length - template.length;
  if (grew < floor) fail(`is only ${String(grew)} bytes bigger than the shell — nothing rendered`);
  if (/<title>\s*<\/title>/.test(html)) fail("has an empty <title>");
  if (checks.lang !== undefined && !html.includes(`<html lang="${checks.lang}"`))
    fail(`is not marked as ${checks.lang}`);

  // A `%NAME%` the HTML transform never filled in. Three inner characters minimum, because two
  // is the shape of percent-encoding: `/caf%C3%A9` contains `%C3%`, and an accented slug is not
  // a broken build.
  const placeholder = /%[A-Z][A-Z0-9_]{2,}%/.exec(html);
  if (placeholder) fail(`still carries an unsubstituted placeholder, ${placeholder[0]}`);

  // What the root ACTUALLY opens with. Sliced rather than matched in one pattern, because a
  // regex that skips React's `<!--$-->` Suspense markers with `(?:<!--.*?-->|\s)*` can backtrack
  // across the whole document — it will happily skip 40 KB of real page to find a
  // `role="status"` further down and report a perfectly good file as a spinner. It did exactly
  // that in the donor before this was rewritten as a slice.
  const opened = /<div id="root"[^>]*>/.exec(html);
  if (!opened) fail("has no root element at all");
  const start = opened.index + opened[0].length;
  const head = html
    .slice(start, start + 600)
    .replace(/<!--.*?-->/g, "")
    .trimStart();

  if (!/^<[a-z]/.test(head)) fail("has no element inside its root");
  if (/^<[^>]*role="status"/.test(head))
    fail("rendered the loading screen, not the page — something suspended and never resolved");
}
