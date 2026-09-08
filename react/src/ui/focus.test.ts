/**
 * Two structural rules for every wrapper in this folder, checked against the source rather
 * than a render — because both failures look correct in a browser and only show up for the
 * people least able to report them.
 *
 * Neither is a style opinion. Each is a rule from AGENTS.md with a mechanism behind it, and
 * both were live in this folder before this file existed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath`, never `import.meta.dir` — invariant 11: the latter is bun-only, and this
// suite has to run under vitest on plain Node too.
const here = dirname(fileURLToPath(import.meta.url));

const sources = readdirSync(here)
  .filter((name) => name.endsWith(".tsx") || (name.endsWith(".ts") && !name.includes(".test.")))
  .map((name) => ({ name, text: readFileSync(join(here, name), "utf8") }));

/**
 * Every class string is on one line here, so a line is the right unit to quote back.
 *
 * Comment lines are skipped, and that is load-bearing rather than tidy: each of these rules is
 * worth a sentence saying why, and the sentence has to be free to name the thing it forbids. A
 * guard that fails on its own explanation teaches people to delete the explanation.
 */
function linesMatching(text: string, pattern: RegExp): number[] {
  // Block comments are BLANKED, not deleted: removing them would collapse lines and every number
  // reported after one would point at the wrong place. (That is also why this cannot share
  // `menu.test.ts`'s `codeOf`, which strips outright because it only ever counts occurrences.)
  // Blanking also means a wrapped comment line is ignored whether or not it opens with a `*`.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  return code
    .split("\n")
    .map((line, i) => (!line.trim().startsWith("//") && pattern.test(line) ? i + 1 : 0))
    .filter(Boolean);
}

describe("the wrappers do not draw their own focus ring", () => {
  // Invariant 19. A control that writes `outline-none focus-visible:ring-2` looks identical to
  // the base outline in every normal browser and disappears under `forced-colors: active`,
  // where the UA forces `box-shadow` to `none` and leaves `outline` painted in a system colour.
  // So the swap deletes the keyboard focus indicator for Windows High Contrast users only.
  // The app's one ring lives in `@gusnips/tokens`' base layer and needs no help from here.
  it.each(sources)("$name has no focus-visible ring", ({ text }) => {
    expect(linesMatching(text, /focus-visible:ring|focus:ring/)).toEqual([]);
  });

  // The other half: `outline-none` is legitimate on a container that takes focus
  // programmatically (a Popup, its Positioner, a highlighted Item), and nowhere else. It is
  // only a bug when it removes the outline without the primitive putting focus somewhere that
  // still shows one — which is what the rule above now makes impossible, since there is no
  // replacement ring left to write. This asserts the reset stayed inside the popup parts.
  it.each(sources)("$name resets the outline only on popup parts", ({ text }) => {
    const offenders = linesMatching(text, /outline-none/).filter((line) => {
      // ponytail: "the nearest Primitive tag above" approximated as a 12-line lookback, which
      // clears every part in this folder today with room to spare. The ceiling is a part whose
      // props run longer than that, which would read as a violation while being correct. If that
      // happens, parse the enclosing JSX element instead of counting lines — do not just raise 12.
      const context = text
        .split("\n")
        .slice(Math.max(0, line - 12), line)
        .join("\n");
      return !/<Primitive\.(Popup|Positioner|Item|ItemsEmpty|Backdrop|Viewport)\b/.test(context);
    });
    expect(offenders).toEqual([]);
  });
});

describe("the wrappers never hardcode a colour", () => {
  // Invariant 21. `text-white` on a primary fill is correct in one donor's dark theme and
  // unreadable in the other's, because `--color-primary-foreground` is `#ffffff` in one and a
  // near-black in the other. A shared control cannot know which it is running in, so it always
  // reads the token.
  it.each(sources)("$name uses tokens, not literal colours", ({ text }) => {
    const literal =
      /\b(?:text|bg|border|fill|stroke|ring|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|red|blue|green|amber|yellow)\b|#[0-9a-fA-F]{3,8}\b/;
    expect(linesMatching(text, literal)).toEqual([]);
  });
});
