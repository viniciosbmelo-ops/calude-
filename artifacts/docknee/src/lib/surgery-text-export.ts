import type { BioReadyResult } from "./regen-bioready";
import { categorizeFollowupComplications } from "./followup-complications";
import type { Locale } from "@/lib/i18n";
import { surgeryTextExportCopy } from "@/locales/surgery-text-export";
import { reportCatalogLabel } from "@/locales/reporting-catalogs";
import { getKrirsDisplayJustification, getKrirsRiskLabel, getKrirsRiskLevel } from "./krirs-risk";
import { limbHeading, readBilateralDocumentation } from "./bilateral-surgery";
import { classifyPTS, getPTSClassificationLabel, getPTSClassificationRange } from "./pts-classification";

type RecordValue = Record<string, unknown>;

export type SurgeryTextExportOptions = {
  privacyMode?: boolean;
  bioReady?: BioReadyResult | null;
  locale?: Locale;
};

const TECHNICAL_KEYS = new Set([
  "id",
  "doctorId",
  "patientId",
  "surgeryId",
  "createdAt",
  "updatedAt",
  "rxImageUrl",
  "krirsScore",
]);

const SECTION_TITLES: Array<[string, string]> = [
  ["exameLigamentar", "Exame Físico Ligamentar"],
  ["examePatelar", "Avaliação Patelar"],
  ["exameOsteocondral", "Avaliação Osteocondral"],
  ["lcaAlgorithm", "Algoritmo Clínico — LCA"],
  ["aclLeapDecision", "Decisão Clínica — LEAP"],
  ["picsScore", "Algoritmo Clínico — PICS"],
  ["procedimentoMeniscal", "Procedimento Meniscal"],
  ["lcpReconstruction", "Reconstrução do LCP"],
  ["cpmReconstruction", "Reconstrução do Canto Póstero-Medial"],
  ["cplReconstruction", "Reconstrução do CPL"],
  ["patelarTendonRupture", "Ruptura do Tendão Patelar"],
  ["quadricepsTendonRupture", "Ruptura do Tendão do Quadríceps"],
  ["periprostheticFracture", "Fratura Periprotética"],
  ["distalFemurFracture", "Fratura do Fêmur Distal"],
  ["tibialPlateauFracture", "Fratura do Platô Tibial"],
  ["patellaFracture", "Fratura de Patela"],
  ["tibialSpineFracture", "Fratura da Espinha Tibial"],
  ["rxAnaliseJson", "Planejamento Radiográfico"],
  ["followups", "Acompanhamentos Pós-Operatórios"],
];

const FIELD_LABELS: Record<string, string> = {
  nome: "Nome",
  sexo: "Sexo",
  telefone: "Telefone",
  cpf: "CPF",
  dataNascimento: "Data de nascimento",
  lado: "Lado",
  dataCirurgia: "Data do procedimento",
  hospital: "Hospital / local",
  tipoCaso: "Tipo de caso",
  tiposProcedimento: "Procedimentos",
  ligamentosAcometidos: "Ligamentos acometidos",
  diagnostico: "Diagnóstico",
  alinhamento: "Alinhamento",
  grauAlinhamento: "Grau de alinhamento",
  procedimentoRealizado: "Procedimento realizado",
  procedimentosDetalhados: "Detalhes dos procedimentos",
  detalhesProcedimentos: "Detalhes dos procedimentos",
  exameLigamentar: "Exame físico ligamentar",
  examePatelar: "Avaliação patelar",
  exameOsteocondral: "Avaliação osteocondral",
  lcaAlgorithm: "Algoritmo clínico — LCA",
  aclLeapDecision: "Decisão clínica — LEAP",
  picsScore: "Algoritmo clínico — PICS",
  procedimentoMeniscal: "Procedimento meniscal",
  tecnicasSutura: "Técnicas de sutura",
  pontosPorTecnica: "Pontos por técnica",
  lcpReconstruction: "Reconstrução do LCP",
  cpmReconstruction: "Reconstrução do canto póstero-medial",
  cplReconstruction: "Reconstrução do CPL",
  rxAnaliseJson: "Planejamento radiográfico",
  followups: "Acompanhamentos pós-operatórios",
  observacoes: "Observações",
  jSign: "J Sign",
  jSignGrau: "Grau do J Sign",
  justificativa: "Justificativa",
  recomendacao: "Recomendação",
  conduta: "Conduta",
  score: "Score",
  eixoMecanico: "Eixo mecânico",
  classificacao: "Classificação",
  graus: "Graus",
  periodo: "Período",
  gradeLabel: "Classificação",
  dataCompleteness: "Completude dos dados",
  factors: "Fatores avaliados",
  topRecommendations: "Prioridades de otimização",
  resultado: "Resultado",
  entradasClinicasSalvas: "Entradas clínicas guardadas",
  resultadoSalvo: "Resultado guardado",
  leapIndicado: "Indicação LEAP",
  enxertoPlanejado: "Enxerto planejado",
  loaEnxerto: "Enxerto do LOA",
  loaFixacao: "Fixação femoral do LOA",
  hiperextensaoGraus: "Hiperextensão (graus)",
  revisao: "Revisão",
  esqueletoImaturo: "Esqueleto imaturo",
  lesaoCronica: "Lesão crônica",
  esportePivot: "Esporte de pivô",
  ptsGraus: "PTS (graus)",
  slopeTibialPts: "Slope Tibial Posterior (PTS)",
  contralateralLca: "História de LCA contralateral",
  tabagismo: "Tabagismo",
  atrasoCirurgicoDias: "Atraso cirúrgico (dias)",
  tunelComprometido: "Túnel comprometido",
  fatoresAcessoriosCount: "Quantidade de fatores acessórios",
  driversNaoModificaveis: "Fatores não modificáveis",
  fatoresAcessorios: "Fatores acessórios",
  camadaSeguranca: "Camada de segurança",
  execucaoTecnica: "Execução técnica",
  presente: "Presente",
  modulo: "Módulo",
  evidencia: "Evidência",
  titulo: "Título",
  alavanca: "Alavanca",
  forcaMaxima: "Força máxima",
  forca: "Força",
  naoCalibrado: "Não calibrado",
  populacao: "População",
  vies: "Viés",
};

const SPANISH_TEXT_VALUES: Record<string, Record<string, string>> = {
  forcaMaxima: {
    "Fortemente recomendado": "Fuertemente recomendado",
    Recomendado: "Recomendado",
    "Não recomendado": "No recomendado",
    "Fortemente não recomendado": "Fuertemente no recomendado",
    "Deve ser considerado": "Debe ser considerado",
    "Pode ser considerado": "Puede ser considerado",
  },
  forca: {
    "Fortemente recomendado": "Fuertemente recomendado",
    Recomendado: "Recomendado",
    "Não recomendado": "No recomendado",
    "Fortemente não recomendado": "Fuertemente no recomendado",
    "Deve ser considerado": "Debe ser considerado",
    "Pode ser considerado": "Puede ser considerado",
  },
  leapIndicado: {
    Sim: "Sí",
    Nao: "No",
    "Não": "No",
    Indicado: "Indicado",
    "Não indicado pelas regras atuais": "No indicado por las reglas actuales",
  },
  presente: { Sim: "Sí", Nao: "No", "Não": "No" },
  naoCalibrado: { "Não calibrado": "No calibrado" },
  populacao: { População: "Población" },
  vies: { Viés: "Sesgo" },
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.entries(value).some(
    ([key, nestedValue]) => !TECHNICAL_KEYS.has(key) && !key.startsWith("_") && isMeaningful(nestedValue),
  );
  return true;
}

function prettifyKey(key: string, locale: Locale): string {
  if (surgeryTextExportCopy[locale].fields[key]) return surgeryTextExportCopy[locale].fields[key];
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key
    .replace(/([a-zÀ-ÿ])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bpts\b/gi, "Pontos");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatDate(value: string, locale: Locale): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return locale === "es" ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale);
}

function formatPrimitive(value: string | number | boolean, key: string, locale: Locale): string {
  if (typeof value === "boolean") return value ? surgeryTextExportCopy[locale].yes : surgeryTextExportCopy[locale].no;
  if (typeof value === "string" && /(^data|data$|date$|at$)/i.test(key)) return formatDate(value, locale);
  if (typeof value === "string" && locale === "es" && SPANISH_TEXT_VALUES[key]?.[value]) {
    return SPANISH_TEXT_VALUES[key][value];
  }
  if (typeof value === "string") return reportCatalogLabel(locale, value);
  return String(value);
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function appendValue(lines: string[], value: unknown, key: string, locale: Locale, depth = 0): void {
  const indent = "  ".repeat(depth);
  const label = prettifyKey(key, locale);
  const normalized = typeof value === "string" ? parseJsonString(value) : value;

  if (!isMeaningful(normalized)) return;

  if ((key === "ptsGraus" || key === "slopeTibialPts") && typeof normalized === "number") {
    const ptsClassification = classifyPTS(normalized);
    lines.push(
      `${indent}${label}: ${normalized}°` +
      (ptsClassification
        ? ` — ${getPTSClassificationLabel(ptsClassification, locale)} (${getPTSClassificationRange(ptsClassification, locale)})`
        : ""),
    );
    return;
  }

  if (Array.isArray(normalized)) {
    const primitiveItems = normalized.every((item) => !isRecord(item) && !Array.isArray(item));
    if (primitiveItems) {
      if (key === "complicacoes" && normalized.every((item) => typeof item === "string")) {
        const categorized = categorizeFollowupComplications(normalized as string[]);
        if (categorized.agudas.length > 0 || categorized.tardias.length > 0) {
          lines.push(`${indent}${label}:`);
          if (categorized.agudas.length > 0) {
            lines.push(`${indent}  ${surgeryTextExportCopy[locale].acuteComplications}: ${categorized.agudas.map((value) => reportCatalogLabel(locale, value)).join("; ")}`);
          }
          if (categorized.tardias.length > 0) {
            lines.push(`${indent}  ${surgeryTextExportCopy[locale].lateComplications}: ${categorized.tardias.map((value) => reportCatalogLabel(locale, value)).join("; ")}`);
          }
          if (categorized.gerais.length > 0) {
            lines.push(`${indent}  ${surgeryTextExportCopy[locale].uncategorizedComplications}: ${categorized.gerais.map((value) => reportCatalogLabel(locale, value)).join("; ")}`);
          }
          return;
        }
      }
      lines.push(`${indent}${label}: ${normalized.map((item) => formatPrimitive(item as string | number | boolean, key, locale)).join("; ")}`);
      return;
    }

    lines.push(`${indent}${label}:`);
    normalized.forEach((item, index) => {
      if (isRecord(item) || Array.isArray(item)) {
        lines.push(`${indent}  ${index + 1}.`);
        appendRecord(lines, item, locale, depth + 2);
      } else {
        lines.push(`${indent}  ${index + 1}. ${formatPrimitive(item as string | number | boolean, key, locale)}`);
      }
    });
    return;
  }

  if (isRecord(normalized)) {
    lines.push(`${indent}${label}:`);
    appendRecord(lines, normalized, locale, depth + 1);
    return;
  }

  lines.push(`${indent}${label}: ${formatPrimitive(normalized as string | number | boolean, key, locale)}`);
}

function appendRecord(lines: string[], record: unknown, locale: Locale, depth = 0): void {
  if (!isRecord(record)) return;
  Object.entries(record).forEach(([key, value]) => {
    if (TECHNICAL_KEYS.has(key) || key.startsWith("_") || !isMeaningful(value)) return;
    appendValue(lines, value, key, locale, depth);
  });
}

function toInitials(nome: string | null | undefined): string {
  if (!nome) return "PACIENTE";
  return nome
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join(". ") + ".";
}

function exportBioReady(bioReady: BioReadyResult, locale: Locale): RecordValue {
  return {
    score: bioReady.score,
    classificacao: bioReady.gradeLabel,
    completudeDosDados: `${Math.round(bioReady.dataCompleteness * 100)}%`,
    dadosIncompletos: bioReady.isIncomplete,
    fatoresAvaliados: bioReady.factors.map((factor) => ({
      fator: factor.label,
      status: factor.status === "na" ? surgeryTextExportCopy[locale].notAssessed : factor.status,
      score: factor.status === "na" ? "—" : `${factor.score}/10`,
    })),
    prioridadesDeOtimizacao: bioReady.topRecommendations,
  };
}

function exportPatient(surgery: RecordValue, privacyMode: boolean): RecordValue {
  const patient = isRecord(surgery.patient) ? surgery.patient : {};
  const name = typeof patient.nome === "string" ? patient.nome : null;
  if (privacyMode) {
    return {
      nome: toInitials(name),
      sexo: patient.sexo,
      lado: patient.lado,
    };
  }

  return {
    ...patient,
    nome: name,
  };
}

function exportLcaAlgorithm(value: unknown, locale: Locale): unknown {
  if (!isRecord(value)) return value;
  const hasClassification = typeof value.krirsScore === "number" || typeof value.krirsInterpretacao === "string";
  if (!hasClassification) return value;
  const riskLevel = getKrirsRiskLevel(
    typeof value.krirsScore === "number" ? value.krirsScore : null,
    typeof value.flagAltoRisco === "boolean" ? value.flagAltoRisco : null,
    typeof value.krirsInterpretacao === "string" ? value.krirsInterpretacao : null,
  );
  const { krirsScore: _score, krirsInterpretacao: _interpretacao, justificativa, ...rest } = value;
  return {
    ...rest,
    classificacao: getKrirsRiskLabel(riskLevel, locale),
    ...(typeof justificativa === "string"
      ? { justificativa: getKrirsDisplayJustification(justificativa, riskLevel, locale) }
      : {}),
  };
}

function exportAclLeapDecision(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { resultado, ...inputs } = value;
  return {
    entradasClinicasSalvas: inputs,
    ...(resultado !== undefined ? { resultadoSalvo: resultado } : {}),
  };
}

function exportPatellarExam(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { jSignGrau, ...rest } = value;
  return value.jSign === true && jSignGrau != null
    ? { ...rest, jSignGrau }
    : rest;
}

function exportLimbSnapshot(value: unknown, locale: Locale): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      key === "aclLeapDecision"
        ? exportAclLeapDecision(nestedValue)
        : key === "lcaAlgorithm"
          ? exportLcaAlgorithm(nestedValue, locale)
          : key === "examePatelar"
            ? exportPatellarExam(nestedValue)
          : nestedValue,
    ]),
  );
}

export function buildSurgeryTextExport(
  surgery: RecordValue,
  { privacyMode = false, bioReady = null, locale = "pt-BR" }: SurgeryTextExportOptions = {},
): string {
  const copy = surgeryTextExportCopy[locale];
  const bilateral = surgery.lado === "Bilateral"
    ? readBilateralDocumentation(surgery.procedimentosDetalhados)
    : null;
  const patientName = typeof surgery.patient === "object" && surgery.patient && typeof (surgery.patient as RecordValue).nome === "string"
    ? (surgery.patient as RecordValue).nome as string
    : "PACIENTE";
  const visiblePatientName = privacyMode ? toInitials(patientName) : patientName;
  const lines = [
    copy.title,
    copy.subtitle,
    "",
    `${copy.patient}: ${visiblePatientName}`,
    `${copy.generatedAt}: ${new Date().toLocaleString(locale)}`,
    "",
  ];

  const nestedKeys = new Set(["patient", ...SECTION_TITLES.map(([key]) => key)]);
  let baseSurgery = Object.fromEntries(
    Object.entries(surgery).filter(([key, value]) => !nestedKeys.has(key) && !TECHNICAL_KEYS.has(key) && isMeaningful(value)),
  );
  if (bilateral) {
    // Side-owned fields are rendered only inside their knee section. This also
    // prevents the compatibility flat/right-side values from looking shared.
    baseSurgery = Object.fromEntries(
      Object.entries(baseSurgery).filter(([key]) => [
        "dataCirurgia", "hospital", "lado", "status",
      ].includes(key)),
    );
  }

  const sections: Array<[string, unknown]> = [
    [copy.patientIdentification, exportPatient(surgery, privacyMode)],
    [copy.procedureData, baseSurgery],
    ...(bilateral
      ? ([
          ...(["direito", "esquerdo"] as const).map((limb) => [
            limbHeading(limb, locale),
            exportLimbSnapshot(bilateral.byLimb[limb], locale),
          ] as [string, unknown]),
          [copy.sections.followups ?? "Acompanhamentos Pós-Operatórios", surgery.followups],
        ] as Array<[string, unknown]>)
      : SECTION_TITLES.map(([key, title]) => [
          copy.sections[key] ?? title,
          key === "lcaAlgorithm"
            ? exportLcaAlgorithm(surgery[key], locale)
            : key === "aclLeapDecision"
              ? exportAclLeapDecision(surgery[key])
              : key === "examePatelar"
                ? exportPatellarExam(surgery[key])
              : surgery[key],
        ] as [string, unknown]) as Array<[string, unknown]>),
    ...(bioReady ? [[copy.sections.bioReady, exportBioReady(bioReady, locale)] as [string, unknown]] : []),
  ];

  sections.forEach(([title, data]) => {
    const normalized = typeof data === "string" ? parseJsonString(data) : data;
    if (!isMeaningful(normalized)) return;
    lines.push("=".repeat(72));
    lines.push(title.toUpperCase());
    lines.push("-".repeat(72));
    if (isRecord(normalized)) {
      appendRecord(lines, normalized, locale);
    } else {
      appendValue(lines, normalized, "registros", locale);
    }
    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

function sanitizeFilePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase() || "PACIENTE";
}

export function getSurgeryTextFilename(surgery: RecordValue, privacyMode = false): string {
  const patientName = isRecord(surgery.patient) && typeof surgery.patient.nome === "string"
    ? surgery.patient.nome
    : "PACIENTE";
  const dateRaw = typeof surgery.dataCirurgia === "string" && surgery.dataCirurgia
    ? surgery.dataCirurgia.slice(0, 10)
    : "SEM-DATA";
  const date = dateRaw.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "SEM-DATA";
  const identifier = typeof surgery.id === "number" || typeof surgery.id === "string"
    ? `-${sanitizeFilePart(String(surgery.id))}`
    : "";
  const namePart = privacyMode ? "PACIENTE" : sanitizeFilePart(patientName);

  return `PROCEDIMENTO-${namePart}-${date}${identifier}.txt`;
}

function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export async function downloadSurgeryText(text: string, filename: string): Promise<"downloaded" | "shared"> {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const file = new File([blob], filename, { type: blob.type });
  const canShareFiles = typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] });

  if (isIOS() && canShareFiles) {
    await navigator.share({ title: "Resumo do procedimento", files: [file] });
    return "shared";
  }

  const url = URL.createObjectURL(blob);
  let link: HTMLAnchorElement | null = null;
  try {
    link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
  } finally {
    link?.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return "downloaded";
}

/**
 * Clipboard writes intentionally happen in the caller's click handler. A
 * rejected write is surfaced so mobile browsers can offer native selection
 * instead of silently losing the copy action.
 */
export async function copySurgeryText(text: string): Promise<void> {
  if (typeof navigator === "undefined"
    || !navigator.clipboard
    || typeof navigator.clipboard.writeText !== "function") {
    throw new Error("CLIPBOARD_UNAVAILABLE");
  }
  await navigator.clipboard.writeText(text);
}

export function selectSurgeryText(textarea: HTMLTextAreaElement | null): boolean {
  if (!textarea) return false;
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  return true;
}
