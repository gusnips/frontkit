import { describe, expect, it } from "vitest";
import { currencyLabel } from "./currency-select.tsx";

describe("currencyLabel", () => {
  it("leads with the code and follows with the symbol", () => {
    expect(currencyLabel("brl", "pt-BR")).toBe("BRL (R$)");
    expect(currencyLabel("usd", "en")).toBe("USD ($)");
    expect(currencyLabel("eur", "es")).toBe("EUR (€)");
  });

  it("reads the same symbol whichever language the reader has", () => {
    expect(currencyLabel("brl", "en")).toBe("BRL (R$)");
    expect(currencyLabel("usd", "pt-BR")).toBe("USD ($)");
  });

  it("takes the code in either case, as Stripe writes it or as a column stores it", () => {
    expect(currencyLabel("EUR", "es")).toBe("EUR (€)");
  });
});
