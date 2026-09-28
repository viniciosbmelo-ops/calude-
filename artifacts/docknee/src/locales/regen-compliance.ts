import type { Locale } from "@/lib/i18n";
import type { ComplianceFlag } from "@/lib/regen-compliance";

const COMPLIANCE_ES: Record<string, (message: string) => string> = {
  HS01: () => "Infección activa — procedimiento contraindicado. Trate la infección antes de continuar.",
  HS02: () => "Neoplasia activa — el uso de ortobiológicos con potencial proliferativo está contraindicado.",
  HS03: (source) => {
    const hba1c = source.match(/HbA1c ([\d.,]+)%/)?.[1];
    return hba1c
      ? `Diabetes con HbA1c ${hba1c}% > 7,5% — el control glucémico subóptimo reduce la eficacia biológica. Optimícelo antes del procedimiento.`
      : source;
  },
  HS04: () => "Paciente en tratamiento anticoagulante — evalúe cuidadosamente la suspensión previa (washout). Confírmelo con el equipo tratante.",
  HS05: () => "Inmunosupresión activa — posible reducción de la respuesta biológica; vigile la cicatrización y los signos de infección.",
  HS06: (source) => {
    const imc = source.match(/IMC ([\d.,]+) kg\/m²/)?.[1];
    return imc
      ? `IMC ${imc} kg/m² — obesidad grado III; eficacia reducida y mayor riesgo de complicaciones técnicas.`
      : source;
  },
  LB01: (source) => {
    const platelets = source.match(/Contagem plaquetária ([\d.,]+) ×/)?.[1];
    return platelets
      ? `Recuento plaquetario ${platelets} × 10³/µL < 150 — se espera una menor potencia biológica del concentrado plaquetario.`
      : source;
  },
  LB02: (source) => {
    const count = source.match(/^(\d+) analito/)?.[1];
    return count
      ? `${count} analito(s) de laboratorio fuera del intervalo de referencia — revíselos antes de continuar con el procedimiento.`
      : source;
  },
  WN01: () => "Paciente pediátrico (< 18 años) — evidencia limitada; documente la justificación clínica y obtenga el consentimiento de los responsables.",
  WN02: () => "Evento adverso registrado — notifíquelo a la autoridad sanitaria cuando corresponda y documente la evolución.",
  WN03: (source) => {
    const imc = source.match(/IMC ([\d.,]+) kg\/m²/)?.[1];
    return imc
      ? `IMC ${imc} kg/m² — sobrepeso/obesidad; considere optimizar el peso para maximizar la respuesta terapéutica.`
      : source;
  },
};

/** Localizes only known compliance copy; the original message is the safe fallback. */
export function complianceFlagText(locale: Locale, flag: ComplianceFlag): string {
  if (locale !== "es") return flag.message;
  return COMPLIANCE_ES[flag.code]?.(flag.message) ?? flag.message;
}