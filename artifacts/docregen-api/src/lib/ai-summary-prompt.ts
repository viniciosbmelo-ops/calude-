/**
 * Prompt for the AI clinical summary (external provider).
 *
 * Minimization: the provider never receives direct identifiers — no name,
 * birth date, CPF, phone, e-mail, address, calendar dates or free text typed
 * by the clinician/patient (which may contain names). Only age in years, sex,
 * coded condition, comorbidity flags, products, relative days between
 * procedures, scores and lab values.
 */
import { regenConditionName } from "./regen-conditions";

export const AI_DAILY_LIMIT_DEFAULT = 20;

export function aiDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env["DOCREGEN_AI_DAILY_LIMIT"]);
  return Number.isInteger(value) && value > 0 ? value : AI_DAILY_LIMIT_DEFAULT;
}

/** Whole years between a birth date ("YYYY-MM-DD" or Date) and `on`. */
export function ageInYears(dob: unknown, on: Date = new Date()): number | null {
  const text = dob instanceof Date ? dob.toISOString().slice(0, 10) : typeof dob === "string" ? dob.slice(0, 10) : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = on.getUTCFullYear() - year;
  if (on.getUTCMonth() + 1 < month || (on.getUTCMonth() + 1 === month && on.getUTCDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function sexLabel(sex: unknown): string {
  return sex === "M" ? "masculino" : sex === "F" ? "feminino" : "não informado";
}

const CODE = /^[A-Za-z0-9_.\- ]{1,40}$/;
const code = (value: unknown): string | null => (typeof value === "string" && CODE.test(value) ? value : null);

type Row = Record<string, any>;

export function buildAiSummaryPrompt(input: {
  caso: Row;
  procedures: Row[];
  proms: Row[];
  labs: Row[];
  now?: Date;
}): string {
  const { caso, procedures, proms, labs } = input;
  const age = ageInYears(caso.patient_dob, input.now);

  // Relative timeline: days since the first procedure (no calendar dates).
  const times = procedures
    .map((p) => (p.performed_at ? new Date(p.performed_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const first = times.length ? Math.min(...times) : null;
  const dayOf = (value: unknown) => {
    const t = value ? new Date(value as string).getTime() : NaN;
    return first !== null && Number.isFinite(t) ? `dia ${Math.round((t - first) / 86_400_000)}` : "dia NI";
  };

  const procsText = procedures.map((p) =>
    `${dayOf(p.performed_at)}: ${code(p.product_code) ?? "produto"}${p.volume_ml ? ` ${Number(p.volume_ml)} mL` : ""}${p.adverse_event ? " [evento adverso registrado]" : ""}`,
  ).join("\n");
  const promsText = proms.map((p) =>
    `${code(p.instrument) ?? "escala"} (${code(p.timepoint) ?? "momento"}): escore ${p.score ?? "não informado"}`,
  ).join("\n");
  const labsText = labs.slice(0, 20).map((l) =>
    `${code(l.analyte) ?? "exame"}: ${l.value_num ?? "NI"} ${code(l.unit) ?? ""}${code(l.flag) ? ` [${l.flag}]` : ""}`,
  ).join("\n");
  const goals = Array.isArray(caso.goal_vev) ? caso.goal_vev.map(code).filter(Boolean).join(", ") : "";

  return `Você é um assistente clínico especializado em medicina regenerativa ortopédica.
Gere um resumo clínico narrativo em português brasileiro (2-4 parágrafos) sobre a evolução do paciente abaixo.
Seja objetivo, clínico, e destaque mudanças relevantes nos PROMs e na evolução clínica.
Finalize com uma conclusão sobre o status atual. Refira-se a "o(a) paciente", sem nomes.

DADOS DO CASO (sem identificadores diretos):
- Idade: ${age ?? "NI"} anos | Sexo: ${sexLabel(caso.patient_sex)}
- IMC: ${caso.imc ?? "NI"} | Condição: ${regenConditionName(caso.condition_code, "pt-BR")}
- Diabetes: ${caso.dm ? "Sim" + (caso.hba1c ? " (HbA1c " + caso.hba1c + "%)" : "") : "Não"} | Anticoagulante: ${caso.anticoagulant ? "Sim" : "Não"}
- Objetivos: ${goals || "não definidos"}

PROCEDIMENTOS (dias contados a partir do primeiro procedimento):
${procsText || "Nenhum registrado"}

PROMS (instrumentos de resultado):
${promsText || "Nenhum registrado"}

EXAMES LABORATORIAIS RELEVANTES:
${labsText || "Nenhum registrado"}

Gere apenas o texto clínico narrativo, sem títulos ou marcadores.`;
}
