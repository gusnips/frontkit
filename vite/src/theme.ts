/**
 * The pre-paint half of `@gusnips/react/theme`: a Vite plugin that runs the theme controller
 * before the first frame.
 *
 * It lives behind its own subpath because it imports the controller, and that module imports
 * React. The barrel stays free of React so a script that only wants a sitemap does not load it.
 *
 * What it writes is a FILE, `<assetsDir>/theme-<hash>.js`, plus one `<script src>` tag at the end
 * of `<head>`. Two things decided that shape:
 *
 * - **Not inline.** A `script-src 'self'` policy blocks inline scripts, and one adopter's inline
 *   pre-paint never ran in production because of it: the app booted light and turned dark a frame
 *   later. A hash in the policy works until the first whitespace change breaks it again. A
 *   same-origin file passes every policy that lets the app's own bundle run.
 * - **Not hand-written.** The file is `startTheme`'s own source, called with your options. The
 *   script that paints first and the controller the app talks to cannot disagree, because they
 *   are the same function.
 *
 * The name carries a hash of the contents, so it sits beside the bundle under a long-cache
 * `/assets/*` rule and changes whenever the controller or your options do. The tag goes at the
 * END of `<head>` so any `<meta name="theme-color">` above it already exists when the script
 * runs. It still runs before first paint: a classic script in `<head>` blocks the body, and the
 * body is what gets painted.
 */
import { createHash } from "node:crypto";
import { startTheme, type ThemeOptions } from "@gusnips/react/theme";
import type { Plugin } from "vite";

/** The exact script the plugin serves. Exported so a test can run it in a bare context. */
export function themeScriptSource(options: ThemeOptions): string {
  return `(${startTheme.toString()})(${JSON.stringify(options)});\n`;
}

/**
 * Pass the same options `createTheme` gets. Keep them in one module that both
 * `vite.config.ts` and the app import:
 *
 * ```ts
 * // src/theme.ts
 * export const THEME = { key: "app.theme" } satisfies ThemeOptions;
 * export const { useTheme } = createTheme(THEME);
 *
 * // vite.config.ts
 * plugins: [themeScript(THEME)]
 * ```
 */
export function themeScript(options: ThemeOptions): Plugin {
  const source = themeScriptSource(options);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
  let fileName = "";
  let src = "";
  let ssr = false;

  return {
    name: "frontkit:theme-script",
    configResolved(config) {
      fileName = `${config.build.assetsDir}/theme-${hash}.js`;
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
    transformIndexHtml: () => [{ tag: "script", attrs: { src }, injectTo: "head" }],
  };
}
