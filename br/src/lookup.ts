/**
 * Looks a CEP up: ViaCEP first, BrasilAPI when ViaCEP fails or does not know the CEP. BrasilAPI
 * also asks the Correios, so it finds new CEPs that ViaCEP has not loaded yet.
 *
 * The only file in this package that makes a request, so it is its own entry point,
 * `@gusnips/br/lookup`. The main entry never touches `fetch`.
 *
 * Two outcomes must never be confused. `null` is an answer: the CEP was not found. A thrown
 * `CepLookupError` is no answer: neither provider answered. A form that shows "CEP not found"
 * for a dropped connection sends the reader to retype a CEP that was right.
 */
import { normalizeCep } from "./cep.ts";

export interface CepAddress {
  /** Eight digits. */
  cep: string;
  /** Empty when one CEP covers a whole small town. */
  street: string;
  neighborhood: string;
  city: string;
  /** The UF, like `SP`. */
  state: string;
  /** The city's IBGE code, or `null` when the provider sent none. BrasilAPI never does. */
  ibge: string | null;
}

/** Neither provider answered. `cause` holds one error per provider, ViaCEP first. */
export class CepLookupError extends Error {
  override name = "CepLookupError";
}

const DEFAULT_TIMEOUT_MS = 5000;
const NOT_AN_ADDRESS = "the body is not an address";

interface Provider {
  name: string;
  url(cep: string): string;
  /** The HTTP status that means the CEP does not exist. */
  missingStatus?: number;
  /** The body's fields under `CepAddress` names, or `null` when it says the CEP does not exist. */
  fields(body: Record<string, unknown>): Record<string, unknown> | null;
}

const PROVIDERS: Provider[] = [
  {
    name: "ViaCEP",
    url: (cep) => `https://viacep.com.br/ws/${cep}/json/`,
    // `erro` is `true` in the old API and `"true"` in the new one. ViaCEP answers 200 either way.
    fields: (body) =>
      body.erro
        ? null
        : {
            street: body.logradouro,
            neighborhood: body.bairro,
            city: body.localidade,
            state: body.uf,
            ibge: body.ibge,
          },
  },
  {
    name: "BrasilAPI",
    url: (cep) => `https://brasilapi.com.br/api/cep/v1/${cep}`,
    missingStatus: 404,
    // Its field names are already ours.
    fields: (body) => body,
  },
];

/**
 * The first address a provider finds, or `null` when one said the CEP does not exist and none found
 * it. When ViaCEP says "not found" and BrasilAPI then fails, ViaCEP's answer stands. Anything that is
 * not eight digits is `null` too, and makes no request.
 *
 * Throws `CepLookupError` when neither provider answered, never `null`. Each provider gets
 * `timeoutMs` (5 s) before the next one is asked. Aborting `signal` rejects with its reason at
 * once and asks no other provider.
 */
export async function lookupCep(
  cep: string,
  options: { signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<CepAddress | null> {
  const digits = normalizeCep(cep);
  if (digits === null) return null;

  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  // Called bare, not as `options.fetch()`: browser fetch throws when `this` is not the window.
  const request = options.fetch ?? globalThis.fetch;
  const failures: Error[] = [];
  let notFound = false;

  for (const provider of PROVIDERS) {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await request(provider.url(digits), {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const address = await readAnswer(provider, response, digits);
      if (address !== null) return address;
      notFound = true;
    } catch (error) {
      signal?.throwIfAborted();
      failures.push(new Error(`${provider.name}: ${messageOf(error)}`, { cause: error }));
    }
  }

  if (notFound) return null;
  const summary = failures.map((failure) => failure.message).join(". ");
  throw new CepLookupError(`No CEP provider answered. ${summary}`, { cause: failures });
}

/** The address, `null` when the provider says the CEP does not exist, or a throw. */
async function readAnswer(
  provider: Provider,
  response: Response,
  cep: string,
): Promise<CepAddress | null> {
  if (response.status === provider.missingStatus) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error(NOT_AN_ADDRESS);
  const fields = provider.fields(body);
  return fields === null ? null : expectAddress(cep, fields);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The provider's fields as a `CepAddress`, or a throw when they are not one. */
function expectAddress(cep: string, fields: Record<string, unknown>): CepAddress {
  const street = blankable(fields.street);
  const neighborhood = blankable(fields.neighborhood);
  const ibge = blankable(fields.ibge);
  const { city, state } = fields;
  if (
    street === undefined ||
    neighborhood === undefined ||
    ibge === undefined ||
    !filled(city) ||
    !filled(state)
  )
    throw new Error(NOT_AN_ADDRESS);
  return { cep, street, neighborhood, city, state, ibge: ibge || null };
}

function filled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A field a real CEP can leave blank: missing or `null` is `""`, anything but text is `undefined`. */
function blankable(value: unknown): string | undefined {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
