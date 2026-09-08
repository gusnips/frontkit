import { describe, expect, it } from "vitest";
import { fitText } from "./og.ts";

const COLUMN = { width: 600, size: 60, advance: 0.5, label: "pricing headline" };

describe("fitText", () => {
  it("wraps at the column, not mid-word", () => {
    const { lines, overflow } = fitText("Everything your team ships, in one place", {
      ...COLUMN,
      maxLines: 3,
    });
    expect(overflow).toBeUndefined();
    expect(lines.join(" ")).toBe("Everything your team ships, in one place");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("leaves a line that already fits alone", () => {
    const { lines, overflow } = fitText("Short line", { ...COLUMN, maxLines: 2 });
    expect(lines).toEqual(["Short line"]);
    expect(overflow).toBeUndefined();
  });

  // The behaviour this file exists for. Appending `…` made wrapping a total function: every
  // string "fitted", so copy that outgrew the column had no failing case and shipped a card
  // missing the end of the one line the card exists to carry.
  it("reports copy that does not fit instead of quietly cutting it", () => {
    const tooLong = "A headline written for a search result rather than for a card, "
      .repeat(3)
      .trim();
    const { overflow } = fitText(tooLong, { ...COLUMN, maxLines: 2 });
    expect(overflow).toBeDefined();
    expect(overflow?.label).toBe("pricing headline");
    expect(overflow?.text).toBe(tooLong);
    expect(overflow?.maxLines).toBe(2);
  });

  // Still returned, so a failed run can show what the card WOULD have said.
  it("still returns the lines it managed, so a report can show them", () => {
    const { lines } = fitText("word ".repeat(40).trim(), { ...COLUMN, maxLines: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });

  it("collapses the newlines a catalog string may carry", () => {
    const { lines } = fitText("one\n  two", { ...COLUMN, maxLines: 3 });
    expect(lines).toEqual(["one two"]);
  });

  it("keeps a word longer than the column rather than dropping it", () => {
    const { lines } = fitText("supercalifragilisticexpialidocious", { ...COLUMN, maxLines: 1 });
    expect(lines).toEqual(["supercalifragilisticexpialidocious"]);
  });
});
