/**
 * CEP, the Brazilian postal code: eight digits, shown as `01310-100`.
 *
 * Only the shape lives here. Looking a CEP up is a network call to a provider you choose, and a
 * CEP can be real and still have no street — a whole small town can share one — so "the lookup
 * found no street" is not "this CEP is invalid".
 */

/** The eight digits, or `null` when there are not eight. */
export function normalizeCep(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

/** `01310-100`. Anything that is not eight digits comes back as it was. */
export function formatCep(value: string): string {
  const digits = normalizeCep(value);
  return digits === null ? value : `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Formats a CEP as it is typed. Stops at eight digits. */
export function maskCep(partial: string): string {
  const d = partial.replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}
