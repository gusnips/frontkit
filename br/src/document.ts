/**
 * CPF and CNPJ: check digits, display, input masks.
 *
 * Three concerns sit side by side here, and the adopters that merged them kept them apart for a
 * reason: a DISPLAY formatter works on a complete value and zero-pads it, a MASK formats partial
 * input as somebody types and never pads, and a VALIDATOR says whether the check digits hold.
 *
 * The CNPJ is alphanumeric from July 2026 (Receita Federal, IN RFB 2.229/2024): the first twelve
 * characters may be A-Z as well as digits, and the two check digits stay numeric. Every copy this
 * package replaced stripped letters before it checked, so a company registered under the new
 * format was refused everywhere — and one display formatter turned `12.ABC.345/01DE-35` into a
 * different, numeric CNPJ. The check digits are the same mod-11 over the same weights, with each
 * character counting as its ASCII code minus 48, so a digit counts as itself and `A` as 17.
 */

export type DocumentKind = "cpf" | "cnpj";

/** Digits only. A CPF is numeric and stays numeric, so a pasted label or letter is noise. */
function cpfCharacters(value: string): string {
  return value.replace(/\D/g, "");
}

/** Digits and A-Z, uppercased — the characters a CNPJ can hold. */
function cnpjCharacters(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Which document this is, by SHAPE only: 11 digits is a CPF, 14 CNPJ characters is a CNPJ.
 *
 * Deliberately not a validity check. Government datasets carry test CPFs that fail the check digit,
 * and an adopter reading those has to know "this is a person" without calling the record invalid —
 * keep "what is it" and "does it check" as two questions.
 */
export function classifyDocument(value: string): DocumentKind | null {
  if (cpfCharacters(value).length === 11 && !/[A-Za-z]/.test(value)) return "cpf";
  return /^[0-9A-Z]{12}\d{2}$/.test(cnpjCharacters(value)) ? "cnpj" : null;
}

/** The two check digits for the first nine digits of a CPF. */
export function cpfCheckDigits(base9: string): string {
  const digits = cpfCharacters(base9);
  if (digits.length !== 9) throw new RangeError("A CPF base is 9 digits.");
  const next = (source: string): number => {
    let sum = 0;
    for (let i = 0; i < source.length; i++) sum += Number(source[i]) * (source.length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = next(digits);
  return `${first}${next(`${digits}${first}`)}`;
}

/** The two check digits for the first twelve characters of a CNPJ, numeric or alphanumeric. */
export function cnpjCheckDigits(base12: string): string {
  const chars = cnpjCharacters(base12);
  if (!/^[0-9A-Z]{12}$/.test(chars)) throw new RangeError("A CNPJ base is 12 characters.");
  const next = (source: string): number => {
    let sum = 0;
    // The weights run 2, 3 … 9 from the RIGHT and wrap, which is the 5→2, 9→2 walk read backwards.
    for (let i = 0; i < source.length; i++) {
      const weight = ((source.length - 1 - i) % 8) + 2;
      sum += (source.charCodeAt(i) - 48) * weight;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = next(chars);
  return `${first}${next(`${chars}${first}`)}`;
}

/** Whether a CPF's check digits hold. Formatted or bare. Eleven repeated digits never pass. */
export function isValidCpf(value: string): boolean {
  const digits = cpfCharacters(value);
  if (digits.length !== 11 || /[A-Za-z]/.test(value)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return cpfCheckDigits(digits.slice(0, 9)) === digits.slice(9);
}

/** Whether a CNPJ's check digits hold — numeric or alphanumeric, formatted or bare. */
export function isValidCnpj(value: string): boolean {
  const chars = cnpjCharacters(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(chars)) return false;
  if (/^(.)\1{13}$/.test(chars)) return false;
  return cnpjCheckDigits(chars.slice(0, 12)) === chars.slice(12);
}

/**
 * A complete CPF for display: `123.456.789-09`.
 *
 * Zero-pads, because government datasets store it as a number and drop the leading zeros. Anything
 * that is not a CPF comes back as it was, so a bad row shows as itself rather than as "".
 */
export function formatCpf(value: string): string {
  const digits = cpfCharacters(value);
  if (digits.length === 0 || digits.length > 11 || /[A-Za-z]/.test(value)) return value;
  return digits.padStart(11, "0").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/**
 * A complete CNPJ for display: `12.345.678/0001-95` or `12.ABC.345/01DE-35`.
 *
 * Zero-pads a numeric value for the same reason {@link formatCpf} does. An alphanumeric one cannot
 * have lost a zero to a number column, so it is never padded. Anything else comes back as it was.
 */
export function formatCnpj(value: string): string {
  let chars = cnpjCharacters(value);
  if (/^\d{1,13}$/.test(chars)) chars = chars.padStart(14, "0");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(chars)) return value;
  return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5, 8)}/${chars.slice(8, 12)}-${chars.slice(12)}`;
}

/** A CPF for display with its middle hidden: `123.***.***-09`. Anything else comes back as it was. */
export function redactCpf(value: string): string {
  const digits = cpfCharacters(value);
  if (digits.length !== 11 || /[A-Za-z]/.test(value)) return value;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

/** Formats a CPF as it is typed. Never pads; stops at 11 digits. */
export function maskCpf(partial: string): string {
  const d = cpfCharacters(partial).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Formats a CNPJ as it is typed, letters included. Never pads; stops at 14 characters, and the last
 * two only take digits, because the check digits stay numeric.
 */
export function maskCnpj(partial: string): string {
  const all = cnpjCharacters(partial);
  const c = all.slice(0, 12) + all.slice(12).replace(/\D/g, "").slice(0, 2);
  if (c.length <= 2) return c;
  if (c.length <= 5) return `${c.slice(0, 2)}.${c.slice(2)}`;
  if (c.length <= 8) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}`;
  if (c.length <= 12) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8)}`;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/**
 * One field for either document: a CPF mask up to 11 digits, a CNPJ mask past that — or as soon as
 * a letter is typed, since only a CNPJ can carry one.
 */
export function maskDocument(partial: string): string {
  const chars = cnpjCharacters(partial);
  return chars.length <= 11 && /^\d*$/.test(chars) ? maskCpf(chars) : maskCnpj(chars);
}
