import type { Surgery } from "@workspace/db";

/**
 * Mapeia a cirurgia documentada para o protocolo de reabilitação publicado em
 * rehab_protocols. Os protocolos de ombro e cotovelo ainda não foram definidos
 * pelo médico: enquanto o catálogo estiver vazio, nenhuma cirurgia recebe
 * protocolo automático e o fisioterapeuta registra o plano livremente.
 */
export const PROTOCOL_LABELS: Record<string, string> = {};

export function mapSurgeryToProtocol(
  _surgery: Pick<Surgery, "tiposProcedimento">,
): string | null {
  return null;
}

/** Rótulo do procedimento para convites e cabeçalhos, sem dado clínico sensível. */
export function surgeryProcedureLabel(surgery: Pick<Surgery, "tipoCaso" | "diagnostico">): string {
  return surgery.tipoCaso || surgery.diagnostico || "Cirurgia de ombro/cotovelo";
}

/** Iniciais do paciente para exibição no convite (privacidade). */
export function patientInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + ".")
    .join("");
}
