import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { themeScript, themeScriptSource } from "./theme.ts";

const KEY = "app.theme";

/**
 * A page with nothing in it but what a browser gives a classic script in `<head>`. Handing the
 * script only `window` and `document` is the point: a reference to anything else in
 * `startTheme`'s module — a helper, a constant, an import — is a `ReferenceError` here, which is
 * what it would be before first paint in a real page.
 */
function prePaint(source: string, stored: string | null, { osDark = false, blocked = false } = {}) {
  const classes = new Set<string>();
  const window = {
    matchMedia: () => ({ matches: osDark, addEventListener: () => {} }),
    localStorage: {
      getItem: () => {
        if (blocked) throw new Error("site data blocked");
        return stored;
      },
    },
    addEventListener: () => {},
  };
  const document = {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
    },
  };
  runInNewContext(source, { window, document });
  return classes.has("dark");
}

describe("themeScriptSource", () => {
  const source = themeScriptSource({ key: KEY });

  it.each([
    ["dark stored", "dark", {}, true],
    ["light stored, OS dark", "light", { osDark: true }, false],
    ["system, OS dark", "system", { osDark: true }, true],
    ["nothing stored, OS dark", null, { osDark: true }, true],
    ["a stale value, OS dark", "blue", { osDark: true }, true],
    ["storage blocked, OS dark", null, { osDark: true, blocked: true }, true],
  ])("runs on its own before first paint: %s", (_case, stored, env, dark) => {
    expect(prePaint(source, stored, env)).toBe(dark);
  });

  it("carries the options into the page", () => {
    const darkDefault = themeScriptSource({ key: KEY, defaultMode: "dark" });
    expect(prePaint(darkDefault, null)).toBe(true);
  });
});

describe("themeScript", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  /** A real `vite build`, because what matters is the page and the file it produces. */
  async function built(options = { key: KEY }) {
    const root = await mkdtemp(join(tmpdir(), "frontkit-theme-"));
    dirs.push(root);
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><head><meta name="theme-color" content="#fff"></head><body></body></html>',
    );
    await build({ root, logLevel: "silent", plugins: [themeScript(options)] });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const assets = await readdir(join(root, "dist/assets"));
    return { root, html, assets };
  }

  // A `script-src 'self'` policy blocks an inline script, and nothing reports it: the page just
  // paints the wrong theme first. So the page must name a file, and the file must exist.
  it("writes a same-origin file and names it at the end of <head>, never inline", async () => {
    const { root, html, assets } = await built();
    const file = assets.find((name) => /^theme-[0-9a-f]{8}\.js$/.test(name));
    expect(file).toBeDefined();
    expect(html).toMatch(
      new RegExp(`<meta name="theme-color"[^>]*>\\s*<script src="/assets/${file}"></script>`),
    );
    expect(html).not.toMatch(/<script>/);
    expect(await readFile(join(root, "dist/assets", file!), "utf8")).toBe(
      themeScriptSource({ key: KEY }),
    );
  });

  // The file sits under a long-cache rule, so new contents need a new name.
  it("names the file after its contents", async () => {
    const first = (await built()).assets.find((name) => name.startsWith("theme-"));
    const second = (await built({ key: "other.key" })).assets.find((name) =>
      name.startsWith("theme-"),
    );
    expect(first).not.toBe(second);
  });
});
