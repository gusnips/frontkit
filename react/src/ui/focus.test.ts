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
  return codeLines(text)
    .map((line, i) => (pattern.test(line) ? i + 1 : 0))
    .filter(Boolean);
}

function codeLines(text: string): string[] {
  // Block comments are BLANKED, not deleted: removing them would collapse lines and every number
  // reported after one would point at the wrong place. (That is also why this cannot share
  // `menu.test.ts`'s `codeOf`, which strips outright because it only ever counts occurrences.)
  // Blanking also means a wrapped comment line is ignored whether or not it opens with a `*`.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  return code.split("\n").map((line) => (line.trim().startsWith("//") ? "" : line));
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
  // programmatically (a Popup, its Positioner, a Backdrop), and nowhere else. An ITEM is not one
  // of those, even though its highlight shows focus: forced colors paint no background, so the
  // highlight is gone there and a bare `outline-none` leaves the item with nothing at all. An item
  // hides the outline with `outline-hidden`, which Tailwind brings back in forced colors.
  it.each(sources)("$name resets the outline only on popup containers", ({ text }) => {
    const containers = new Set(["Popup", "Positioner", "Backdrop", "Viewport"]);
    const code = codeLines(text);
    const offenders = linesMatching(text, /outline-none/).filter((line) => {
      // ponytail: the element is taken to be the nearest `<Primitive.X` at or above the line,
      // since a class string sits in its element's own props. The ceiling is a plain element
      // nested inside a popup part, which would read as that part; none exists today. If one
      // does, parse the enclosing JSX element instead.
      const above = code.slice(0, line).join("\n");
      const part = [...above.matchAll(/<Primitive\.(\w+)/g)].at(-1)?.[1];
      return part === undefined || !containers.has(part);
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
