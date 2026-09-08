/** Escaping shared by the head baker and the sitemap writer. Its own file so neither has to
 *  import the other, and so both stay free of every dependency this package has. */

/** `&` first, or the ampersands introduced by the later rules get escaped twice. */
export const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
