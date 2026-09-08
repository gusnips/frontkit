import { describe, expect, it } from "vitest";
import { textareaHeight } from "./input.tsx";

describe("textareaHeight", () => {
  it("grows with the content", () => {
    expect(textareaHeight(400, 72)).toBe("72px");
  });

  it("stops at the cap, so a long paste scrolls instead of taking the page", () => {
    expect(textareaHeight(400, 900)).toBe("160px");
  });

  // A field squeezed to nothing wraps every word, so scrollHeight reads as tall as the cap
  // and the box opens to full height for one line of text. Hand it back to CSS instead.
  it("does not autosize a field too narrow to measure honestly", () => {
    expect(textareaHeight(120, 900)).toBe("");
  });

  it("takes over again the moment the column is wide enough", () => {
    expect(textareaHeight(180, 40)).toBe("40px");
  });
});
