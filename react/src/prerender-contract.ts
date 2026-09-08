/**
 * The two constants the build and the browser both need — and **nothing else in this file**.
 *
 * It is separate from `hydrate.ts` for one reason: that module imports `react-dom/client`, and
 * `@gusnips/vite` needs these constants to WRITE the attribute at build time. If the constants
 * lived beside the hydration helper, a build script asking for a string would pull the browser
 * renderer into a Node process, and every `entry-server.tsx` that touched this package would do
 * the same. Zero imports here is the whole point; keep it that way.
 *
 * The contract itself was invented three times independently, with the same name and the same
 * string value each time. See `hydrate.ts` for why it exists at all.
 */

/**
 * The attribute a prerendered file names its own route in — written by the build, read by the
 * browser entry.
 *
 * One constant because the writer and the reader are in different builds, and a typo between
 * them would show up only as a silent full re-render: a page that works, and a bug nobody sees.
 */
export const PRERENDERED_ROUTE_ATTR = "data-prerendered-route";

/**
 * What a 404 shell writes instead of a route.
 *
 * It is the pattern that actually matched — the catch-all — and it can never equal an address,
 * which is the property that matters: every route a static host answers from the shell mounts
 * fresh rather than hydrating the not-found page over itself. A real 404 pays one redundant
 * client render for that, and keeps the markup a crawler reads.
 */
export const SHELL_ROUTE = "*";
