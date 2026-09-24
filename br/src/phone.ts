/**
 * Brazilian phone numbers: read, check, format, and the two forms of an older mobile.
 *
 * Brazilian only, on purpose. A number that is not Brazilian comes back as `null`, never as a
 * guess: a general parser reading bare digits guesses a country from the first ones, and for a
 * Brazilian mobile typed without `+55` that guess is wrong often — area code 31 reads as the
 * Netherlands and 81 as Japan. If you take international numbers too, send the ones that start
 * with `+` and are not `+55` to a real international library, and keep this for the rest.
 */

/**
 * The 67 area codes (DDD) in use. Anything else — 00, 20, 23, 30, 90 — is a typo or a placeholder,
 * never a number somebody can answer.
 */
const AREA_CODES = new Set(
  "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(
    " ",
  ),
);

export interface BrPhone {
  /** The two-digit area code. */
  ddd: string;
  /** Everything after it: nine digits for a mobile, eight for a landline. */
  subscriber: string;
  kind: "mobile" | "landline";
}

/**
 * Reads a Brazilian number in whatever shape a person or a system wrote it — `(11) 98765-4321`,
 * `+55 11 98765-4321`, `5511987654321`, `011 3456-7890` — or returns `null`.
 *
 * **Length decides before the prefix does**, because `55` is ambiguous: it is the country code and
 * also a DDD (Rio Grande do Sul). Eleven digits starting with 55 are a gaúcho mobile, not a country
 * code in front of nine digits; only 12 or 13 digits carry the country. The copy that tested the
 * prefix first also left every São Paulo-state mobile (DDDs 11-19) without its `55`, because it
 * read an 11-digit number starting with 1 as North American.
 *
 * Strict about what it accepts: a real DDD; a mobile is nine digits starting with 9 (every mobile
 * has had the ninth digit since 2016); a landline is eight starting with 2-5; and a subscriber of
 * one repeated digit is a placeholder somebody typed to get past a form.
 */
export function parseBrPhone(input: string): BrPhone | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // A number written with + says its country, and only +55 is ours.
    if (!digits.startsWith("55")) return null;
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    // The trunk 0 people dial between cities. No DDD starts with 0, so this cannot be anything else.
    // ponytail: the carrier code form (0 + 2-digit carrier + DDD) is not read; it comes back null.
    digits = digits.slice(1);
  } else if (digits.length === 12 || digits.length === 13) {
    if (!digits.startsWith("55")) return null;
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return null;

  const ddd = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  if (!AREA_CODES.has(ddd) || /^(\d)\1+$/.test(subscriber)) return null;
  if (subscriber.length === 9)
    return subscriber.startsWith("9") ? { ddd, subscriber, kind: "mobile" } : null;
  return /^[2-5]/.test(subscriber) ? { ddd, subscriber, kind: "landline" } : null;
}

/** Whether {@link parseBrPhone} reads it. */
export function isValidBrPhone(input: string): boolean {
  return parseBrPhone(input) !== null;
}

/** `+5511987654321`, or `null` when it is not a Brazilian number. Drop the `+` for WhatsApp. */
export function toE164Br(input: string): string | null {
  const phone = parseBrPhone(input);
  return phone === null ? null : `+55${phone.ddd}${phone.subscriber}`;
}

/** `(11) 98765-4321` or `(11) 3456-7890`. Anything it cannot read comes back as it was. */
export function formatBrPhone(input: string): string {
  const phone = parseBrPhone(input);
  if (phone === null) return input;
  const { ddd, subscriber } = phone;
  return `(${ddd}) ${subscriber.slice(0, -4)}-${subscriber.slice(-4)}`;
}

/**
 * Formats a number as it is typed: `(41) 98822-9199`. Stops at 11 digits, the longest DDD plus
 * mobile, because a longer string would render as a broken Brazilian number rather than a
 * readable foreign one.
 */
export function maskBrPhone(partial: string): string {
  const d = partial.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Both forms a Brazilian mobile may be registered under, the given one first: with the ninth
 * digit and without it. Anything else comes back alone.
 *
 * An account created before the ninth digit can still be registered without it, and WhatsApp no
 * longer reliably bridges the two, so a lookup that tries one form misses the person — or opens a
 * second conversation with somebody already in one. Which form an account uses cannot be known
 * from the number, so this gives candidates to look up, never a rewrite.
 *
 * Takes an INTERNATIONAL number (`5511987654321`, `+55 11 98765-4321`), not a bare national one:
 * guessing that ten or eleven bare digits are Brazilian is exactly how a foreign number gets a
 * "twin" that belongs to somebody else. Use {@link toE164Br} first for user input.
 */
export function brMobileVariants(international: string): string[] {
  const digits = international.replace(/\D/g, "");
  const match = /^55(\d{2})(\d{8,9})$/.exec(digits);
  if (match === null) return [digits];
  const [, ddd = "", subscriber = ""] = match;
  if (!AREA_CODES.has(ddd)) return [digits];
  if (subscriber.length === 9 && subscriber.startsWith("9")) {
    return [digits, `55${ddd}${subscriber.slice(1)}`];
  }
  // Eight digits starting 6-9 is a mobile from before the ninth digit; 2-5 is a landline, which
  // never had one.
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber))
    return [digits, `55${ddd}9${subscriber}`];
  return [digits];
}
