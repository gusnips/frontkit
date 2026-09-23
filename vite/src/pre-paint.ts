/**
 * A classic script that runs before first paint, served as a file of its own.
 *
 * Two pre-paint jobs share this shape: the theme (`@gusnips/vite/theme`) and the locale gate
 * (`localeGateScript` from `@gusnips/locale`). Both have to act before the body shows, and both
 * lose silently when they cannot — the page paints light then turns dark, or paints English then
 * turns Portuguese. So both get the same delivery:
 *
 * - **A file, never inline.** A `script-src 'self'` policy blocks an inline script, and one
 *   adopter's inline pre-paint never ran in production because of it. A hash in the policy works
 *   until the first whitespace change breaks it again. A same-origin file passes every policy that
 *   lets the app's own bundle run.
 * - **A name that carries a hash of the contents,** `<assetsDir>/<name>-<hash>.js`, so it sits
 *   beside the bundle under a long-cache `/assets/*` rule and changes whenever the source does.
 * - **A classic `<script src>`,** no `defer`, no `type="module"`: it blocks the parser, which is
 *   the point. The body is what gets painted, and nothing below the tag is parsed until it ran.
 *
 * This file imports nothing at runtime but `node:crypto`, so it lives in the barrel.
 */
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export interface PrePaintScriptOptions {
  /** Names the file (`theme`, `locale`) and the plugin. */
  name: string;
  /** The script's full text. It runs alone, so it must not reference anything outside itself. */
  source: string;
  /**
   * Where the tag goes. `"head"` (the end of `<head>`) when the script reads elements above it —
   * the theme reads `<meta name="theme-color">`. `"head-prepend"` when it only needs to run as
   * early as possible: a classic script after a stylesheet waits for that stylesheet, so the
   * locale gate goes first and redirects without downloading the page's CSS.
   */
  position?: "head" | "head-prepend";
}

export function prePaintScript({ name, source, position = "head" }: PrePaintScriptOptions): Plugin {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
  let fileName = "";
  let src = "";
  let ssr = false;

  return {
    name: `frontkit:${name}-script`,
    configResolved(config) {
      fileName = `${config.build.assetsDir}/${name}-${hash}.js`;
      src = `${config.base}${fileName}`;
      ssr = Boolean(config.build.ssr);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== src) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(source);
      });
    },
    generateBundle() {
      // The server build renders pages into files; it never serves this script.
      if (!ssr) this.emitFile({ type: "asset", fileName, source });
    },
    transformIndexHtml: () => [{ tag: "script", attrs: { src }, injectTo: position }],
  };
}
