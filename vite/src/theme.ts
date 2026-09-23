/**
 * The pre-paint half of `@gusnips/react/theme`: a Vite plugin that runs the theme controller
 * before the first frame.
 *
 * It lives behind its own subpath because it imports the controller, and that module imports
 * React. The barrel stays free of React so a script that only wants a sitemap does not load it.
 *
 * The delivery — a hashed same-origin file and one classic `<script src>`, never inline — is
 * `prePaintScript`'s, and that module says why. What is particular to the theme:
 *
 * - **Not hand-written.** The file is `startTheme`'s own source, called with your options. The
 *   script that paints first and the controller the app talks to cannot disagree, because they
 *   are the same function.
 * - **At the END of `<head>`,** so any `<meta name="theme-color">` above it already exists when
 *   the script runs. It still runs before first paint: the body is what gets painted.
 */
import { startTheme, type ThemeOptions } from "@gusnips/react/theme";
import type { Plugin } from "vite";
import { prePaintScript } from "./pre-paint.ts";

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
  return prePaintScript({ name: "theme", source: themeScriptSource(options), position: "head" });
}
