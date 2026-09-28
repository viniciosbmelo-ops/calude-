import type { Surgery } from "@workspace/db";

/**
 * Mapeia a cirurgia documentada pelo médico para o código de protocolo de
 * reabilitação. Regra da especificação: cirurgia combinada → protocolo MAIS
 * restritivo (ex.: LCA + sutura meniscal → lca_r).
 *
 * Ordem de restritividade (mais → menos restritivo):
 *   lca_r > lcp_r > osteotomia > atj > mpfl > menisc_sutura > meniscectomia
 */
export type ProtocolCode =
  | "lca_r"
  | "lcp_r"
  | "menisc_sutura"
  | "meniscectomia"
  | "atj"
  | "osteotomia"
  | "mpfl"
  | "tend_patelar";

const PRIORITY: ProtocolCode[] = [
  "lca_r",
  "lcp_r",
  "osteotomia",
  "atj",
  "mpfl",
  "menisc_sutura",
  "meniscectomia",
];

export const PROTOCOL_LABELS: Record<ProtocolCode, string> = {
  lca_r: "Reconstrução do LCA",
  lcp_r: "Reconstrução do LCP",
  menisc_sutura: "Sutura meniscal",
  meniscectomia: "Meniscectomia parcial",
  atj: "Artroplastia total de joelho",
  osteotomia: "Osteotomia (HTO/DFO)",
  mpfl: "Reconstrução do MPFL",
  tend_patelar: "Tendinopatia patelar",
};

export interface MeniscalInfo {
  sutura: boolean | null;
  meniscectomia: boolean | null;
}

export function mapSurgeryToProtocol(
  surgery: Pick<Surgery, "tiposProcedimento" | "ligamentosAcometidos">,
  meniscal: MeniscalInfo[],
): ProtocolCode | null {
  const candidates = new Set<ProtocolCode>();
  const ligamentos = surgery.ligamentosAcometidos ?? [];
  const tipos = surgery.tiposProcedimento ?? [];

  if (ligamentos.includes("LCA")) candidates.add("lca_r");
  if (ligamentos.includes("LCP")) candidates.add("lcp_r");
  if (tipos.includes("Osteotomia")) candidates.add("osteotomia");
  if (tipos.includes("Artroplastias")) candidates.add("atj");
  if (tipos.includes("Instabilidade Patelar")) candidates.add("mpfl");

  const hasSutura = meniscal.some((m) => m.sutura === true);
  const hasMeniscectomia = meniscal.some((m) => m.meniscectomia === true);
  if (hasSutura) candidates.add("menisc_sutura");
  if (hasMeniscectomia) candidates.add("meniscectomia");
  // Lesão meniscal marcada mas sem detalhe → assume o mais restritivo (sutura)
  if (!hasSutura && !hasMeniscectomia && tipos.includes("Lesão Meniscal")) {
    candidates.add("menisc_sutura");
  }

  for (const code of PRIORITY) {
    if (candidates.has(code)) return code;
  }
  return null;
}

/** Iniciais do paciente para exibição no convite (privacidade). */
export function patientInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + ".")
    .join("");
}
