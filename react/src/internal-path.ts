const INTERNAL_ORIGIN = "https://frontkit.invalid";

function containsControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * A route the browser can follow without leaving the current origin.
 *
 * Return targets cross a trust boundary: query strings, history state and storage are all writable
 * by somebody outside the app. `startsWith("/")` is not enough — URL parsers read both `//host`
 * and `/\\host` as another origin, and strip tabs or newlines before making the same decision.
 * Parsing against a fixed origin applies the browser's own rules rather than trying to copy them.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || containsControl(value)) return null;

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
