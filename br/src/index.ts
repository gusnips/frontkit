export {
  classifyDocument,
  cnpjCheckDigits,
  cpfCheckDigits,
  formatCnpj,
  formatCpf,
  isValidCnpj,
  isValidCpf,
  maskCnpj,
  maskCpf,
  maskDocument,
  redactCpf,
} from "./document.ts";
export type { DocumentKind } from "./document.ts";
export {
  brMobileVariants,
  formatBrPhone,
  isValidBrPhone,
  maskBrPhone,
  parseBrPhone,
  toE164Br,
} from "./phone.ts";
export type { BrPhone } from "./phone.ts";
export { formatCep, maskCep, normalizeCep } from "./cep.ts";
