# @gusnips/br

Checks and formats Brazilian documents and phone numbers: CPF, CNPJ, phones and CEP. The same
code runs on a server, in a browser and in React Native. No dependencies.

```ts
import { isValidCnpj } from "@gusnips/br";

isValidCnpj("12.ABC.345/01DE-35"); // true
```

## CPF and CNPJ

```ts
import { formatCnpj, isValidCpf, maskDocument } from "@gusnips/br";

isValidCpf("111.444.777-35"); // true
formatCnpj("12abc34501de35"); // "12.ABC.345/01DE-35"
maskDocument("1114447"); // "111.444.7", for a field as somebody types
```

**Since July 2026 a new CNPJ can have letters.** The first twelve characters can be A-Z as well as
digits. The last two, the check digits, are still numbers. `isValidCnpj`, `formatCnpj` and
`maskCnpj` accept both kinds. A checker that strips letters before it checks turns these CNPJs down,
so a company registered this year can't sign up.

Three kinds of function, and they do different jobs:

- `formatCpf` and `formatCnpj` display a **complete** value. They add back the leading zeros a
  number column drops (`1144477735` becomes `011.444.777-35`), and anything that isn't a document
  comes back unchanged.
- `maskCpf`, `maskCnpj` and `maskDocument` format **partial** input as it is typed, and never pad.
  `maskDocument` switches from CPF to CNPJ after 11 digits, or at the first letter.
- `isValidCpf` and `isValidCnpj` check the check digits. A value made of one repeated digit is always
  refused, because the arithmetic alone would accept it.

`classifyDocument` answers "is this a CPF or a CNPJ?" by shape alone, without checking the digits.
Government datasets contain test CPFs whose check digits fail, and those are still people.

`cpfCheckDigits` and `cnpjCheckDigits` compute the last two digits from the rest. Use them to build a
valid document in a test, or to complete a head office's CNPJ from its 8-character root:
`root + "0001"` plus the two digits.

## Phones

```ts
import { brMobileVariants, formatBrPhone, toE164Br } from "@gusnips/br";

toE164Br("(11) 98765-4321"); // "+5511987654321"
formatBrPhone("5511987654321"); // "(11) 98765-4321"
brMobileVariants("5511987654321"); // ["5511987654321", "551187654321"]
```

`parseBrPhone` reads a number however it was written: with or without `+55`, with punctuation, or
with the trunk `0` people dial between cities. It returns `null` for anything it can't read. It
checks the area code against the 67 in use, and it refuses a subscriber made of one repeated digit,
like `99999-9999`.

**Brazilian numbers only, on purpose.** A general phone library that reads bare digits guesses the
country from the first few, and for a Brazilian mobile typed without `+55` it often guesses wrong:
area code 31 reads as the Netherlands and 81 as Japan. If you also take foreign numbers, send the
ones that start with `+` and aren't `+55` to an international library, and send the rest here.

`55` is both the country code and an area code (Rio Grande do Sul), so length decides first. Eleven
digits starting with 55 are a mobile in area 55. Only a 12- or 13-digit number carries the country
code.

`brMobileVariants` gives both forms a mobile may be registered under on WhatsApp: with the ninth
digit and without it. An account created before the ninth digit existed can still use the short
form. Look up both. Pass it an international number, so run `toE164Br` on user input first. Guessing
that bare digits are Brazilian is how a foreign number gets matched to somebody else.

## CEP

```ts
import { formatCep, normalizeCep } from "@gusnips/br";

formatCep("01310100"); // "01310-100"
normalizeCep("01310-100"); // "01310100", or null when it isn't eight digits
```

Looking a CEP up is a network call to a provider you choose, so it isn't here. A real CEP can also
cover a whole small town with no street name, so a lookup that finds no street doesn't mean the CEP
is wrong.

## Not here

- **Error messages.** Every function returns a boolean, a string or `null`. The sentence the reader
  sees belongs in your own translations:
  `isValidCpf(value) ? undefined : t("errors.cpfInvalid")`.
- **zod.** Wrapping a check is one line, `z.string().refine(isValidCpf)`, and the message is yours.
