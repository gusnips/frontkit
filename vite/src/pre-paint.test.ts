import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { prePaintScript, type PrePaintScriptOptions } from "./pre-paint.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

/** A real `vite build` of a page with a stylesheet, because the order in the output is the point. */
async function built(options: PrePaintScriptOptions) {
  const root = await mkdtemp(join(tmpdir(), "frontkit-prepaint-"));
  dirs.push(root);
  await writeFile(join(root, "style.css"), "body { color: red }");
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./style.css"></head><body></body></html>',
  );
  await build({ root, logLevel: "silent", plugins: [prePaintScript(options)] });
  const html = await readFile(join(root, "dist/index.html"), "utf8");
  const assets = await readdir(join(root, "dist/assets"));
  return { root, html, assets };
}

describe("prePaintScript", () => {
  const source = "globalThis.ran = true;\n";

  // A classic script after a stylesheet waits for it, so a redirect decided there first downloads
  // CSS for a page it is about to leave.
  it("puts a head-prepend script ahead of every stylesheet, as a file", async () => {
    const { root, html, assets } = await built({
      name: "locale",
      source,
      position: "head-prepend",
    });
    const file = assets.find((name) => /^locale-[0-9a-f]{8}\.js$/.test(name));
    expect(file).toBeDefined();
    const tag = html.indexOf(`<script src="/assets/${file}"></script>`);
    expect(tag).toBeGreaterThan(-1);
    expect(tag).toBeLessThan(html.indexOf('rel="stylesheet"'));
    expect(html).not.toMatch(/<script>/);
    expect(await readFile(join(root, "dist/assets", file!), "utf8")).toBe(source);
  });

  it("defaults to the end of <head>", async () => {
    const { html, assets } = await built({ name: "theme", source });
    const file = assets.find((name) => name.startsWith("theme-"));
    expect(html.indexOf(`<script src="/assets/${file}"></script>`)).toBeGreaterThan(
      html.indexOf('rel="stylesheet"'),
    );
  });

  it("names the file after its contents", async () => {
    const first = (await built({ name: "locale", source })).assets.find((n) =>
      n.startsWith("locale-"),
    );
    const second = (await built({ name: "locale", source: `${source};` })).assets.find((n) =>
      n.startsWith("locale-"),
    );
    expect(first).not.toBe(second);
  });
});
