import type { ScopedMessages } from "@/lib/i18n";

/**
 * Clinician-side copy for the region SANE (single question 0–100). Region
 * labels and the patient question itself come from
 * @workspace/clinical/region-sane (Spanish: our own translation).
 */
export const regenSaneMessages = {
  "pt-BR": {
    vas: "VAS (dor)",
    recommendedTitle: "Medidas recomendadas para esta condição",
    recommendedProms: "PROMs (paciente)",
    recommendedNote: "Link de acompanhamento pergunta VAS + {label} (pergunta única 0–100, maior é melhor) — não bloqueia outros registros.",
    saneIntegerError: "{label}: informe um inteiro de 0 a 100.",
    spineNote: "O SANE tem validação limitada para a coluna (estudado principalmente em ombro, joelho e quadril). Interprete com cautela.",
  },
  es: {
    vas: "EVA (dolor)",
    recommendedTitle: "Medidas recomendadas para esta condición",
    recommendedProms: "PROM (paciente)",
    recommendedNote: "El enlace de seguimiento pregunta EVA + {label} (pregunta única 0–100, mayor es mejor) — no bloquea otros registros.",
    saneIntegerError: "{label}: introduzca un entero de 0 a 100.",
    spineNote: "El SANE tiene validación limitada para la columna (estudiado principalmente en hombro, rodilla y cadera). Interprete con cautela.",
  },
} as const satisfies ScopedMessages<Record<string, string>>;
