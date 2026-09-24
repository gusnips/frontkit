import { describe, expect, it } from "vitest";
import { formatCep, maskCep, normalizeCep } from "./cep.ts";

describe("CEP", () => {
  it("reads eight digits in any punctuation", () => {
    expect(normalizeCep("01310-100")).toBe("01310100");
    expect(normalizeCep("01.310-100")).toBe("01310100");
    expect(normalizeCep("1310100")).toBe(null);
  });

  it("formats a complete one and leaves the rest alone", () => {
    expect(formatCep("01310100")).toBe("01310-100");
    expect(formatCep("1310100")).toBe("1310100");
  });

  it("masks as it is typed", () => {
    expect(["013", "01310", "013101", "0131010099"].map(maskCep)).toEqual([
      "013",
      "01310",
      "01310-1",
      "01310-100",
    ]);
  });
});
