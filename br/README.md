# @gusnips/br

Checks and formats Brazilian documents and phone numbers: CPF, CNPJ, phones and CEP. It also finds
the address for a CEP. The same code runs on a server, in a browser and in React Native. No
dependencies.

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

```ts
import { normalizeDocument } from "@gusnips/br";

normalizeDocument("12.abc.345/01de-35"); // "12ABC34501DE35"
```

`normalizeDocument` removes only dots, slashes, hyphens and whitespace. It uppercases ASCII a-z
and keeps every other character, including `*`, `!` and Unicode. It never pads, truncates or
checks a value. Use it before sending or storing a document, then validate when you need to reject
bad input.

Each function has its own job:

- `formatCpf` and `formatCnpj` display a **complete** value. They add back the leading zeros a
  number column drops (`1144477735` becomes `011.444.777-35`), and anything that isn't a document
  comes back unchanged.
- `maskCpf`, `maskCnpj` and `maskDocument` format **partial** input as it is typed, and never pad.
  `maskDocument` switches from CPF to CNPJ after 11 digits, or at the first letter. Masks drop
  unsupported characters and extra input. Never use one to prepare a value for an API or storage:
  `maskCnpj("12ABC34501DE35A")` hides the extra `A` and looks valid.
- `isValidCpf` and `isValidCnpj` check the whole value and its check digits. Formatting and lowercase
  ASCII letters are accepted. Extra characters, Unicode letters or digits, masked values and letters
  in the last two positions are refused. A value made of one repeated digit is also refused,
  because the arithmetic alone would accept it.

`classifyDocument` answers "is this a CPF or a CNPJ?" by shape alone, without checking the digits.
It accepts only 11 digits for a CPF, or 12 ASCII letters or digits followed by two digits for a CNPJ,
with the same normalization as the validators. Government datasets contain test CPFs whose check
digits fail, and those are still people.

`cpfCheckDigits` and `cnpjCheckDigits` compute the last two digits from the rest. They accept formatted
bases and lowercase ASCII letters, but throw `RangeError` unless the whole base is nine digits for
a CPF or twelve ASCII letters or digits for a CNPJ. Use them to build a valid document in a test,
or to complete a head office's CNPJ from its 8-character root: `root + "0001"` plus the two digits.

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
import { lookupCep } from "@gusnips/br/lookup";

await lookupCep("01001-000");
// { cep: "01001000", street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP", ibge: "3550308" }
```

It asks ViaCEP first, and BrasilAPI when ViaCEP fails or doesn't know the CEP.

`null` means the CEP was not found. Input that isn't eight digits is `null` too, and makes no
request.

A thrown `CepLookupError` means neither provider could answer. The error's `cause` lists both
failures. A failure never comes back as `null`, so a dropped connection doesn't tell the reader
their CEP is wrong.

```ts
try {
  const address = await lookupCep(cep);
  if (address === null) return t("errors.cepNotFound");
  fill(address);
} catch {
  return t("errors.cepLookupFailed"); // let them type the address by hand
}
```

Each provider gets 5 seconds before the next one is asked. Change that with `timeoutMs`. Pass
`signal` to cancel: the call rejects at once and asks no other provider. Pass `fetch` to use your
own, in tests for example. It needs a global `fetch` and `AbortSignal.any` (Node 22, browsers since
2024).

`street` and `neighborhood` can be empty. A whole small town can share one CEP, so a CEP with no
street is still a real CEP. `ibge` is the city's IBGE code, or `null` when the provider didn't send
one (BrasilAPI never does).

Formatting needs no request, and comes from the main entry:

```ts
import { formatCep, normalizeCep } from "@gusnips/br";

formatCep("01310100"); // "01310-100"
normalizeCep("01310-100"); // "01310100", or null when it isn't eight digits
```

## Not here

- **Error messages.** The checks return a boolean, a string or `null`, and `lookupCep` returns
  `null` or throws. The sentence the reader sees belongs in your own translations:
  `isValidCpf(value) ? undefined : t("errors.cpfInvalid")`.
- **zod.** Wrapping a check is one line, `z.string().refine(isValidCpf)`, and the message is yours.
