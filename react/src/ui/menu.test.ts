/**
 * The group-caption rule, which only a structure can keep.
 *
 * `GroupLabel` reads its group's context in all three components that have one, so a caption
 * written as a SIBLING of the group throws at render. A production build reports that as
 * `Base UI error #31` for the menu, `#56` for select and `#18` for combobox, plus a link — a
 * number to go look up, naming neither the file, nor the part, nor the component. Documenting
 * that would not have stopped it. Two things do, and both are checked here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath`, never `import.meta.dir` — invariant 11.
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Comments out, code in. A guard that reads its own explanation as a violation is a guard that
 * teaches people to delete the explanation — and this rule is worth a paragraph that has to be
 * free to name the part it forbids.
 */
function codeOf(name: string): string {
  return readFileSync(join(here, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** Every `<Primitive.Group>…</Primitive.Group>` body in a file, for one group kind. */
function bodiesOf(code: string, part: string): string[] {
  const tag = `<Primitive\\.${part}\\b[^>]*>[\\s\\S]*?</Primitive\\.${part}>`;
  return code.match(new RegExp(tag, "g")) ?? [];
}

function misplacedCaptions(code: string): number {
  const inside = ["Group", "RadioGroup"]
    .flatMap((part) => bodiesOf(code, part))
    .reduce((total, body) => total + count(body, /<Primitive\.GroupLabel\b/g), 0);
  return count(code, /<Primitive\.GroupLabel\b/g) - inside;
}

const sources = readdirSync(here)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, code: codeOf(name) }));

describe("a group caption cannot be placed outside its group", () => {
  // Folder-wide rather than menu-only: today `menu.tsx` is the one file that renders a
  // caption, but `Select` and `Combobox` both have the part and would grow one the day either
  // wrapper learns grouped options. That is exactly where this bug lands next.
  it.each(sources)("$name keeps every GroupLabel inside a Group", ({ code }) => {
    expect(misplacedCaptions(code)).toBe(0);
  });

  it("has a caption somewhere to check, so the rule above is not vacuous", () => {
    const captions = sources.reduce(
      (total, { code }) => total + count(code, /<Primitive\.GroupLabel\b/g),
      0,
    );
    expect(captions).toBeGreaterThan(0);
  });

  it("never exports the menu's GroupLabel, Group or RadioGroup as raw parts", () => {
    // Menu only, on purpose. `MenuGroup` composes the caption as a prop, so the raw parts have
    // no job left and withholding them is free. Select and Combobox export theirs as the
    // escape hatch for grouped options, a shape those wrappers do not express — see the note
    // beside them in index.ts. Widening this assertion would forbid that on purpose.
    const surface = codeOf("menu.tsx") + codeOf("index.ts");
    expect(surface).not.toMatch(/=\s*Primitive\.(?:GroupLabel|Group|RadioGroup)\s*;/);
    expect(surface).not.toMatch(/\bMenuGroupLabel\b/);
  });
});
