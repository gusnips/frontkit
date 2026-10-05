import { Select, type SelectProps } from "./select.tsx";

/**
 * A currency as a reader finds it in a list: the code first, then the symbol in their language,
 * `BRL (R$)`, `USD ($)`, `EUR (€)`. The code leads because it is the part nobody misreads, and
 * the symbol follows because it is the part a reader scans for. Where the two are the same
 * string the code stands alone.
 */
export function currencyLabel(currency: string, locale: string): string {
  const code = currency.toUpperCase();
  const symbol =
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? code;
  return symbol === code ? code : `${code} (${symbol})`;
}

export type CurrencySelectProps<T extends string> = Omit<
  SelectProps<T>,
  "options" | "emptyLabel" | "placeholder"
> & {
  /** The currencies on offer, as the product writes them. Never empty: see `emptyLabel` below. */
  currencies: readonly [T, ...T[]];
  /** The reader's language, so each symbol reads their way. */
  locale: string;
};

/**
 * Which currency a price list is shown in. `Select` with the options already built, so every
 * product's picker reads the same and none of them writes the label rule again.
 *
 * Pass `disabled` once the customer's currency is locked. A locked picker stays visible, because
 * a control that vanishes is a question ("where did the currency go?") with no answer, and the
 * product says in words why it cannot change. `label` is the accessible name when no visible
 * label points at it. Both go straight through to `Select`.
 *
 * This package does not import `@gusnips/locale`, which is a leaf, so `currencies` is any string
 * list: the product's own `Currency` union flows through `T`.
 */
export function CurrencySelect<T extends string>({
  currencies,
  locale,
  ...rest
}: CurrencySelectProps<T>) {
  const options = currencies.map((currency) => ({
    value: currency,
    label: currencyLabel(currency, locale),
  }));
  // `Select` makes `emptyLabel` required so a popup never opens on nothing. A non-empty tuple is
  // what keeps this one from ever doing so, which is why there is no text to write here.
  return <Select<T> options={options} emptyLabel={null} {...rest} />;
}
