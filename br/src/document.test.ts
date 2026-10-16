import { describe, expect, it } from "vitest";
import {
  classifyDocument,
  cnpjCheckDigits,
  cpfCheckDigits,
  formatCnpj,
  formatCpf,
  isValidCnpj,
  isValidCpf,
  maskCnpj,
  maskCpf,
  maskDocument,
  normalizeDocument,
  redactCpf,
} from "./document.ts";

// The Receita Federal's own example of the alphanumeric format.
const ALPHANUMERIC = "12.ABC.345/01DE-35";

describe("normalizeDocument", () => {
  it.each([
    ["111.444.777-35", "11144477735"],
    ["11.222.333/0001-81", "11222333000181"],
    [" \t12.abc.345/01de-35\n", "12ABC34501DE35"],
    ["12ABC34501DE35", "12ABC34501DE35"],
    ["123.***.***-09!", "123******09!"],
    ["aßıſKé１２", "AßıſKé１２"],
    ["12_abc:345\\01de+35!", "12_ABC:345\\01DE+35!"],
    ["123", "123"],
    ["", ""],
  ])("normalizes %j without losing unsupported characters", (value, normalized) => {
    expect(normalizeDocument(value)).toBe(normalized);
    expect(normalizeDocument(normalized)).toBe(normalized);
  });
});

describe("CPF", () => {
  it("accepts real check digits, formatted or bare", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(cpfCheckDigits("111444777")).toBe("35");
    expect(cpfCheckDigits(" 111.444.777\t")).toBe("35");
    expect(isValidCpf("\t111.444.777-35\n")).toBe(true);
  });

  it.each(["11144477", "1114447770", "111444777!", "111444777A", "111444777é", "111***777"])(
    "refuses a malformed CPF base %j",
    (base) => {
      expect(() => cpfCheckDigits(base)).toThrow(RangeError);
    },
  );

  it("refuses a wrong digit, a wrong length, a letter, and one repeated digit", () => {
    expect(isValidCpf("111.444.777-36")).toBe(false);
    expect(isValidCpf("1114447773")).toBe(false);
    expect(isValidCpf("111.444.777-3A5")).toBe(false);
    // Every repeated digit passes the arithmetic, which is why it is refused on its own.
    for (let d = 0; d <= 9; d++) expect(isValidCpf(String(d).repeat(11))).toBe(false);
  });

  it("zero-pads for display, because datasets store it as a number", () => {
    expect(formatCpf("1144477735")).toBe("011.444.777-35");
    expect(formatCpf("not a cpf")).toBe("not a cpf");
    expect(redactCpf("111.444.777-35")).toBe("111.***.***-35");
  });

  it("masks as it is typed, without padding", () => {
    expect(["1", "1114", "1114447", "1114447773", "111444777356"].map(maskCpf)).toEqual([
      "1",
      "111.4",
      "111.444.7",
      "111.444.777-3",
      "111.444.777-35",
    ]);
  });
});

describe("CNPJ", () => {
  it("checks the alphanumeric CNPJ that every copy it replaces refused", () => {
    expect(isValidCnpj(ALPHANUMERIC)).toBe(true);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12abc34501de35")).toBe(true);
    expect(isValidCnpj(" \t12.abc.345/01de-35\n")).toBe(true);
    expect(cnpjCheckDigits("12ABC34501DE")).toBe("35");
    expect(cnpjCheckDigits(" \t12.abc.345/01de\n")).toBe("35");
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false);
    // The check digits stay numeric.
    expect(isValidCnpj("12.ABC.345/01DE-3A")).toBe(false);
  });

  it.each([
    "12ABC34501D",
    "12ABC34501DEA",
    "12ABC34501DE!",
    "12ABC34501DEé",
    "12ABC34501Dſ",
    "12ABC34501ＤE",
    "12***34501DE",
  ])("refuses a malformed CNPJ base %j", (base) => {
    expect(() => cnpjCheckDigits(base)).toThrow(RangeError);
  });

  it("checks a numeric CNPJ the way it always did", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(cnpjCheckDigits("112223330001")).toBe("81");
    expect(isValidCnpj("11222333000182")).toBe(false);
    for (let d = 0; d <= 9; d++) expect(isValidCnpj(String(d).repeat(14))).toBe(false);
  });

  // An independent derivation of the numeric weights — the left-to-right 5→2, 9→2 walk the old
  // copies used — so a mistake in the right-to-left formula cannot agree with itself.
  it("agrees with the classic numeric walk on 2,000 random bases", () => {
    const classic = (base: string): string => {
      const next = (s: string): number => {
        let sum = 0;
        let weight = s.length === 12 ? 5 : 6;
        for (const c of s) {
          sum += Number(c) * weight;
          weight = weight === 2 ? 9 : weight - 1;
        }
        return sum % 11 < 2 ? 0 : 11 - (sum % 11);
      };
      const first = next(base);
      return `${first}${next(base + first)}`;
    };
    for (let i = 0; i < 2000; i++) {
      const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
      expect(cnpjCheckDigits(base)).toBe(classic(base));
    }
  });

  it("keeps the letters when it formats, and pads only a numeric value", () => {
    // One copy stripped the letters here and displayed a different, numeric CNPJ.
    expect(formatCnpj("12abc34501de35")).toBe(ALPHANUMERIC);
    expect(formatCnpj("1222333000181")).toBe("01.222.333/0001-81");
    expect(formatCnpj("nope")).toBe("nope");
  });

  it("masks letters as they are typed and keeps the last two numeric", () => {
    expect(maskCnpj("12abc")).toBe("12.ABC");
    expect(maskCnpj("12ABC34501DE")).toBe("12.ABC.345/01DE");
    expect(maskCnpj("12ABC34501DEX3")).toBe("12.ABC.345/01DE-3");
    expect(maskCnpj("12ABC34501DE35999")).toBe(ALPHANUMERIC);
  });
});

describe("either document", () => {
  it("classifies by shape, not by check digits", () => {
    // A dataset's test CPF fails the check digit and is still a person.
    expect(classifyDocument("111.444.777-00")).toBe("cpf");
    expect(classifyDocument("12345678909")).toBe("cpf");
    expect(classifyDocument(ALPHANUMERIC)).toBe("cnpj");
    expect(classifyDocument(" \t12.abc.345/01de-35\n")).toBe("cnpj");
    expect(classifyDocument("12ABC34501DE36")).toBe("cnpj");
    expect(classifyDocument("11.222.333/0001-81")).toBe("cnpj");
    expect(classifyDocument("123")).toBe(null);
  });

  it("never turns a CNPJ with letters into a different CPF", () => {
    const value = "123A456B789C09";
    expect(normalizeDocument(value)).toBe(value);
    expect(classifyDocument(value)).toBe("cnpj");
    expect(isValidCnpj(value)).toBe(false);
    expect(isValidCpf(value)).toBe(false);
    expect(isValidCpf("12345678909")).toBe(true);
  });

  it.each([
    "11144477735!",
    "11144477735*",
    "11144477735é",
    "11144477735A",
    "111444777350",
    "123.***.***-09",
    "11１44477735",
    "12ABC34501DE35!",
    "12ABC34501DE35*",
    "12ABC34501DE35é",
    "12ABC34501DE35A",
    "12ABC34501DE350",
    "12ABC34501DE3A",
    "12ABC34501DEＡ5",
    "12ABC34501DE３5",
  ])("refuses the full malformed value %j", (value) => {
    expect(classifyDocument(value)).toBe(null);
    expect(isValidCpf(value)).toBe(false);
    expect(isValidCnpj(value)).toBe(false);
  });

  it("does not use a mask to validate or normalize input", () => {
    const value = "12ABC34501DE35A";
    expect(maskCnpj(value)).toBe(ALPHANUMERIC);
    expect(normalizeDocument(value)).toBe(value);
    expect(isValidCnpj(value)).toBe(false);
    expect(classifyDocument(value)).toBe(null);
  });

  it("switches from the CPF mask to the CNPJ mask past 11 digits, or at the first letter", () => {
    expect(maskDocument("11144477735")).toBe("111.444.777-35");
    expect(maskDocument("112223330001")).toBe("11.222.333/0001");
    expect(maskDocument("12A")).toBe("12.A");
  });
});
