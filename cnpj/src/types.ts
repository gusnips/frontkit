/**
 * One company, whichever provider answered: Receita Federal's own field names, as its open data and
 * the registries built on it spell them, and one way of writing each value. Codes keep their
 * leading zeros (CNAE `0600001`, city `6001`), dates are `YYYY-MM-DD`, and a field the provider does
 * not publish is `null`, never a guess.
 *
 * This is also the body a registry server answers with. See the README's contract.
 */
export interface CnpjRecord {
  /** 14 characters, letters uppercased: `33000167000101`, `12ABC34501DE35`. */
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  matriz_filial: "MATRIZ" | "FILIAL" | null;
  situacao_cadastral: CnpjSituacao;
  data_situacao_cadastral: string | null;
  /** `null` also when Receita says there is no reason ("SEM MOTIVO"). */
  motivo_situacao_cadastral: string | null;
  data_inicio_atividade: string | null;
  /** Four digits: `2038`, "Sociedade de Economia Mista". */
  natureza_juridica: CnpjCode | null;
  porte: CnpjPorte | null;
  /** In reais. */
  capital_social: number | null;
  /** Seven digits: `0600001`. */
  cnae_principal: CnpjCode | null;
  cnaes_secundarios: CnpjCode[];
  endereco: CnpjAddress;
  /**
   * `552121660000`: 55, the area code, then the 8 or 9 digits Receita has. No 9 is added to an old
   * mobile. A number that is not 8 or 9 digits, or is one digit repeated, is left out.
   */
  telefones: string[];
  email: string | null;
  socios: CnpjPartner[];
  /** A company missing from Receita's Simples file never opted in, so it reads `optante: false`. */
  simples_nacional: CnpjOption;
  mei: CnpjOption;
  /** How many establishments share the first 8 characters. `null` from the public providers. */
  total_filiais: number | null;
}

export type CnpjSituacao = "ATIVA" | "BAIXADA" | "INAPTA" | "SUSPENSA" | "NULA";

export type CnpjPorte = "MICRO EMPRESA" | "EMPRESA DE PEQUENO PORTE" | "DEMAIS";

export interface CnpjCode {
  codigo: string;
  descricao: string;
}

export interface CnpjAddress {
  /** The street with its type: `AVENIDA REPUBLICA DO CHILE`. */
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  /** Eight digits. */
  cep: string | null;
  uf: string | null;
  municipio: {
    nome: string | null;
    /** Receita's own city code, 4 digits (`6001`, the SIAFI code). ReceitaWS sends no code. */
    codigo: string | null;
    /** IBGE's, 7 digits (`3304557`). */
    codigo_ibge: string | null;
  };
}

export interface CnpjPartner {
  nome: string;
  tipo: "pessoa_juridica" | "pessoa_fisica" | "estrangeiro" | null;
  /**
   * A person's CPF comes masked by Receita: `***912137**`. A company's is its CNPJ, or only its first
   * 8 characters in Receita's files since 2026-08. `null` when the provider sends none (ReceitaWS).
   */
  cpf_cnpj: string | null;
  /** Two digits: `10`, "Diretor". */
  qualificacao: CnpjCode | null;
  data_entrada: string | null;
  /** `61 a 70 anos`. */
  faixa_etaria: string | null;
}

export interface CnpjOption {
  optante: boolean;
  data_opcao: string | null;
  data_exclusao: string | null;
}

/**
 * Where a lookup asks. `lookup` resolves the record, resolves `null` when the provider says it does
 * not have the CNPJ, and throws for anything else, which sends the lookup to the next provider.
 */
export interface CnpjProvider {
  /** Names the provider in errors: `BrasilAPI: HTTP 503`. */
  name: string;
  lookup(
    cnpj: string,
    request: { signal: AbortSignal; fetch: typeof fetch },
  ): Promise<CnpjRecord | null>;
}
