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

/**
 * The keys an OAuth or OIDC implicit response puts in the fragment that are themselves credentials
 * (RFC 6749 §4.2.2, plus the two a provider token is passed through under). The rest of that
 * response — `expires_in`, `token_type`, `state`, `type` — is metadata, worthless on its own.
 */
const CREDENTIAL_FRAGMENT_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "provider_token",
  "provider_refresh_token",
];

/** Anything shaped like the current page: `window.location` and react-router's `useLocation()`. */
export interface PathParts {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Where someone is right now, written down so signing in can bring them back.
 *
 * The fragment is the half that is easy to get wrong, and getting it wrong leaks a credential. A
 * Supabase client with no `flowType` uses the IMPLICIT flow, which returns the session in the
 * fragment — `#access_token=…&refresh_token=…`. A return target is recorded in a query string, and
 * a query string is not a fragment: it rides in `Referer`, it is written to every access log on the
 * way, and it stays in history. So a fragment carrying a credential is dropped and the page is
 * kept, because the page is the part worth returning to and the anchor is the part that is
 * dangerous.
 *
 * Total on purpose — the caller is handing over its OWN address, which is on this origin by
 * construction. Use `safeInternalPath` for the other direction, where someone else wrote the value.
 */
export function returnPathFromLocation({ pathname, search, hash }: PathParts): string {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  const carriesCredential = CREDENTIAL_FRAGMENT_KEYS.some((key) => params.has(key));
  return `${pathname}${search}${carriesCredential ? "" : hash}`;
}
