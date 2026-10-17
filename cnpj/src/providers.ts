/**
 * Where a lookup asks, and how each answer becomes one `CnpjRecord`.
 *
 * Every provider here publishes Receita Federal's open data, each in its own shape and its own
 * spelling of the same values: a CNAE arrives as `600001`, `"0600001"` or `"06.00-0-01"`, a date as
 * `1966-09-28` or `28/09/1966`, a status as `ATIVA` or `Ativa`. The mappers write each value one way,
 * so a record reads the same whichever provider answered, and the registry contract is that same
 * shape.
 */
import { normalizeDocument } from "@gusnips/br";
import type {
  CnpjCode,
  CnpjOption,
  CnpjPartner,
  CnpjPorte,
  CnpjProvider,
  CnpjRecord,
  CnpjSituacao,
} from "./types.ts";

type Json = Record<string, unknown>;

/**
 * Any server that answers this package's contract, which the README spells out: `GET {url}/{cnpj}`
 * with `X-API-Key`, 200 with a `CnpjRecord`, 404 when it does not have the CNPJ. Put it first: it is
 * your own copy of Receita's data, and the public providers are the fallback.
 */
export function registry(options: { url: string; apiKey?: string }): CnpjProvider {
  const base = options.url.replace(/\/+$/, "");
  const headers: Record<string, string> = options.apiKey ? { "X-API-Key": options.apiKey } : {};
  return httpProvider(new URL(base).host, (cnpj) => `${base}/${cnpj}`, fromRegistry, headers);
}

/** minhareceita.org: Receita's open data under Receita's own field names. */
export function minhaReceita(): CnpjProvider {
  return httpProvider("Minha Receita", (cnpj) => `https://minhareceita.org/${cnpj}`, fromOpenData);
}

/** BrasilAPI, which answers in Minha Receita's shape. */
export function brasilApi(): CnpjProvider {
  return httpProvider(
    "BrasilAPI",
    (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    fromOpenData,
  );
}

/** cnpj.ws's free API. Its docs allow 3 lookups a minute from one IP address, then answer 429. */
export function cnpjWs(): CnpjProvider {
  return httpProvider("cnpj.ws", (cnpj) => `https://publica.cnpj.ws/cnpj/${cnpj}`, fromCnpjWs);
}

/**
 * ReceitaWS's free API. Its docs allow 3 lookups a minute, and it answers only the CNPJs it already
 * holds: a CNPJ it has not stored is an error, so it counts as a failure, never as not found. No
 * city codes and no partner documents.
 */
export function receitaWs(): CnpjProvider {
  return httpProvider(
    "ReceitaWS",
    (cnpj) => `https://receitaws.com.br/v1/cnpj/${cnpj}`,
    fromReceitaWs,
  );
}

/** A provider that GETs one address per CNPJ, reads a 404 as "not found" and maps a JSON body. */
function httpProvider(
  name: string,
  url: (cnpj: string) => string,
  map: (body: Json) => CnpjRecord | null,
  headers: Record<string, string> = {},
): CnpjProvider {
  return {
    name,
    async lookup(cnpj, { signal, fetch }) {
      const response = await fetch(url(cnpj), {
        signal,
        headers: { Accept: "application/json", ...headers },
      });
      if (!response.ok) {
        // Unread, the body holds its connection open until it is collected.
        await response.body?.cancel();
        if (response.status === 404) return null;
        throw new Error(`HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      if (!isJson(body)) throw new Error("the answer is not a company");
      const record = map(body);
      if (record === null) return null;
      if (record.cnpj !== cnpj) throw new Error(`the answer is for another CNPJ, ${record.cnpj}`);
      if (record.razao_social === "") throw new Error("the answer has no razão social");
      return record;
    },
  };
}

// ─── The shapes ──────────────────────────────────────────────────────────────

/** This package's own shape, read with the same rules, so a sloppy server cannot hand on a bad value. */
function fromRegistry(d: Json): CnpjRecord {
  const address = object(d.endereco);
  const city = object(address.municipio);
  return {
    cnpj: normalizeDocument(text(d.cnpj) ?? ""),
    razao_social: text(d.razao_social) ?? "",
    nome_fantasia: text(d.nome_fantasia),
    matriz_filial: matrizFilial(d.matriz_filial),
    situacao_cadastral: situacao(d.situacao_cadastral),
    data_situacao_cadastral: date(d.data_situacao_cadastral),
    motivo_situacao_cadastral: motivo(d.motivo_situacao_cadastral),
    data_inicio_atividade: date(d.data_inicio_atividade),
    natureza_juridica: codeOf(d.natureza_juridica, 4),
    porte: porte(null, d.porte),
    capital_social: amount(d.capital_social),
    cnae_principal: codeOf(d.cnae_principal, 7),
    cnaes_secundarios: list(d.cnaes_secundarios).flatMap((c) => codeOf(c, 7) ?? []),
    endereco: {
      logradouro: text(address.logradouro),
      numero: text(address.numero),
      complemento: text(address.complemento),
      bairro: text(address.bairro),
      cep: digits(address.cep, 8),
      uf: uf(address.uf),
      municipio: {
        nome: text(city.nome),
        codigo: digits(city.codigo, 4),
        codigo_ibge: digits(city.codigo_ibge, 7),
      },
    },
    telefones: phones((Array.isArray(d.telefones) ? d.telefones : []).map(joinedPhone)),
    email: email(d.email),
    socios: list(d.socios).map((s) => ({
      nome: text(s.nome) ?? "",
      tipo: partnerKind(s.tipo),
      cpf_cnpj: partnerDocument(s.cpf_cnpj),
      qualificacao: codeOf(s.qualificacao, 2),
      data_entrada: date(s.data_entrada),
      faixa_etaria: text(s.faixa_etaria),
    })),
    simples_nacional: optionOf(d.simples_nacional),
    mei: optionOf(d.mei),
    total_filiais: count(d.total_filiais),
  };
}

/** Minha Receita and BrasilAPI. */
function fromOpenData(d: Json): CnpjRecord {
  return {
    cnpj: normalizeDocument(text(d.cnpj) ?? ""),
    razao_social: text(d.razao_social) ?? "",
    nome_fantasia: text(d.nome_fantasia),
    matriz_filial: matrizFilial(d.descricao_identificador_matriz_filial),
    situacao_cadastral: situacao(d.descricao_situacao_cadastral),
    data_situacao_cadastral: date(d.data_situacao_cadastral),
    motivo_situacao_cadastral: motivo(d.descricao_motivo_situacao_cadastral),
    data_inicio_atividade: date(d.data_inicio_atividade),
    natureza_juridica: code(digits(d.codigo_natureza_juridica, 4), d.natureza_juridica),
    porte: porte(d.codigo_porte, d.porte),
    capital_social: amount(d.capital_social),
    cnae_principal: code(cnae(d.cnae_fiscal), d.cnae_fiscal_descricao),
    cnaes_secundarios: list(d.cnaes_secundarios).flatMap(
      (c) => code(cnae(c.codigo), c.descricao) ?? [],
    ),
    endereco: {
      logradouro: street(d.descricao_tipo_de_logradouro, d.logradouro),
      numero: text(d.numero),
      complemento: text(d.complemento),
      bairro: text(d.bairro),
      cep: digits(d.cep, 8),
      uf: uf(d.uf),
      municipio: {
        nome: text(d.municipio),
        codigo: digits(d.codigo_municipio, 4),
        codigo_ibge: digits(d.codigo_municipio_ibge, 7),
      },
    },
    // Each field holds the area code and the number together: `2121660000`.
    telefones: phones([d.ddd_telefone_1, d.ddd_telefone_2, d.ddd_fax].map(joinedPhone)),
    email: email(d.email),
    socios: list(d.qsa).map((q) => ({
      nome: text(q.nome_socio) ?? "",
      tipo: PARTNER_KINDS[text(q.identificador_de_socio) ?? ""] ?? null,
      cpf_cnpj: partnerDocument(q.cnpj_cpf_do_socio),
      qualificacao: code(digits(q.codigo_qualificacao_socio, 2), q.qualificacao_socio),
      data_entrada: date(q.data_entrada_sociedade),
      // `Entre 61 a 70 anos` here, `61 a 70 anos` everywhere else.
      faixa_etaria: text(q.faixa_etaria)?.replace(/^entre\s+/i, "") ?? null,
    })),
    simples_nacional: option(
      d.opcao_pelo_simples,
      d.data_opcao_pelo_simples,
      d.data_exclusao_do_simples,
    ),
    mei: option(d.opcao_pelo_mei, d.data_opcao_pelo_mei, d.data_exclusao_do_mei),
    total_filiais: null,
  };
}

function fromCnpjWs(d: Json): CnpjRecord {
  const place = object(d.estabelecimento);
  const city = object(place.cidade);
  const natureza = object(d.natureza_juridica);
  const simples = object(d.simples);
  return {
    cnpj: normalizeDocument(text(place.cnpj) ?? ""),
    razao_social: text(d.razao_social) ?? "",
    nome_fantasia: text(place.nome_fantasia),
    matriz_filial: matrizFilial(place.tipo),
    situacao_cadastral: situacao(place.situacao_cadastral),
    data_situacao_cadastral: date(place.data_situacao_cadastral),
    motivo_situacao_cadastral: motivo(object(place.motivo_situacao_cadastral).descricao),
    data_inicio_atividade: date(place.data_inicio_atividade),
    natureza_juridica: code(digits(natureza.id, 4), natureza.descricao),
    porte: porte(object(d.porte).id, null),
    capital_social: amount(d.capital_social),
    cnae_principal: activity(object(place.atividade_principal)),
    cnaes_secundarios: list(place.atividades_secundarias).flatMap((a) => activity(a) ?? []),
    endereco: {
      logradouro: street(place.tipo_logradouro, place.logradouro),
      numero: text(place.numero),
      complemento: text(place.complemento),
      bairro: text(place.bairro),
      cep: digits(place.cep, 8),
      uf: uf(object(place.estado).sigla),
      municipio: {
        nome: text(city.nome),
        codigo: digits(city.siafi_id, 4),
        codigo_ibge: digits(city.ibge_id, 7),
      },
    },
    telefones: phones([
      phone(place.ddd1, place.telefone1),
      phone(place.ddd2, place.telefone2),
      phone(place.ddd_fax, place.fax),
    ]),
    email: email(place.email),
    socios: currentPartners(list(d.socios)).map((s) => {
      const role = object(s.qualificacao_socio);
      return {
        nome: text(s.nome) ?? "",
        tipo: partnerKind(s.tipo),
        cpf_cnpj: partnerDocument(s.cpf_cnpj_socio),
        qualificacao: code(digits(role.id, 2), role.descricao),
        data_entrada: date(s.data_entrada),
        faixa_etaria: text(s.faixa_etaria),
      };
    }),
    // From cnpj.ws's documented schema, not a recording: Petrobras has no Simples row there.
    // `simples` and `mei` are text, read as yes when they start with S (`Sim`).
    simples_nacional: option(
      simples.simples,
      simples.data_opcao_simples,
      simples.data_exclusao_simples,
    ),
    mei: option(simples.mei, simples.data_opcao_mei, simples.data_exclusao_mei),
    total_filiais: null,
  };
}

function fromReceitaWs(d: Json): CnpjRecord | null {
  if (text(d.status) === "ERROR") {
    // Its answer to a CNPJ Receita does not have is a 200 with this message, not a 404.
    if (/rejeitado/i.test(text(d.message) ?? "")) return null;
    throw new Error(text(d.message) ?? "status ERROR");
  }
  const principal = list(d.atividade_principal)[0];
  const simples = object(d.simples);
  const mei = object(d.simei);
  return {
    cnpj: normalizeDocument(text(d.cnpj) ?? ""),
    razao_social: text(d.nome) ?? "",
    nome_fantasia: text(d.fantasia),
    matriz_filial: matrizFilial(d.tipo),
    situacao_cadastral: situacao(d.situacao),
    data_situacao_cadastral: date(d.data_situacao),
    motivo_situacao_cadastral: motivo(d.motivo_situacao),
    data_inicio_atividade: date(d.abertura),
    natureza_juridica: splitCode(d.natureza_juridica, 4),
    porte: porte(null, d.porte),
    capital_social: amount(d.capital_social),
    cnae_principal: principal ? code(cnae(principal.code), principal.text) : null,
    cnaes_secundarios: list(d.atividades_secundarias).flatMap(
      (a) => code(cnae(a.code), a.text) ?? [],
    ),
    endereco: {
      logradouro: text(d.logradouro),
      numero: text(d.numero),
      complemento: text(d.complemento),
      bairro: text(d.bairro),
      cep: digits(d.cep, 8),
      uf: uf(d.uf),
      municipio: { nome: text(d.municipio), codigo: null, codigo_ibge: null },
    },
    // `(21) 2166-0000`, more than one joined by `/`.
    telefones: phones((text(d.telefone) ?? "").split("/").map(joinedPhone)),
    email: email(d.email),
    socios: list(d.qsa).map((q): CnpjPartner => ({
      nome: text(q.nome) ?? "",
      tipo: null,
      cpf_cnpj: null,
      qualificacao: splitCode(q.qual, 2),
      data_entrada: null,
      faixa_etaria: null,
    })),
    simples_nacional: option(simples.optante, simples.data_opcao, simples.data_exclusao),
    mei: option(mei.optante, mei.data_opcao, mei.data_exclusao),
    total_filiais: null,
  };
}

// ─── One way of writing each value ───────────────────────────────────────────

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Json {
  return isJson(value) ? value : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isJson) : [];
}

/** Trimmed text, `null` when empty. A number counts, because some providers send codes as numbers. */
function text(value: unknown): string | null {
  const s =
    typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return s === "" ? null : s;
}

/**
 * The digits of a code, zero-padded to its length, or `null`. A provider that sends a code as a
 * number has dropped its leading zeros: Petrobras's CNAE `0600001` arrives as `600001`.
 */
function digits(value: unknown, length: number): string | null {
  const d = text(value)?.replace(/\D/g, "") ?? "";
  return d === "" || d.length > length ? null : d.padStart(length, "0");
}

/** Seven digits. `0000000` is how ReceitaWS writes "no activity". */
function cnae(value: unknown): string | null {
  const d = digits(value, 7);
  return d === null || /^0+$/.test(d) ? null : d;
}

function code(codigo: string | null, descricao: unknown): CnpjCode | null {
  return codigo === null ? null : { codigo, descricao: text(descricao) ?? "" };
}

function codeOf(value: unknown, length: number): CnpjCode | null {
  const c = object(value);
  return code(digits(c.codigo, length), c.descricao);
}

/** cnpj.ws's activity: `{ id: "0600001", descricao }`. */
function activity(a: Json): CnpjCode | null {
  return code(cnae(a.id), a.descricao);
}

/** ReceitaWS's `203-8 - Sociedade de Economia Mista` and `16-Presidente`. */
function splitCode(value: unknown, length: number): CnpjCode | null {
  const match = /^([\d.-]+?)\s*-\s*(\D.*)$/.exec(text(value) ?? "");
  return match ? code(digits(match[1], length), match[2]) : null;
}

/** `YYYY-MM-DD` from `1966-09-28`, `1966-09-28T03:00:00Z` or `28/09/1966`. */
function date(value: unknown): string | null {
  const s = text(value) ?? "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

function amount(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(text(value) ?? Number.NaN);
  return Number.isFinite(n) ? n : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

const SITUACOES: readonly CnpjSituacao[] = ["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA"];

/** Required: an answer without one of Receita's five is not a company record. */
function situacao(value: unknown): CnpjSituacao {
  const s = text(value)?.toUpperCase();
  const known = SITUACOES.find((name) => name === s);
  if (known === undefined) throw new Error(`unknown situação cadastral ${JSON.stringify(value)}`);
  return known;
}

/** Receita's porte codes, worded as Receita words them. `00` is "not informed", so `null`. */
const PORTES: Record<string, CnpjPorte> = {
  "01": "MICRO EMPRESA",
  "03": "EMPRESA DE PEQUENO PORTE",
  "05": "DEMAIS",
};

function porte(codigo: unknown, label: unknown): CnpjPorte | null {
  const byCode = PORTES[digits(codigo, 2) ?? ""];
  if (byCode !== undefined) return byCode;
  const s = text(label)?.toUpperCase();
  return Object.values(PORTES).find((name) => name === s) ?? null;
}

function matrizFilial(value: unknown): CnpjRecord["matriz_filial"] {
  const s = text(value)?.toUpperCase();
  return s === "MATRIZ" || s === "FILIAL" ? s : null;
}

/** "SEM MOTIVO" is Receita's code 00, and the other providers send nothing for it. */
function motivo(value: unknown): string | null {
  const s = text(value);
  return s === null || /^sem motivo$/i.test(s) ? null : s;
}

function street(kind: unknown, name: unknown): string | null {
  return [text(kind), text(name)].filter((part) => part !== null).join(" ") || null;
}

function uf(value: unknown): string | null {
  const s = text(value)?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

function email(value: unknown): string | null {
  const s = text(value)?.toLowerCase();
  return s?.includes("@") ? s : null;
}

/**
 * `55`, the area code and the number, the way a registry built on Receita's files stores a phone:
 * the 8 or 9 digits as Receita has them, with no 9 added to an old mobile. A number that is not 8 or
 * 9 digits, or is one digit repeated (the `99999999` typed to get past a form), is dropped. Receita
 * keeps the fax in the same columns, and Petrobras's is `21` and `3224`.
 */
function phone(ddd: unknown, number: unknown): string | null {
  const area = text(ddd)?.replace(/\D/g, "") ?? "";
  const subscriber = text(number)?.replace(/\D/g, "") ?? "";
  if (!/^\d{2}$/.test(area) || !/^\d{8,9}$/.test(subscriber) || /^(\d)\1+$/.test(subscriber))
    return null;
  return `55${area}${subscriber}`;
}

/** The area code and the number in one field: `2121660000`, `(21) 2166-0000`, `552121660000`. */
function joinedPhone(value: unknown): string | null {
  const d = (text(value) ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return phone(d.slice(0, 2), d.slice(2));
}

function phones(found: (string | null)[]): string[] {
  return [...new Set(found.filter((p) => p !== null))];
}

/**
 * Minha Receita and cnpj.ws send `null` for a company missing from Receita's Simples file, which
 * lists only those that ever opted in, so `null` reads as "never opted". On Petrobras, both send
 * `null` where ReceitaWS sends `optante: false`.
 */
function option(optante: unknown, opcao: unknown, exclusao: unknown): CnpjOption {
  return {
    optante: optante === true || /^s/i.test(text(optante) ?? ""),
    data_opcao: date(opcao),
    data_exclusao: date(exclusao),
  };
}

function optionOf(value: unknown): CnpjOption {
  const o = object(value);
  return option(o.optante, o.data_opcao, o.data_exclusao);
}

const PARTNER_KINDS: Record<string, CnpjPartner["tipo"]> = {
  "1": "pessoa_juridica",
  "2": "pessoa_fisica",
  "3": "estrangeiro",
};

/** cnpj.ws's `Pessoa Física`, or this package's own word. */
function partnerKind(value: unknown): CnpjPartner["tipo"] {
  const s = (text(value) ?? "").toLowerCase();
  if (/^pessoa.jur/.test(s)) return "pessoa_juridica";
  if (/^pessoa.f/.test(s)) return "pessoa_fisica";
  return /^estrangeir/.test(s) ? "estrangeiro" : null;
}

/** A company's document loses its formatting. A person's masked CPF keeps its asterisks. */
function partnerDocument(value: unknown): string | null {
  const s = text(value);
  return s === null ? null : normalizeDocument(s);
}

/**
 * cnpj.ws keeps partners who have left. On 2026-10-16 it listed 10 for Petrobras where Receita's
 * current list has 8, and the two extra were last updated in 2025-09 and 2026-07, the eight in
 * 2026-09. So only the partners from its newest update count.
 */
function currentPartners(socios: Json[]): Json[] {
  const updated = socios.map((s) => text(s.atualizado_em) ?? "");
  const newest = updated.reduce((max, at) => (at > max ? at : max), "");
  return socios.filter((_, i) => updated[i] === newest);
}
