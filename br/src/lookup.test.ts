import { describe, expect, it, vi } from "vitest";
import { CepLookupError, lookupCep } from "./lookup.ts";

const VIACEP = "https://viacep.com.br/ws/01001000/json/";
const BRASILAPI = "https://brasilapi.com.br/api/cep/v1/01001000";

const viaCepBody = {
  cep: "01001-000",
  logradouro: "Praça da Sé",
  complemento: "lado ímpar",
  bairro: "Sé",
  localidade: "São Paulo",
  uf: "SP",
  ibge: "3550308",
  ddd: "11",
};
const brasilApiBody = {
  cep: "01001000",
  state: "SP",
  city: "São Paulo",
  neighborhood: "Sé",
  street: "Praça da Sé",
  service: "viacep",
};
const address = {
  cep: "01001000",
  street: "Praça da Sé",
  neighborhood: "Sé",
  city: "São Paulo",
  state: "SP",
  ibge: "3550308",
};

type Answer = (init?: RequestInit) => Promise<Response>;

function reply(body: unknown, status = 200): Answer {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function fail(error: Error): Answer {
  return async () => {
    throw error;
  };
}

/** Never answers, and rejects when its signal aborts, as a real fetch does. */
const hang: Answer = (init) =>
  new Promise((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason));
  });

/** A fetch that answers ViaCEP and BrasilAPI as told. The URLs it was asked are in `.mock.calls`. */
function providers(viaCep: Answer, brasilApi: Answer = fail(new Error("not expected"))) {
  return vi.fn<typeof fetch>((input, init) =>
    String(input).startsWith("https://viacep.com.br/") ? viaCep(init) : brasilApi(init),
  );
}

function urls(fetch: ReturnType<typeof providers>): string[] {
  return fetch.mock.calls.map(([input]) => String(input));
}

describe("lookupCep", () => {
  it("answers from ViaCEP when it has the CEP", async () => {
    const fetch = providers(reply(viaCepBody));
    await expect(lookupCep("01001-000", { fetch })).resolves.toEqual(address);
    expect(urls(fetch)).toEqual([VIACEP]);
  });

  it.each([true, "true"])("returns null for erro: %j and does not ask BrasilAPI", async (erro) => {
    const fetch = providers(reply({ erro }));
    await expect(lookupCep("01001000", { fetch })).resolves.toBe(null);
    expect(urls(fetch)).toEqual([VIACEP]);
  });

  it.each([500, 503, 429])("asks BrasilAPI when ViaCEP answers HTTP %i", async (status) => {
    const fetch = providers(reply("", status), reply(brasilApiBody));
    await expect(lookupCep("01001000", { fetch })).resolves.toEqual({ ...address, ibge: null });
    expect(urls(fetch)).toEqual([VIACEP, BRASILAPI]);
  });

  it("asks BrasilAPI when ViaCEP times out", async () => {
    const fetch = providers(hang, reply(brasilApiBody));
    await expect(lookupCep("01001000", { fetch, timeoutMs: 20 })).resolves.toEqual({
      ...address,
      ibge: null,
    });
    expect(urls(fetch)).toEqual([VIACEP, BRASILAPI]);
  });

  it("throws CepLookupError with both failures when neither provider answers", async () => {
    const fetch = providers(fail(new TypeError("fetch failed")), reply("", 503));
    const result = lookupCep("01001000", { fetch });
    await expect(result).rejects.toBeInstanceOf(CepLookupError);
    await expect(result).rejects.toMatchObject({
      message: "No CEP provider answered. ViaCEP: fetch failed. BrasilAPI: HTTP 503",
      cause: [{ message: "ViaCEP: fetch failed" }, { message: "BrasilAPI: HTTP 503" }],
    });
  });

  it("returns null when ViaCEP fails and BrasilAPI answers 404", async () => {
    const fetch = providers(reply("", 500), reply({ name: "CepPromiseError" }, 404));
    await expect(lookupCep("01001000", { fetch })).resolves.toBe(null);
    expect(urls(fetch)).toEqual([VIACEP, BRASILAPI]);
  });

  it.each(["", "0100100", "01001-0000", "ABCDE-FGH"])(
    "returns null for %j without a request",
    async (cep) => {
      const fetch = providers(reply(viaCepBody));
      await expect(lookupCep(cep, { fetch })).resolves.toBe(null);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects at once when the caller aborts, and does not ask BrasilAPI", async () => {
    const fetch = providers(hang, reply(brasilApiBody));
    const controller = new AbortController();
    const result = lookupCep("01001000", { fetch, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(urls(fetch)).toEqual([VIACEP]);
  });

  it("keeps an empty street and neighborhood", async () => {
    const town = { ...viaCepBody, logradouro: "", bairro: "" };
    await expect(lookupCep("01001000", { fetch: providers(reply(town)) })).resolves.toEqual({
      ...address,
      street: "",
      neighborhood: "",
    });

    const bare = { cep: "01001000", state: "SP", city: "São Paulo", service: "viacep" };
    const fetch = providers(reply("", 500), reply(bare));
    await expect(lookupCep("01001000", { fetch })).resolves.toEqual({
      ...address,
      street: "",
      neighborhood: "",
      ibge: null,
    });
  });

  it.each([
    ["an HTML page", "<html>blocked</html>"],
    ["a list", []],
    ["no city", { ...viaCepBody, localidade: "" }],
    ["a number for a street", { ...viaCepBody, logradouro: 42 }],
  ])("treats %s from ViaCEP as a failure and asks BrasilAPI", async (_, body) => {
    const fetch = providers(reply(body), reply(brasilApiBody));
    await expect(lookupCep("01001000", { fetch })).resolves.toEqual({ ...address, ibge: null });
    expect(urls(fetch)).toEqual([VIACEP, BRASILAPI]);
  });

  it("never turns a malformed body into null", async () => {
    const fetch = providers(reply("", 500), reply({ cep: "01001000" }));
    await expect(lookupCep("01001000", { fetch })).rejects.toMatchObject({
      message: "No CEP provider answered. ViaCEP: HTTP 500. BrasilAPI: the body is not an address",
    });
  });
});
