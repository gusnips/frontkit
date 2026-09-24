import { describe, expect, it } from "vitest";
import {
  brMobileVariants,
  formatBrPhone,
  isValidBrPhone,
  maskBrPhone,
  parseBrPhone,
  toE164Br,
} from "./phone.ts";

describe("parseBrPhone", () => {
  it("reads a number in every shape it gets written in", () => {
    for (const input of [
      "(11) 98765-4321",
      "11987654321",
      "5511987654321",
      "+55 11 98765-4321",
      "011 98765-4321",
    ]) {
      expect(toE164Br(input)).toBe("+5511987654321");
    }
    expect(parseBrPhone("(11) 3456-7890")).toEqual({
      ddd: "11",
      subscriber: "34567890",
      kind: "landline",
    });
  });

  // One copy tested an 11-digit number starting with 1 as North American before it tested for
  // Brazil, so every mobile in DDDs 11-19 was stored without its 55 and inbound lookups missed.
  it("keeps São Paulo-state mobiles Brazilian", () => {
    for (let ddd = 11; ddd <= 19; ddd++) {
      expect(toE164Br(`${ddd}987654321`)).toBe(`+55${ddd}987654321`);
    }
  });

  // 55 is the country code AND a DDD. Length decides first.
  it("reads 11 digits starting with 55 as DDD 55, and 13 as the country code", () => {
    expect(toE164Br("55987654321")).toBe("+5555987654321");
    expect(toE164Br("5555987654321")).toBe("+5555987654321");
    expect(toE164Br("5534567890")).toBe("+555534567890");
  });

  // A general parser guessed a country from bare digits: 31 became the Netherlands, 81 Japan.
  it("never guesses a foreign country", () => {
    expect(toE164Br("31987654321")).toBe("+5531987654321");
    expect(toE164Br("81987654321")).toBe("+5581987654321");
    expect(parseBrPhone("+1 415 555 0100")).toBe(null);
    expect(parseBrPhone("+351 912 345 678")).toBe(null);
    expect(parseBrPhone("14155550100")).toBe(null);
  });

  it("refuses what nobody can answer", () => {
    expect(isValidBrPhone("(20) 98765-4321")).toBe(false); // no such DDD
    expect(isValidBrPhone("(11) 99999-9999")).toBe(false); // a placeholder
    expect(isValidBrPhone("(31) 61234-5678")).toBe(false); // nine digits, not a mobile
    expect(isValidBrPhone("(11) 8765-4321")).toBe(false); // a mobile from before the ninth digit
    expect(isValidBrPhone("12345")).toBe(false);
  });
});

describe("display", () => {
  it("formats what it can read and leaves the rest alone", () => {
    expect(formatBrPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(formatBrPhone("1134567890")).toBe("(11) 3456-7890");
    expect(formatBrPhone("+1 415 555 0100")).toBe("+1 415 555 0100");
  });

  it("masks as it is typed", () => {
    expect(
      ["4", "41", "41988", "4198822919", "41988229199", "419882291990"].map(maskBrPhone),
    ).toEqual(["(4", "(41", "(41) 988", "(41) 9882-2919", "(41) 98822-9199", "(41) 98822-9199"]);
  });
});

describe("brMobileVariants", () => {
  it("gives both forms of a mobile, the given one first", () => {
    expect(brMobileVariants("5511987654321")).toEqual(["5511987654321", "551187654321"]);
    expect(brMobileVariants("+55 11 8765-4321")).toEqual(["551187654321", "5511987654321"]);
  });

  it("gives a landline, a foreign number and an unknown DDD alone", () => {
    expect(brMobileVariants("551134567890")).toEqual(["551134567890"]);
    expect(brMobileVariants("14155550100")).toEqual(["14155550100"]);
    expect(brMobileVariants("5520987654321")).toEqual(["5520987654321"]);
  });

  // Guessing that bare digits are Brazilian is how a foreign number got a twin that belongs to
  // someone else.
  it("does not treat a bare national number as international", () => {
    expect(brMobileVariants("11987654321")).toEqual(["11987654321"]);
  });
});
