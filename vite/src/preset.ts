/**
 * The `vite.config.ts` every app in this stack was writing by hand.
 *
 * Its own entry point (`@gusnips/vite/preset`) rather than the barrel, because it imports the
 * React and Tailwind plugins: a prerender script that only wants `bakeHead` would otherwise
 * load a build toolchain it never uses. Same reason the four packages are split at all.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { Plugin, UserConfig } from "vite";

/**
 * Substitute `%NAME%` placeholders in `index.html`.
 *
 * `index.html` cannot import TypeScript, so a brand name or tagline written there is a literal
 * that drifts from the one the app renders. This injects them from the module that owns them.
 *
 * Vite already replaces `%VITE_FOO%` from the environment, and that is the right tool when the
 * value IS environment — an API URL, a build id. It is the wrong one for brand identity, which
 * belongs in a typed module the app imports, not in a `.env` nobody reviews.
 */
export function htmlPlaceholders(values: Readonly<Record<string, string>>): Plugin {
  return {
    name: "frontkit:html-placeholders",
    transformIndexHtml(html: string) {
      return Object.entries(values).reduce(
        // A function, because a replacement string reads `$$` as `$` (see `rewriteAttr`).
        (out, [name, value]) => out.replaceAll(`%${name}%`, () => value),
        html,
      );
    },
  };
}

export interface WebPresetOptions {
  /** The app folder — the one holding `index.html`. In a `vite.config.ts` that is
   *  `import.meta.dirname`. `@` resolves to `<root>/src`. */
  root: string;
  /** Dev server port. Two apps in one repo must not share one, which is why it has no clever
   *  default beyond Vite's own. */
  port?: number;
  /** Preview server port. Defaults to `port - 1000`, the pairing both donors landed on
   *  (5173/4173, 5174/4174). */
  previewPort?: number;
  /** `{ BRAND_NAME: "Acme" }` replaces `%BRAND_NAME%` in `index.html`. */
  placeholders?: Readonly<Record<string, string>>;
  /**
   * The workspace scope to bundle into the SSR build, as in `"@acme"`.
   *
   * INSURANCE, not a fix. Measured: Vite already bundles linked workspace dependencies in an
   * SSR build — one donor runs without this declaration and its SSR output has zero bare
   * imports. It is here because workspace packages are consumed as TypeScript SOURCE through
   * subpath exports, and leaving them external would hand the runtime `.ts` files with
   * Vite-only semantics in them (aliases, `?raw`, `define`) if that behaviour ever changed.
   */
  ssrScope?: string;
}

export function webPreset({
  root,
  port,
  previewPort,
  placeholders,
  ssrScope,
}: WebPresetOptions): UserConfig {
  const preview = previewPort ?? (port === undefined ? undefined : port - 1000);
  return {
    plugins: [react(), tailwindcss(), ...(placeholders ? [htmlPlaceholders(placeholders)] : [])],
    resolve: {
      alias: { "@": path.resolve(root, "src") },
    },
    ...(ssrScope && {
      ssr: { noExternal: [new RegExp(`^${ssrScope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`)] },
    }),
    ...(port !== undefined && { server: { port } }),
    ...(preview !== undefined && { preview: { port: preview } }),
  };
}
