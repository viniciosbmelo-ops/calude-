import type { Locale } from "@/lib/i18n";
import { SANE_KNEE_QUESTION } from "@workspace/clinical/knee-function";

export type RegenScaleQuestion = {
  id: string;
  label: string;
  type: "radio" | "slider";
  options?: { label: string; value: number }[];
  min?: number;
  max?: number;
  step?: number;
};

export type RegenScaleDef = {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  questions: RegenScaleQuestion[];
  calcScore: (answers: Record<string, number>) => number;
};

type LocalizedScale = Omit<RegenScaleDef, "calcScore">;
const slider = (id: string, label: string): RegenScaleQuestion => ({ id, label, type: "slider", min: 0, max: 10, step: 1 });
/** SANE-joelho: single question, integer 0–100 (answer id "sane", scored server-side). */
const saneSlider = (label: string): RegenScaleQuestion => ({ id: "sane", label, type: "slider", min: 0, max: 100, step: 1 });

/** Visible copy for the public regenerative questionnaire. IDs and values remain clinical payload identifiers. */
export const regenQuestionnaireMessages: Record<Locale, Record<string, LocalizedScale>> = {
  "pt-BR": {
    "VAS Dor": { id: "VAS Dor", title: "Escala de Dor (VAS)", description: "Avalie a dor na região tratada. Mova o controle deslizante para indicar o nível de dor.", maxScore: 10, questions: [slider("vas", "Como você avalia hoje a dor na região tratada? (0 = sem dor, 10 = pior dor imaginável)")] },
    "SANE Joelho": { id: "SANE Joelho", title: "Avaliação do joelho (SANE)", description: "Uma única pergunta sobre como está o seu joelho hoje. Mova o controle deslizante de 0 a 100.", maxScore: 100, questions: [saneSlider(SANE_KNEE_QUESTION["pt-BR"])] },
  },
  es: {
    "VAS Dor": { id: "VAS Dor", title: "Escala de dolor (VAS)", description: "Evalúe el dolor en la región tratada. Mueva el control deslizante para indicar el nivel de dolor.", maxScore: 10, questions: [slider("vas", "¿Cómo evalúa hoy el dolor en la región tratada? (0 = sin dolor, 10 = el peor dolor imaginable)")] },
    "SANE Joelho": { id: "SANE Joelho", title: "Evaluación de la rodilla (SANE)", description: "Una sola pregunta sobre cómo está su rodilla hoy. Mueva el control deslizante de 0 a 100.", maxScore: 100, questions: [saneSlider(SANE_KNEE_QUESTION.es)] },
  },
};

export function getRegenScales(locale: Locale): Record<string, RegenScaleDef> {
  const localized = regenQuestionnaireMessages[locale];
  return {
    "VAS Dor": { ...localized["VAS Dor"], calcScore: a => a.vas ?? 0 },
    "SANE Joelho": { ...localized["SANE Joelho"], calcScore: a => a.sane ?? 0 },
  };
}
