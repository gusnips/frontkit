import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertOgImages, loadTemplate, writeOgCards } from "./node.ts";

const dirs: string[] = [];

async function tempDist(indexHtml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "frontkit-vite-"));
  dirs.push(dir);
  await writeFile(join(dir, "index.html"), indexHtml, "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("loadTemplate", () => {
  it("reads the built shell", async () => {
    const dist = await tempDist('<html><body><div id="root"></div></body></html>');
    await expect(loadTemplate(dist)).resolves.toContain('<div id="root"></div>');
  });

  /**
   * `dist/index.html` is both the template and the front page's destination, so a second run
   * over a `dist/` the prerender already touched would read a finished page as its blank shell
   * and nest one render inside another. `vite build` empties `dist/` and normally makes this
   * impossible; a restored build cache does not.
   */
  it("refuses a dist that is already a rendered page", async () => {
    const dist = await tempDist(
      '<html><body><div id="root" data-prerendered-route="/"><main>hi</main></div></body></html>',
    );
    await expect(loadTemplate(dist)).rejects.toThrow(/already a rendered page/);
  });
});

describe("writeOgCards", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it("writes one card per page", async () => {
    const out = join(await tempDist("<html></html>"), "og");
    await writeOgCards({
      pages: ["/", "/pricing"],
      outDir: out,
      file: (path) => `${path === "/" ? "home" : path.slice(1)}.png`,
      card: () => ({ png }),
    });
    expect((await readdir(out)).sort()).toEqual(["home.png", "pricing.png"]);
  });

  /**
   * A card that cannot hold its copy is a product decision, not something to resolve with an
   * ellipsis — and nothing is written, so a half-updated `public/og` never gets committed.
   */
  it("refuses the whole run when one card cannot hold its copy, and writes nothing", async () => {
    const out = join(await tempDist("<html></html>"), "og");
    const run = writeOgCards({
      pages: ["/", "/pricing"],
      outDir: out,
      file: (path) => `${path === "/" ? "home" : path.slice(1)}.png`,
      card: (path) => ({
        png,
        overflow:
          path === "/pricing"
            ? [
                {
                  label: "pricing headline",
                  text: "far too long",
                  maxLines: 2,
                  maxChars: 20,
                  size: 60,
                },
              ]
            : undefined,
      }),
    });
    await expect(run).rejects.toThrow(/pricing headline/);
    await expect(readdir(out)).rejects.toThrow();
  });

  // Copy lands per locale in batches; a build that dies on the first of six sends its operator
  // round the loop six times.
  it("names every bad card in one run", async () => {
    const out = join(await tempDist("<html></html>"), "og");
    const run = writeOgCards({
      pages: ["/a", "/b"],
      outDir: out,
      file: (path) => `${path.slice(1)}.png`,
      card: (path) => ({
        png,
        overflow: [
          { label: `${path} headline`, text: "far too long", maxLines: 2, maxChars: 20, size: 60 },
        ],
      }),
    });
    await expect(run).rejects.toThrow(/2 card\(s\)/);
  });
});

describe("assertOgImages", () => {
  const page = (image: string) =>
    `<html><head><meta property="og:image" content="${image}" />` +
    `<meta property="twitter:image" content="${image}" /></head></html>`;

  async function distWith(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "frontkit-og-"));
    dirs.push(dir);
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(join(dir, dirname(file)), { recursive: true });
      await writeFile(join(dir, file), contents, "utf8");
    }
    return dir;
  }

  it("passes when every advertised card is on disk", async () => {
    const dist = await distWith({
      "index.html": page("https://example.com/og/home.png"),
      "og/home.png": "png",
    });
    await expect(assertOgImages(dist, "https://example.com")).resolves.toBe(1);
  });

  /**
   * The bug itself, three repos over: the card generator walks the page registry, the 404 shell
   * is not in the registry, and the head it inherits advertises a card that has never been
   * rendered. Nothing in a browser shows it — only the person the link was sent to.
   */
  it("names the page whose card was never rendered", async () => {
    const dist = await distWith({
      "index.html": page("https://example.com/og/home.png"),
      "404.html": page("https://example.com/og/__not-found__.png"),
      "og/home.png": "png",
    });

    await expect(assertOgImages(dist, "https://example.com")).rejects.toThrow(
      /404\.html → https:\/\/example\.com\/og\/__not-found__\.png/,
    );
  });

  it("finds a page nested under a directory, and reads a root-relative card", async () => {
    const dist = await distWith({
      "precos/index.html": page("/og/precos.png"),
    });
    await expect(assertOgImages(dist, "https://example.com")).rejects.toThrow(/og\/precos\.png/);
  });

  it("skips a card served by somebody else", async () => {
    const dist = await distWith({
      "index.html": page("https://cdn.example.net/card.png"),
      "about.html": page("https://example.com/og/about.png"),
      "og/about.png": "png",
    });
    await expect(assertOgImages(dist, "https://example.com")).resolves.toBe(1);
  });

  // A check that silently passes is worse than no check: with the origin wrong, every card on
  // the page looks like somebody else's and nothing gets looked at.
  it("refuses an origin that matches none of the cards it found", async () => {
    const dist = await distWith({ "index.html": page("https://example.com/og/home.png") });
    await expect(assertOgImages(dist, "https://wrong.example")).rejects.toThrow(
      /none is under https:\/\/wrong\.example/,
    );
  });

  it("ignores a cache-busting query when looking for the file", async () => {
    const dist = await distWith({
      "index.html": page("https://example.com/og/home.png?v=2"),
      "og/home.png": "png",
    });
    await expect(assertOgImages(dist, "https://example.com")).resolves.toBe(1);
  });
});
