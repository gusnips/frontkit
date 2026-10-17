import { describe, expect, it, vi } from "vitest";
import brasilApiPetrobras from "../fixtures/brasil-api-petrobras.json";
import brasilApiUnknown from "../fixtures/brasil-api-unknown.json";
import cnpjWsPetrobras from "../fixtures/cnpj-ws-petrobras.json";
import cnpjWsUnknown from "../fixtures/cnpj-ws-unknown.json";
import minhaReceitaPetrobras from "../fixtures/minha-receita-petrobras.json";
import minhaReceitaUnknown from "../fixtures/minha-receita-unknown.json";
import receitaWsPetrobras from "../fixtures/receita-ws-petrobras.json";
import receitaWsUnknown from "../fixtures/receita-ws-unknown.json";
import { brasilApi, cnpjWs, minhaReceita, receitaWs, registry } from "./providers.ts";
import type { CnpjPartner, CnpjProvider, CnpjRecord } from "./types.ts";

// Each fixture is one provider's real answer, recorded on 2026-10-16 with a plain GET to the `url`
// it holds: Petrobras, and a CNPJ whose check digits hold and that no provider has.
const PETROBRAS = "33000167000101";
const UNKNOWN = "99999998000147";

interface Recording {
  url: string;
  status: number;
  body: unknown;
}

function answer(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

/** A fetch that answers each recorded address with its recording, and fails any other. */
function recorded(...recordings: Recording[]) {
  return vi.fn<typeof fetch>(async (input) => {
    const hit = recordings.find((r) => r.url === String(input));
    if (!hit) throw new Error(`no recording for ${String(input)}`);
    return answer(hit.body, hit.status);
  });
}

function ask(provider: CnpjProvider, cnpj: string, fetch: typeof globalThis.fetch) {
  return provider.lookup(cnpj, { signal: new AbortController().signal, fetch });
}

async function petrobrasFrom(provider: CnpjProvider, recording: Recording): Promise<CnpjRecord> {
  const record = await ask(provider, PETROBRAS, recorded(recording));
  if (record === null) throw new Error("expected Petrobras");
  return record;
}

const byName = (a: CnpjPartner, b: CnpjPartner) => a.nome.localeCompare(b.nome);

/** What every provider says about Petrobras, once each spelling is mapped to one. */
const PETROBRAS_EVERYWHERE = {
  cnpj: PETROBRAS,
  razao_social: "PETROLEO BRASILEIRO S A PETROBRAS",
  nome_fantasia: "PETROBRAS - EDISE",
  matriz_filial: "MATRIZ",
  situacao_cadastral: "ATIVA",
  data_situacao_cadastral: "2005-11-03",
  motivo_situacao_cadastral: null,
  data_inicio_atividade: "1966-09-28",
  natureza_juridica: { codigo: "2038", descricao: "Sociedade de Economia Mista" },
  porte: "DEMAIS",
  cnae_principal: { codigo: "0600001", descricao: "Extração de petróleo e gás natural" },
  endereco: { numero: "65", complemento: null, bairro: "CENTRO", cep: "20031170", uf: "RJ" },
  // Receita also lists a fax, `21` and `3224`, which is no phone number.
  telefones: ["552121660000"],
  simples_nacional: { optante: false, data_opcao: null, data_exclusao: null },
  mei: { optante: false, data_opcao: null, data_exclusao: null },
  total_filiais: null,
};

const SECONDARY_CNAES = ["1921700", "3520401", "3520402", "4681801", "8630599"];

describe.each([
  ["Minha Receita", minhaReceita(), minhaReceitaPetrobras, minhaReceitaUnknown],
  ["BrasilAPI", brasilApi(), brasilApiPetrobras, brasilApiUnknown],
  ["cnpj.ws", cnpjWs(), cnpjWsPetrobras, cnpjWsUnknown],
  ["ReceitaWS", receitaWs(), receitaWsPetrobras, receitaWsUnknown],
])("%s", (_name, provider, petrobras, unknown) => {
  it("asks for the CNPJ at the address it was recorded from", async () => {
    const fetch = recorded(petrobras);
    await ask(provider, PETROBRAS, fetch);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([petrobras.url]);
  });

  it("maps Petrobras to the same record as every other provider", async () => {
    const record = await petrobrasFrom(provider, petrobras);
    expect(record).toMatchObject(PETROBRAS_EVERYWHERE);
    expect(record.cnaes_secundarios.map((cnae) => cnae.codigo)).toEqual(SECONDARY_CNAES);
    // Eight partners, each with the same role everywhere: Receita's current list.
    const roles = [...record.socios].sort(byName).map((s) => [s.nome, s.qualificacao]);
    expect(roles).toHaveLength(8);
    expect(roles[0]).toEqual([
      "ANGELICA GARCIA COBAS LAUREANO",
      { codigo: "10", descricao: "Diretor" },
    ]);
    expect(roles).toContainEqual([
      "MAGDA MARIA DE REGINA CHAMBRIARD",
      { codigo: "16", descricao: "Presidente" },
    ]);
  });

  it("reads the unknown CNPJ's recorded answer as not found", async () => {
    await expect(ask(provider, UNKNOWN, recorded(unknown))).resolves.toBe(null);
  });
});

describe("what only some providers publish", () => {
  it("Minha Receita: both city codes and the partners' documents, but no e-mail", async () => {
    const record = await petrobrasFrom(minhaReceita(), minhaReceitaPetrobras);
    expect(record.endereco).toEqual({
      logradouro: "AVENIDA REPUBLICA DO CHILE",
      numero: "65",
      complemento: null,
      bairro: "CENTRO",
      cep: "20031170",
      uf: "RJ",
      municipio: { nome: "RIO DE JANEIRO", codigo: "6001", codigo_ibge: "3304557" },
    });
    expect(record.email).toBe(null);
    expect(record.capital_social).toBe(205431960000);
    expect([...record.socios].sort(byName)[0]).toEqual({
      nome: "ANGELICA GARCIA COBAS LAUREANO",
      tipo: "pessoa_fisica",
      cpf_cnpj: "***912137**",
      qualificacao: { codigo: "10", descricao: "Diretor" },
      data_entrada: "2025-07-29",
      faixa_etaria: "71 a 80 anos",
    });
  });

  it("cnpj.ws: the e-mail, and the same partners as Minha Receita once it drops the ones who left", async () => {
    const record = await petrobrasFrom(cnpjWs(), cnpjWsPetrobras);
    expect(record.email).toBe("cc-rfisc@petrobras.com.br");
    expect(record.capital_social).toBe(205431960490.52);
    expect(record.endereco.municipio).toEqual({
      nome: "Rio de Janeiro",
      codigo: "6001",
      codigo_ibge: "3304557",
    });

    expect(cnpjWsPetrobras.body.socios).toHaveLength(10);
    const fromMinhaReceita = await petrobrasFrom(minhaReceita(), minhaReceitaPetrobras);
    expect([...record.socios].sort(byName)).toEqual([...fromMinhaReceita.socios].sort(byName));
    const names = record.socios.map((s) => s.nome);
    expect(names).not.toContain("MAURICIO TIOMNO TOLMASQUIM");
    expect(names).not.toContain("CLAUDIO ROMEO SCHLOSSER");
  });

  it("ReceitaWS: the e-mail, but no city code and no partner documents", async () => {
    const record = await petrobrasFrom(receitaWs(), receitaWsPetrobras);
    expect(record.email).toBe("cc-rfisc@petrobras.com.br");
    expect(record.endereco.logradouro).toBe("AV REPUBLICA DO CHILE");
    expect(record.endereco.municipio).toEqual({
      nome: "RIO DE JANEIRO",
      codigo: null,
      codigo_ibge: null,
    });
    expect(record.socios.every((s) => s.cpf_cnpj === null && s.tipo === null)).toBe(true);
  });

  it("reads a Simples and MEI option in each shape", async () => {
    const minha = {
      ...minhaReceitaPetrobras.body,
      opcao_pelo_simples: true,
      data_opcao_pelo_simples: "2018-01-01",
      opcao_pelo_mei: false,
      data_exclusao_do_mei: "2019-12-31",
    };
    const ws = {
      ...cnpjWsPetrobras.body,
      simples: {
        simples: "Sim",
        data_opcao_simples: "2018-01-01",
        data_exclusao_simples: null,
        mei: "Não",
        data_opcao_mei: null,
        data_exclusao_mei: "2019-12-31",
      },
    };
    const receita = {
      ...receitaWsPetrobras.body,
      simples: { optante: true, data_opcao: "01/01/2018", data_exclusao: null },
      simei: { optante: false, data_opcao: null, data_exclusao: "31/12/2019" },
    };
    for (const [provider, body] of [
      [minhaReceita(), minha],
      [cnpjWs(), ws],
      [receitaWs(), receita],
    ] as const) {
      const record = await ask(provider, PETROBRAS, async () => answer(body));
      expect(record?.simples_nacional).toEqual({
        optante: true,
        data_opcao: "2018-01-01",
        data_exclusao: null,
      });
      expect(record?.mei).toEqual({
        optante: false,
        data_opcao: null,
        data_exclusao: "2019-12-31",
      });
    }
  });
});

describe("an answer that is not the company", () => {
  it.each([
    ["an HTTP error", answer({ status: 429, titulo: "Muitas requisições" }, 429), "HTTP 429"],
    ["a body that is not an object", answer("[]"), "the answer is not a company"],
    [
      "another company",
      answer({ ...minhaReceitaPetrobras.body, cnpj: "00000000000191" }),
      "the answer is for another CNPJ, 00000000000191",
    ],
    [
      "no razão social",
      answer({ ...minhaReceitaPetrobras.body, razao_social: " " }),
      "the answer has no razão social",
    ],
    [
      "a status Receita does not have",
      answer({ ...minhaReceitaPetrobras.body, descricao_situacao_cadastral: "" }),
      'unknown situação cadastral ""',
    ],
  ])("throws for %s", async (_case, response, message) => {
    await expect(ask(minhaReceita(), PETROBRAS, async () => response)).rejects.toThrow(message);
  });

  it("throws for a ReceitaWS error that is not Receita refusing the CNPJ", async () => {
    const tooMany = answer({
      status: "ERROR",
      message: "Too many requests, please try again later.",
    });
    await expect(ask(receitaWs(), PETROBRAS, async () => tooMany)).rejects.toThrow("Too many");
  });
});

describe("registry", () => {
  const url = "https://registry.example/v1/cnpj";

  it("asks {url}/{cnpj} with the key, and reads its own record back unchanged", async () => {
    const record = await petrobrasFrom(minhaReceita(), minhaReceitaPetrobras);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => answer(record));
    const provider = registry({ url: `${url}/`, apiKey: "key-1" });

    await expect(ask(provider, PETROBRAS, fetch)).resolves.toEqual(record);
    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(String(input)).toBe(`${url}/${PETROBRAS}`);
    expect(new Headers(init?.headers).get("X-API-Key")).toBe("key-1");
    expect(provider.name).toBe("registry.example");
  });

  it("reads a 404 as not found", async () => {
    await expect(ask(registry({ url }), UNKNOWN, async () => answer({}, 404))).resolves.toBe(null);
  });

  it("writes a lenient server's values the package's way", async () => {
    const record = await petrobrasFrom(minhaReceita(), minhaReceitaPetrobras);
    const lenient = {
      ...record,
      cnpj: "33.000.167/0001-01",
      situacao_cadastral: "Ativa",
      cnae_principal: { codigo: 600001, descricao: "Extração de petróleo e gás natural" },
      telefones: ["(21) 2166-0000", "21 99999-9999"],
      endereco: { ...record.endereco, municipio: { nome: "RIO DE JANEIRO", codigo: 6001 } },
    };
    const read = await ask(registry({ url }), PETROBRAS, async () => answer(lenient));
    expect(read).toMatchObject({
      cnpj: PETROBRAS,
      situacao_cadastral: "ATIVA",
      cnae_principal: { codigo: "0600001" },
      telefones: ["552121660000"],
      endereco: { municipio: { nome: "RIO DE JANEIRO", codigo: "6001", codigo_ibge: null } },
    });
  });
});
