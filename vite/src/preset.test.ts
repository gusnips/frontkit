import { describe, expect, it } from "vitest";
import { htmlPlaceholders } from "./preset.ts";

describe("htmlPlaceholders", () => {
  it("writes a value's dollar signs as they are", () => {
    // Narrowed to the plain function it is: this plugin's hook reads the page and nothing else,
    // and Vite's hook type is a union of that and an object form this plugin does not use.
    const transform = htmlPlaceholders({ PRICE: "$$ $& $'" }).transformIndexHtml as (
      html: string,
    ) => string;
    expect(transform("<p>%PRICE%</p><p>%PRICE%</p>")).toBe("<p>$$ $& $'</p><p>$$ $& $'</p>");
  });
});
