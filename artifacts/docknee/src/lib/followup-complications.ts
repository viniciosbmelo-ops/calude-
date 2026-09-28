export type FractureComplicationCategory = "aguda" | "tardia";

const FRACTURE_ACUTE_PREFIX = "[Fratura][Aguda] ";
const FRACTURE_LATE_PREFIX = "[Fratura][Tardia] ";

export const FRACTURE_ACUTE_COMPLICATION_OPTIONS = [
  "Infecção superficial",
  "Infecção profunda",
  "Infecção",
  "TVP/TEP",
  "Lesão nervosa",
  "Lesão vascular",
  "Síndrome compartimental",
  "Falha de fixação",
  "Falha de implante",
  "Hematoma",
  "Deiscência",
  "Ruptura do mecanismo extensor",
  "Irritação do fio de aço",
  "Óbito",
];

export const FRACTURE_LATE_COMPLICATION_OPTIONS = [
  "Pseudartrose",
  "Pseudoartrose",
  "Atraso de consolidação",
  "Consolidação viciosa",
  "Soltura asséptica",
  "Infecção crônica",
  "Rigidez articular",
  "Perda de arco de movimento",
  "Instabilidade protética",
  "Instabilidade patelar",
  "Fratura periimplante recorrente",
  "Artrose pós-traumática",
  "Artrose patelofemoral",
  "Falha de material de síntese",
  "Dor refratária",
  "Reoperação (retirada de implante)",
  "Óbito",
];

export function encodeFractureComplication(
  category: FractureComplicationCategory,
  value: string,
): string {
  const normalized = value.trim();
  return `${category === "aguda" ? FRACTURE_ACUTE_PREFIX : FRACTURE_LATE_PREFIX}${normalized}`;
}

export function parseFollowupComplication(value: string): {
  category: FractureComplicationCategory | "geral";
  label: string;
} {
  if (value.startsWith(FRACTURE_ACUTE_PREFIX)) {
    return { category: "aguda", label: value.slice(FRACTURE_ACUTE_PREFIX.length).trim() };
  }
  if (value.startsWith(FRACTURE_LATE_PREFIX)) {
    return { category: "tardia", label: value.slice(FRACTURE_LATE_PREFIX.length).trim() };
  }
  return { category: "geral", label: value.trim() };
}

export function categorizeFollowupComplications(values: string[] | null | undefined): {
  agudas: string[];
  tardias: string[];
  gerais: string[];
} {
  const result = { agudas: [] as string[], tardias: [] as string[], gerais: [] as string[] };
  for (const value of values ?? []) {
    const parsed = parseFollowupComplication(value);
    if (!parsed.label) continue;
    if (parsed.category === "aguda") result.agudas.push(parsed.label);
    else if (parsed.category === "tardia") result.tardias.push(parsed.label);
    else result.gerais.push(parsed.label);
  }
  return result;
}

export function splitComplicationText(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}