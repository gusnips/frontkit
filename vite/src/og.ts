/**
 * Fitting copy into a share card.
 *
 * The card's ART — the palette, the lockup, the size ladder — is the product, and it stays in
 * the product. What ships here is the part two independent generators got wrong the same way:
 * deciding what happens when a headline does not fit.
 *
 * Pure math, no `node:` import. The renderer that turns lines into SVG and SVG into a PNG is
 * the caller's; `writeOgCards` in `node.ts` is the loop around it.
 */

/** The canvas every platform crops from. 1200×630 is the Open Graph size, not a brand choice. */
export const OG_CANVAS = { width: 1200, height: 630 } as const;

/** Copy that did not fit its column. */
export interface OgOverflow {
  /** Which line of which card, so an operator can act on the report without grepping. */
  label: string;
  /** The string as given. */
  text: string;
  maxLines: number;
  /** Characters per line at this size — the budget the text blew. */
  maxChars: number;
  size: number;
}

export interface FitOptions {
  /** Pixel width of the column the text has to live in. */
  width: number;
  /** Font size, in pixels. */
  size: number;
  /** Hard cap on lines. */
  maxLines: number;
  /**
   * Average glyph advance as a fraction of the font size.
   *
   * Character-budget estimation rather than real metrics: an SVG rasterizer gives no measuring
   * API, and card copy is short enough that the estimate never drifts more than a word. Measure
   * it off a rendered card and round UP — a budget that is too generous overflows the column,
   * while one that is too mean only breaks a line early. Donor values: ~0.5 for a display face
   * at headline sizes, ~0.46 for body copy.
   */
  advance: number;
  /** Names this line in an overflow report. `"pricing headline"`, not `"line 1"`. */
  label: string;
}

export interface FitResult {
  lines: readonly string[];
  /** Set when the copy did not fit. See {@link fitText} for why this is reported rather than
   *  quietly truncated. */
  overflow?: OgOverflow;
}

/**
 * Greedy word wrap into a column, hard-capped at `maxLines`.
 *
 * Overflow is REPORTED, not truncated. The donor used to append `…`, which made wrapping a
 * total function: every string "fitted", so copy that outgrew the column had no failing case to
 * observe and shipped a card missing the end of the one line the card exists to carry. The
 * reader who finds out is someone else's link unfurl. Cutting a headline to win an argument
 * with a long sentence is a decision nobody reviewed; the size ladder is one somebody did.
 *
 * The truncated lines still come back, so a report can show what the card would have said, and
 * so a `--check` run can lay every card out before refusing. One run names every bad card: copy
 * lands per locale in batches, and a build that dies on the first of six sends its operator
 * round the loop six times.
 */
export function fitText(text: string, options: FitOptions): FitResult {
  const { width, size, maxLines, advance, label } = options;
  const maxChars = Math.max(8, Math.floor(width / (size * advance)));
  const flat = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let line = "";
  let overflowed = false;

  for (const word of flat.split(" ").filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) line = candidate;
    else if (lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      overflowed = true;
      line = `${candidate.slice(0, maxChars - 1).trimEnd()}…`;
      break;
    }
  }
  if (line) lines.push(line);

  return overflowed
    ? { lines, overflow: { label, text: flat, maxLines, maxChars, size } }
    : { lines };
}

/** One overflow, as the line an operator reads in a failed build. */
export function describeOverflow(overflow: OgOverflow): string {
  return (
    `${overflow.label} — ${String(overflow.maxLines)} lines of ~${String(overflow.maxChars)} ` +
    `chars at ${String(overflow.size)}px, ${String(overflow.text.length)} chars given\n` +
    `    ${JSON.stringify(overflow.text)}`
  );
}
