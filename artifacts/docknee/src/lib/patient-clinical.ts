/**
 * Perfil clínico do paciente no cadastro (prontuário): lado dominante, tabagismo, diabetes e nível de atividade.
 * Registrado uma vez no paciente (não em cada cirurgia). Sem React, para teste unitário.
 * Os valores gravados são os enums do núcleo clínico (@workspace/clinical/web, patient/profile.ts).
 */
import {
  LADO_DOMINANTE_VALORES, NIVEL_ATIVIDADE_VALORES, TABAGISMO_VALORES, perfilClinicoDe,
  type LadoDominante, type NivelAtividade, type PerfilClinicoPaciente, type Tabagismo,
} from "@workspace/clinical/web";

/** Estado do formulário: string vazia = não informado. Diabetes usa "sim"/"nao" no seletor. */
export interface PatientClinicalForm {
  ladoDominante: "" | LadoDominante;
  tabagismo: "" | Tabagismo;
  diabetes: "" | "sim" | "nao";
  nivelAtividade: "" | NivelAtividade;
}

export type PatientClinicalField = keyof PatientClinicalForm;

export const PATIENT_CLINICAL_FIELDS: readonly PatientClinicalField[] = ["ladoDominante", "tabagismo", "diabetes", "nivelAtividade"];

export const PATIENT_CLINICAL_OPTIONS: { [K in PatientClinicalField]: readonly Exclude<PatientClinicalForm[K], "">[] } = {
  ladoDominante: LADO_DOMINANTE_VALORES,
  tabagismo: TABAGISMO_VALORES,
  diabetes: ["sim", "nao"],
  nivelAtividade: NIVEL_ATIVIDADE_VALORES,
};

/** Chaves de tradução (operationalPatientRecordMessages) do rótulo de cada campo e de cada valor. */
export const PATIENT_CLINICAL_LABEL_KEYS = {
  ladoDominante: "dominantSide",
  tabagismo: "smoking",
  diabetes: "diabetes",
  nivelAtividade: "activityLevel",
} as const satisfies Record<PatientClinicalField, string>;

export const PATIENT_CLINICAL_VALUE_KEYS = {
  ladoDominante: { R: "dominantRight", L: "dominantLeft", ambidestro: "dominantAmbidextrous" },
  tabagismo: { nunca: "smokingNever", ex_tabagista: "smokingFormer", atual: "smokingCurrent" },
  diabetes: { sim: "yes", nao: "no" },
  nivelAtividade: { sedentario: "activitySedentary", recreativo: "activityRecreational", competitivo: "activityCompetitive", trabalhador_bracal: "activityManualWorker" },
} as const;

export const emptyPatientClinicalForm = (): PatientClinicalForm => ({ ladoDominante: "", tabagismo: "", diabetes: "", nivelAtividade: "" });

/** Estado do formulário a partir do paciente da API. Valores fora do enum (texto legado) ficam vazios. */
export function patientClinicalFormFrom(patient: unknown): PatientClinicalForm {
  const p = perfilClinicoDe(patient);
  return {
    ladoDominante: p.ladoDominante ?? "",
    tabagismo: p.tabagismo ?? "",
    diabetes: p.diabetes === true ? "sim" : p.diabetes === false ? "nao" : "",
    nivelAtividade: p.nivelAtividade ?? "",
  };
}

const diabetesDe = (v: PatientClinicalForm["diabetes"]): boolean | null => (v === "sim" ? true : v === "nao" ? false : null);

/** Corpo de criação: só os campos informados (vazio não é enviado). */
export function patientClinicalCreateBody(form: PatientClinicalForm): PerfilClinicoPaciente {
  const out: PerfilClinicoPaciente = {};
  if (form.ladoDominante) out.ladoDominante = form.ladoDominante;
  if (form.tabagismo) out.tabagismo = form.tabagismo;
  const d = diabetesDe(form.diabetes);
  if (d !== null) out.diabetes = d;
  if (form.nivelAtividade) out.nivelAtividade = form.nivelAtividade;
  return out;
}

/** Corpo de edição: todos os campos; vazio vira null para limpar o valor gravado. */
export function patientClinicalUpdateBody(form: PatientClinicalForm): Required<{ [K in keyof PerfilClinicoPaciente]: PerfilClinicoPaciente[K] }> {
  return {
    ladoDominante: form.ladoDominante || null,
    tabagismo: form.tabagismo || null,
    diabetes: diabetesDe(form.diabetes),
    nivelAtividade: form.nivelAtividade || null,
  };
}

export interface PatientClinicalDisplayItem {
  field: PatientClinicalField;
  /** Chave de tradução do rótulo do campo */
  labelKey: string;
  /** Chave de tradução do valor; null quando não informado */
  valueKey: string | null;
}

/** Itens para exibição somente leitura (prontuário e formulário da cirurgia), na ordem fixa dos campos. */
export function patientClinicalDisplay(patient: unknown): PatientClinicalDisplayItem[] {
  const form = patientClinicalFormFrom(patient);
  return PATIENT_CLINICAL_FIELDS.map((field) => {
    const v = form[field];
    const keys = PATIENT_CLINICAL_VALUE_KEYS[field] as Record<string, string>;
    return { field, labelKey: PATIENT_CLINICAL_LABEL_KEYS[field], valueKey: v ? keys[v] : null };
  });
}

/** Algum dos quatro campos informado. */
export function hasPatientClinicalData(patient: unknown): boolean {
  return Object.keys(perfilClinicoDe(patient)).length > 0;
}

/** Link para editar o cadastro do paciente (abre o modal de edição do prontuário). */
export function patientEditHref(patientId: number): string {
  return `/patients/${patientId}?edit=1`;
}

/** O prontuário deve abrir já no modal de edição (link vindo do formulário da cirurgia). */
export function shouldOpenPatientEdit(search: string): boolean {
  return new URLSearchParams(search).get("edit") === "1";
}
