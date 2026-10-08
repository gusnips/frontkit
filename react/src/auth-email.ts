/**
 * The email a person has typed during sign-in, kept so the next auth screen opens with it filled.
 *
 * Sign-in, "use a code instead", "forgot password" and "create account" are separate screens, and
 * each one used to start with an empty email field. Someone who typed their address, then chose
 * another way in, typed it again. The fix is the same everywhere, so it lives here once.
 *
 * ```tsx
 * <input name="email" type="email" defaultValue={recallAuthEmail()}
 *   onChange={(event) => rememberAuthEmail(event.currentTarget.value)} />
 * ```
 *
 * - **Not in the URL.** A query string rides in `Referer`, in access logs, in history and in every
 *   analytics tool that records page addresses. An email is personal data and has no business there.
 * - **`localStorage`, not `sessionStorage`.** An emailed link opens in a new tab, and a new tab
 *   does not inherit `sessionStorage`. The person who confirms their account from the mail lands
 *   on sign-in in that new tab, which is the screen that most needs the address.
 * - **Thirty minutes, sliding.** Long enough to read a code in a mail client and come back; short
 *   enough that a shared computer forgets. Every keystroke renews it, and a value found expired is
 *   deleted when it is read, so it does not sit on disk afterwards.
 * - **Memory behind it.** A browser that blocks site data throws on `localStorage` itself, and
 *   React Native has none. The value then lasts until the page (or the app) is left, which still
 *   covers moving between screens.
 *
 * Read it once when a screen opens, as a default value. It is not a live store: nothing re-renders
 * when it changes, and a prerendered page must read it after hydration, never while rendering.
 * Never put a password, a code or a token here. Call `forgetAuthEmail()` once a session exists, so
 * the next person at this browser starts empty.
 */

const KEY = "frontkit.auth-email";
const TTL_MS = 30 * 60 * 1000;
/** The longest an address can be (RFC 5321). A longer value is not one, and is not kept. */
const MAX_LENGTH = 254;

interface Saved {
  email: string;
  at: number;
}

let memory: Saved | null = null;

function isSaved(value: unknown): value is Saved {
  return (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof value.email === "string" &&
    "at" in value &&
    typeof value.at === "number"
  );
}

function readStored(): Saved | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSaved(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Storage and memory are written together, so they only differ when one of them missed a write:
 * storage that is full keeps an older address while memory holds the new one, and a second tab
 * writes storage while this tab's memory goes stale. The newer of the two is the one the person
 * typed last.
 */
function newest(): Saved | null {
  const stored = readStored();
  if (!stored || !memory) return stored ?? memory;
  return stored.at >= memory.at ? stored : memory;
}

/** The address typed earlier in this sign-in, or an empty string when there is none. */
export function recallAuthEmail(): string {
  const saved = newest();
  if (!saved) return "";
  if (Date.now() - saved.at > TTL_MS) {
    forgetAuthEmail();
    return "";
  }
  return saved.email;
}

/**
 * Keep what the person has typed. Call it from the email field's change handler, so every screen
 * they reach next can open with it. The value is stored as typed: trim it where you submit it.
 * An empty value forgets.
 */
export function rememberAuthEmail(value: string): void {
  if (value === "") return forgetAuthEmail();
  if (value.length > MAX_LENGTH) return;
  memory = { email: value, at: Date.now() };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Blocked or full: the memory copy above carries it until the page is left.
  }
}

/** Drop it. Call this once a session exists, so the next person at this browser starts empty. */
export function forgetAuthEmail(): void {
  memory = null;
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Blocked: nothing was stored, so there is nothing to drop.
  }
}
