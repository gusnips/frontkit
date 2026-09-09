/**
 * Build-time i18n: one string out of a raw locale catalog, by dotted key.
 *
 * The prerender reads the SAME JSON the app initializes i18next from, without initializing
 * i18next — a localized build renders every language in one process, and a singleton would race
 * on `lng`. So this is deliberately not a translator: no plurals, no interpolation, no fallback
 * chain. A `<title>` is one string, and every donor that needed one wrote exactly this function.
 *
 * A miss returns the KEY. That is what makes a stale key visible — `seo.old.title` sitting in a
 * tab and in a search result — instead of an empty tag nobody notices.
 *
 * `hasOwnProperty` and not `in`: `in` walks the prototype, so `faq.constructor.name` resolves to
 * `"Object"` and ships as a page title. Both donor copies used `in` and neither had noticed.
 */
export function resolveKey(catalog: unknown, key: string): string {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return key;
    if (!Object.prototype.hasOwnProperty.call(node, part)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}
