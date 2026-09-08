/**
 * The one rule in `menu.tsx` that only a structure can keep.
 *
 * `Menu.GroupLabel` reads its group's context, so a caption written as a SIBLING of the group
 * throws at render — and in a production build the message is the bare number 31, naming
 * neither the file nor the part. Documenting that would not have stopped it; the caption being
 * a prop, and the part never leaving this file, is what stops it. Both halves are checked
 * here, because either one alone is undone by a single line somebody adds in a hurry.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath`, never `import.meta.dir` — invariant 11.
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Comments out, code in. A guard that reads its own explanation as a violation is a guard that
 * teaches people to delete the explanation — and both rules below are worth a paragraph that
 * has to be free to name the part it forbids.
 */
function codeOf(name: string): string {
  return readFileSync(join(here, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** Every `<Primitive.Group>…</Primitive.Group>` body, for one group kind. */
function bodiesOf(code: string, part: string): string[] {
  const tag = `<Primitive\\.${part}\\b[^>]*>[\\s\\S]*?</Primitive\\.${part}>`;
  return code.match(new RegExp(tag, "g")) ?? [];
}

describe("a menu caption cannot be placed outside its group", () => {
  it("renders every GroupLabel inside a Group or a RadioGroup", () => {
    const menu = codeOf("menu.tsx");
    const inside = ["Group", "RadioGroup"]
      .flatMap((part) => bodiesOf(menu, part))
      .reduce((total, body) => total + count(body, /<Primitive\.GroupLabel\b/g), 0);

    expect(count(menu, /<Primitive\.GroupLabel\b/g)).toBe(inside);
    // …and there is at least one, or the assertion above passes on a file with no captions.
    expect(inside).toBeGreaterThan(0);
  });

  it("never exports GroupLabel, Group or RadioGroup as raw parts", () => {
    // The wrappers own those three names. Re-exporting the primitives beside them would put
    // the broken arrangement back within reach through the package's own front door.
    const surface = codeOf("menu.tsx") + codeOf("index.ts");
    expect(surface).not.toMatch(/=\s*Primitive\.(?:GroupLabel|Group|RadioGroup)\s*;/);
    expect(surface).not.toMatch(/\bMenuGroupLabel\b/);
  });
});
