import { clinicTodayDateOnly } from "@/lib/utils";
import jsPDF from "jspdf";
import type { Locale } from "./i18n";
import { documentDate, documentText } from "@/locales/document-locales";
import { CASE_TYPE_BY_KEY } from "@workspace/clinical/web";

export type SurgicalConsentDoctor = {
  nome?: string | null;
  crm?: string | number | null;
  crmEstado?: string | null;
  especialidade?: string | null;
};

export type SurgicalConsentSurgery = {
  id?: number | string;
  dataCirurgia?: string | null;
  hospital?: string | null;
  lado?: string | null;
  tipoCaso?: string | null;
  diagnostico?: string | null;
  tiposProcedimento?: string[] | null;
  procedimentoRealizado?: string | null;
  patient?: {
    nome?: string | null;
    cpf?: string | null;
    dataNascimento?: string | null;
    sexo?: string | null;
    lado?: string | null;
  } | null;
};

type ConsentFamily =
  | "fratura"
  | "tendao"
  | "ortobiologico"
  | "outros";

type ConsentSection = {
  family: ConsentFamily;
  title: string;
  explanation: string;
  risks: string[];
};

export type SurgicalConsentDocument = {
  procedureLabel: string;
  families: ConsentFamily[];
  sections: ConsentSection[];
  patientName: string;
  patientCpf: string;
  birthDate: string;
  laterality: string;
  diagnosis: string;
  procedureDate: string;
  doctorName: string;
  doctorCrm: string;
};

const FAMILY_ORDER: ConsentFamily[] = [
  "fratura",
  "tendao",
  "ortobiologico",
  "outros",
];

const FAMILY_SECTIONS_PT: Record<ConsentFamily, Omit<ConsentSection, "family">> = {
  fratura: {
    title: "Tratamento cirúrgico de fratura",
    explanation:
      "O objetivo é reduzir e estabilizar a fratura para favorecer consolidação e recuperação funcional. Poderão ser utilizados placas, parafusos, hastes, fios, enxerto ósseo, fixadores ou outros métodos de estabilização, conforme o padrão da fratura e as condições encontradas.",
    risks: [
      "atraso de consolidação, pseudoartrose, consolidação viciosa, falha de implantes ou necessidade de reoperação",
      "infecção, sangramento, trombose, lesão de nervos ou vasos e síndrome dolorosa regional complexa",
      "rigidez, dor persistente, alterações de alinhamento, discrepância funcional ou artrose pós-traumática",
      "necessidade de imobilização, restrição de carga, fisioterapia e tratamentos complementares",
    ],
  },
  tendao: {
    title: "Reparo ou reconstrução tendínea",
    explanation:
      "O procedimento busca reparar ou reconstruir o tendão lesionado, podendo incluir suturas, âncoras, enxertos, reforços ou outros materiais. A estratégia final dependerá da qualidade do tecido e da extensão da lesão.",
    risks: [
      "nova ruptura, alongamento, perda de força ou déficit funcional",
      "rigidez, aderências, dor persistente, alteração de sensibilidade ou necessidade de revisão",
      "infecção, sangramento, trombose ou lesão de nervos e vasos",
      "necessidade de imobilização, limitação de carga e reabilitação progressiva",
    ],
  },
  ortobiologico: {
    title: "Uso de recursos ortobiológicos",
    explanation:
      "Recursos ortobiológicos podem ser usados como complemento ao tratamento, conforme a indicação registrada e a avaliação intraoperatória. O benefício esperado, as alternativas e as limitações do recurso foram discutidos de forma individualizada.",
    risks: [
      "ausência de resposta clínica ou necessidade de tratamento complementar",
      "dor, edema, reação local, sangramento ou infecção relacionada à coleta, preparo ou aplicação",
      "necessidade de ajuste do plano terapêutico conforme evolução clínica",
    ],
  },
  outros: {
    title: "Outros procedimentos de ombro e cotovelo",
    explanation:
      "Foram explicados os objetivos, as etapas previsíveis e as alternativas dos procedimentos adicionais descritos neste termo. A conduta poderá ser modificada de modo tecnicamente necessário para tratar achados relevantes durante a cirurgia.",
    risks: [
      "persistência de sintomas, limitação funcional ou necessidade de tratamento adicional",
      "infecção, sangramento, hematoma, trombose, rigidez e dor prolongada",
      "lesão de nervos, vasos ou outras estruturas, além de necessidade de reoperação em situações selecionadas",
    ],
  },
};

const FAMILY_SECTIONS_ES: Record<ConsentFamily, Omit<ConsentSection, "family">> = {
  fratura: { title: "Tratamiento quirúrgico de fractura", explanation: "El objetivo es reducir y estabilizar la fractura para favorecer la consolidación y recuperación funcional. Podrán utilizarse placas, tornillos, clavos, alambres, injerto óseo, fijadores u otros métodos de estabilización, según el patrón de la fractura y las condiciones encontradas.", risks: ["retraso de consolidación, seudoartrosis, consolidación viciosa, falla de implantes o necesidad de reoperación", "infección, sangrado, trombosis, lesión de nervios o vasos y síndrome doloroso regional complejo", "rigidez, dolor persistente, alteraciones de alineación, discrepancia funcional o artrosis postraumática", "necesidad de inmovilización, restricción de carga, fisioterapia y tratamientos complementarios"] },
  tendao: { title: "Reparación o reconstrucción tendinosa", explanation: "El procedimiento busca reparar o reconstruir el tendón lesionado, pudiendo incluir suturas, anclajes, injertos, refuerzos u otros materiales. La estrategia final dependerá de la calidad del tejido y de la extensión de la lesión.", risks: ["nueva ruptura, elongación, pérdida de fuerza o déficit funcional", "rigidez, adherencias, dolor persistente, alteración de sensibilidad o necesidad de revisión", "infección, sangrado, trombosis o lesión de nervios y vasos", "necesidad de inmovilización, limitación de carga y rehabilitación progresiva"] },
  ortobiologico: { title: "Uso de recursos ortobiológicos", explanation: "Los recursos ortobiológicos pueden utilizarse como complemento del tratamiento, según la indicación registrada y la evaluación intraoperatoria. El beneficio esperado, alternativas y limitaciones del recurso fueron discutidos individualmente.", risks: ["ausencia de respuesta clínica o necesidad de tratamiento complementario", "dolor, edema, reacción local, sangrado o infección relacionada con la extracción, preparación o aplicación", "necesidad de ajustar el plan terapéutico según la evolución clínica"] },
  outros: { title: "Otros procedimientos de hombro y codo", explanation: "Se explicaron los objetivos, etapas previsibles y alternativas de los procedimientos adicionales descritos en este consentimiento. La conducta podrá modificarse de manera técnicamente necesaria para tratar hallazgos relevantes durante la cirugía.", risks: ["persistencia de síntomas, limitación funcional o necesidad de tratamiento adicional", "infección, sangrado, hematoma, trombosis, rigidez y dolor prolongado", "lesión de nervios, vasos u otras estructuras, además de necesidad de reoperación en situaciones seleccionadas"] },
};

function safeText(value: unknown, fallback = "Não informado"): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function formatDate(value: unknown, locale: Locale = "pt-BR"): string {
  if (typeof value !== "string" || !value.trim()) return documentText(locale, "notInformed");
  const iso = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return safeText(value);
  return documentDate(locale, parsed, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function cleanPdfText(value: string): string {
  return value
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

function selectedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

// Procedimentos: os nomes registrados no procedimento; na falta deles, o tipo de caso.
function collectProcedureLabels(surgery: SurgicalConsentSurgery): string[] {
  const performed = (surgery.procedimentoRealizado ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (performed.length) return unique(performed);
  return unique(selectedStrings(surgery.tiposProcedimento).map((key) => CASE_TYPE_BY_KEY.get(key)?.label ?? key));
}

const TENDON_CASE_TYPES = new Set(["SH_CUFF", "SH_BICEPS_SLAP", "SH_OTHER_TENDON", "EL_DISTAL_BICEPS", "EL_NERVE_TENDON"]);

function getFamilies(surgery: SurgicalConsentSurgery): ConsentFamily[] {
  const types = selectedStrings(surgery.tiposProcedimento);
  const detected = new Set<ConsentFamily>();
  if (types.some((type) => type.endsWith("_FRACTURE"))) detected.add("fratura");
  if (types.some((type) => TENDON_CASE_TYPES.has(type))) detected.add("tendao");
  if (types.some((type) => type.endsWith("_ORTHOBIO"))) detected.add("ortobiologico");
  if (types.some((type) => !type.endsWith("_FRACTURE") && !TENDON_CASE_TYPES.has(type) && !type.endsWith("_ORTHOBIO"))) detected.add("outros");
  if (!detected.size) detected.add("outros");
  return FAMILY_ORDER.filter((family) => detected.has(family));
}

export function buildSurgicalConsentDocument(
  surgery: SurgicalConsentSurgery,
  doctor?: SurgicalConsentDoctor | null,
  locale: Locale = "pt-BR",
): SurgicalConsentDocument {
  const procedureLabels = collectProcedureLabels(surgery);
  const families = getFamilies(surgery);
  const doctorCrmParts = [doctor?.crmEstado, doctor?.crm].filter(Boolean);
  const familySections = locale === "es" ? FAMILY_SECTIONS_ES : FAMILY_SECTIONS_PT;

  return {
    procedureLabel: procedureLabels.join("; ") || (locale === "es" ? "Procedimiento quirúrgico" : "Procedimento cirúrgico"),
    families,
    sections: families.map((family) => ({ family, ...familySections[family] })),
    patientName: safeText(surgery.patient?.nome, documentText(locale, "notInformed")),
    patientCpf: safeText(surgery.patient?.cpf, documentText(locale, "notInformed")),
    birthDate: formatDate(surgery.patient?.dataNascimento, locale),
    laterality: safeText(surgery.lado ?? surgery.patient?.lado, documentText(locale, "notInformed")),
    diagnosis: safeText(surgery.diagnostico, documentText(locale, "notInformed")),
    procedureDate: formatDate(surgery.dataCirurgia, locale),
    doctorName: safeText(doctor?.nome, documentText(locale, "notInformed")),
    doctorCrm: doctorCrmParts.length ? `CRM ${doctorCrmParts.join("/")}` : `CRM ${documentText(locale, "notInformed").toLowerCase()}`,
  };
}

async function generateSurgicalConsentPDFLegacy(
  surgery: SurgicalConsentSurgery,
  doctor?: SurgicalConsentDoctor | null,
  locale: Locale = "pt-BR",
): Promise<{ doc: jsPDF; filename: string }> {
  const content = buildSurgicalConsentDocument(surgery, doctor, locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const width = 210;
  const margin = 16;
  const contentWidth = width - margin * 2;
  const bottom = 278;
  let y = 18;

  const setColor = (color: [number, number, number]) => doc.setTextColor(...color);
  const ensureSpace = (needed: number) => {
    if (y + needed <= bottom) return;
    doc.addPage();
    y = 18;
  };
  const paragraph = (text: string, size = 9.2, leading = 4.25) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    setColor([30, 41, 59]);
    const lines = doc.splitTextToSize(cleanPdfText(text), contentWidth);
    ensureSpace(lines.length * leading + 2);
    doc.text(lines, margin, y);
    y += lines.length * leading + 2;
  };
  const heading = (text: string) => {
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setColor([15, 23, 42]);
    doc.text(cleanPdfText(text), margin, y);
    y += 2.5;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(margin, y, width - margin, y);
    y += 5.5;
  };
  const bulletList = (items: string[]) => {
    items.forEach((item) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor([30, 41, 59]);
      const lines = doc.splitTextToSize(cleanPdfText(item), contentWidth - 6);
      ensureSpace(lines.length * 4 + 1);
      doc.setFillColor(71, 85, 105);
      doc.circle(margin + 1.2, y - 1.05, 0.65, "F");
      doc.text(lines, margin + 4, y);
      y += lines.length * 4 + 1;
    });
    y += 1;
  };
  const infoCell = (label: string, value: string, x: number, yValue: number, cellWidth: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setColor([100, 116, 139]);
    doc.text(cleanPdfText(label.toUpperCase()), x, yValue);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setColor([15, 23, 42]);
    const lines = doc.splitTextToSize(cleanPdfText(value), cellWidth - 4);
    doc.text(lines, x, yValue + 4);
    return Math.max(10, lines.length * 3.8 + 5.5);
  };
  const infoGrid = (pairs: Array<[string, string]>) => {
    const columnGap = 6;
    const cellWidth = (contentWidth - columnGap) / 2;
    for (let index = 0; index < pairs.length; index += 2) {
      ensureSpace(18);
      const rowY = y;
      const leftHeight = infoCell(pairs[index][0], pairs[index][1], margin, rowY, cellWidth);
      const right = pairs[index + 1];
      const rightHeight = right ? infoCell(right[0], right[1], margin + cellWidth + columnGap, rowY, cellWidth) : 0;
      y += Math.max(leftHeight, rightHeight) + 1;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  setColor([15, 23, 42]);
  doc.text(documentText(locale, "consentTitle"), width / 2, y, { align: "center" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setColor([71, 85, 105]);
  doc.text(documentText(locale, "consentSubtitle"), width / 2, y, { align: "center" });
  y += 5;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.35);
  doc.line(margin, y, width - margin, y);
  y += 7;

  heading(`1. ${documentText(locale, "identification")}`);
  infoGrid([
    [documentText(locale, "patient"), content.patientName],
    ["CPF", content.patientCpf],
    [documentText(locale, "birthDate"), content.birthDate],
    [documentText(locale, "laterality"), content.laterality],
    [documentText(locale, "diagnosis"), content.diagnosis],
    [documentText(locale, "expectedDate"), content.procedureDate],
    [documentText(locale, "procedures"), content.procedureLabel],
    [documentText(locale, "hospital"), safeText(surgery.hospital, documentText(locale, "notInformed"))],
    [documentText(locale, "responsibleDoctor"), content.doctorName],
    [documentText(locale, "professionalRegistration"), content.doctorCrm],
  ]);

  heading(documentText(locale, "generalClarifications"));
  paragraph(
    documentText(locale, "legacyGeneralOne", { doctor: content.doctorName, procedure: content.procedureLabel }),
  );
  paragraph(
    documentText(locale, "legacyGeneralTwo"),
  );

  content.sections.forEach((section, index) => {
    heading(`${index + 3}. ${section.title}`);
    paragraph(section.explanation);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setColor([15, 23, 42]);
    ensureSpace(6);
    doc.text(documentText(locale, "specificRisks"), margin, y);
    y += 4.5;
    bulletList(section.risks);
  });

  heading(`${content.sections.length + 3}. ${documentText(locale, "commonRisksHeading")}`);
  paragraph(
    documentText(locale, "legacyCommonOne"),
  );
  paragraph(
    documentText(locale, "legacyCommonTwo"),
  );

  heading(`${content.sections.length + 4}. ${documentText(locale, "consentDeclarationHeading")}`);
  paragraph(
    documentText(locale, "legacyDeclarationOne"),
  );
  paragraph(
    documentText(locale, "legacyDeclarationTwo"),
  );

  ensureSpace(55);
  const signatureY = y + 14;
  doc.setDrawColor(71, 85, 105);
  doc.setLineWidth(0.25);
  doc.line(margin, signatureY, margin + 78, signatureY);
  doc.line(width - margin - 78, signatureY, width - margin, signatureY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor([51, 65, 85]);
  doc.text(documentText(locale, "patientOrLegalRepresentative"), margin + 39, signatureY + 4, { align: "center" });
  doc.text(documentText(locale, "responsibleDoctor"), width - margin - 39, signatureY + 4, { align: "center" });
  doc.line(margin, signatureY + 25, margin + 78, signatureY + 25);
  doc.line(width - margin - 78, signatureY + 25, width - margin, signatureY + 25);
  doc.text(`${documentText(locale, "witness")} 1`, margin + 39, signatureY + 29, { align: "center" });
  doc.text(`${documentText(locale, "witness")} 2`, width - margin - 39, signatureY + 29, { align: "center" });
  y = signatureY + 38;
  doc.setFontSize(8);
  doc.text(`${documentText(locale, "placeAndDate")}: ________________________________________________`, margin, y);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.3);
    setColor([100, 116, 139]);
    doc.text(documentText(locale, "consentTitle"), margin, 290);
    doc.text(documentText(locale, "page", { current: page, total: pageCount }), width - margin, 290, { align: "right" });
  }

  const safeName = content.patientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "paciente";

  return {
    doc,
    filename: `termo_consentimento_${safeName}_${clinicTodayDateOnly()}.pdf`,
  };
}

/**
 * Renderização compacta, deliberadamente limitada a uma página A4.
 *
 * O cabeçalho e a identificação ocupam uma faixa horizontal. Os textos
 * específicos são distribuídos em duas colunas para que uma cirurgia
 * combinada continue cabendo na mesma página sem remover suas famílias de
 * risco.
 */
export async function generateSurgicalConsentPDF(
  surgery: SurgicalConsentSurgery,
  doctor?: SurgicalConsentDoctor | null,
  locale: Locale = "pt-BR",
): Promise<{ doc: jsPDF; filename: string }> {
  const content = buildSurgicalConsentDocument(surgery, doctor, locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const width = 210;
  const margin = 14;
  const contentWidth = width - margin * 2;
  const gutter = 5;
  const columnWidth = (contentWidth - gutter) / 2;
  const footerY = 290;
  const dense = content.sections.length > 5;
  const bodySize = dense ? 6.2 : 6.8;
  const bodyLeading = dense ? 2.7 : 3;
  let y = 13;

  const setColor = (color: [number, number, number]) => doc.setTextColor(...color);
  const wrap = (text: string, x: number, availableWidth: number, size: number, leading: number, startY = y) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    setColor([30, 41, 59]);
    const lines = doc.splitTextToSize(cleanPdfText(text), availableWidth);
    doc.text(lines, x, startY);
    return { endY: startY + lines.length * leading, lines: lines.length };
  };
  const title = (text: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.1);
    setColor([15, 23, 42]);
    doc.text(cleanPdfText(text), margin, y);
    y += 1.8;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.22);
    doc.line(margin, y, width - margin, y);
    y += 3.6;
  };
  const shorten = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
  const compactObjective = (text: string) => shorten(
    text
      .replace(/^O procedimento busca /i, "Busca ")
      .replace(/^O tratamento busca /i, "Busca ")
      .replace(/\s+/g, " ")
      .trim(),
    dense ? 145 : 165,
  );
  const compactRisks = (risks: string[]) => risks
    .map((risk) => shorten(
      risk.replace(/\b(necessidade de|possibilidade de|incluindo)\b/gi, "").replace(/\s+/g, " ").trim(),
      dense ? 92 : 108,
    ))
    .join("; ");
  const drawInfoRow = (pairs: Array<[string, string]>) => {
    const gap = 4;
    const cellWidth = (contentWidth - gap * (pairs.length - 1)) / pairs.length;
    const rowY = y;
    let rowHeight = 7.2;
    pairs.forEach(([label, value], index) => {
      const x = margin + index * (cellWidth + gap);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.8);
      setColor([100, 116, 139]);
      doc.text(cleanPdfText(label.toUpperCase()), x, rowY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.1);
      setColor([15, 23, 42]);
      const lines = doc.splitTextToSize(cleanPdfText(value), cellWidth - 2);
      doc.text(lines, x, rowY + 3);
      rowHeight = Math.max(rowHeight, lines.length * 2.8 + 4);
    });
    y += rowHeight + 0.8;
  };
  const drawProcedureBlock = (section: ConsentSection, x: number, startY: number) => {
    let localY = startY;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(bodySize + 0.45);
    setColor([15, 23, 42]);
    const headingLines = doc.splitTextToSize(cleanPdfText(section.title), columnWidth);
    doc.text(headingLines, x, localY);
    localY += headingLines.length * bodyLeading + 0.3;

    const compactText = `${documentText(locale, "objective")}: ${compactObjective(section.explanation)} ${documentText(locale, "risks")}: ${compactRisks(section.risks)}.`;
    const text = wrap(compactText, x, columnWidth, bodySize, bodyLeading, localY);
    return Math.max(7.5, text.endY - startY + 1.8);
  };

  // Cabeçalho em uma faixa horizontal: título à esquerda e identificação
  // imediata do paciente à direita, sem a faixa azul dos outros PDFs.
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, 17, 1.3, 1.3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.1);
  setColor([15, 23, 42]);
  doc.text(documentText(locale, "consentTitle"), margin + 4, y + 6.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  setColor([71, 85, 105]);
  doc.text(documentText(locale, "consentSubtitle"), margin + 4, y + 10.7);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.9);
  setColor([30, 41, 59]);
  doc.text(cleanPdfText(shorten(`${documentText(locale, "patient")}: ${content.patientName}`, 48)), width - margin - 4, y + 6.2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  setColor([71, 85, 105]);
  doc.text(cleanPdfText(shorten(`${documentText(locale, "laterality")}: ${content.laterality}  |  ${documentText(locale, "date")}: ${content.procedureDate}`, 52)), width - margin - 4, y + 10.7, { align: "right" });
  y += 20.5;

  title(documentText(locale, "consentData"));
  drawInfoRow([
    ["Paciente", content.patientName],
    ["CPF", content.patientCpf],
    [documentText(locale, "birth"), content.birthDate],
  ]);
  drawInfoRow([
    [documentText(locale, "laterality"), content.laterality],
    [documentText(locale, "expectedDate"), content.procedureDate],
    [documentText(locale, "hospital"), safeText(surgery.hospital, documentText(locale, "notInformed"))],
  ]);
  drawInfoRow([[documentText(locale, "diagnosis"), content.diagnosis]]);
  drawInfoRow([[documentText(locale, "procedures"), content.procedureLabel]]);
  drawInfoRow([
    [documentText(locale, "responsibleDoctor"), content.doctorName],
    [documentText(locale, "professionalRegistration"), content.doctorCrm],
  ]);

  title(documentText(locale, "consentAwareness"));
  let general = wrap(
    documentText(locale, "consentGeneralOne", { doctor: content.doctorName, procedure: content.procedureLabel }),
    margin,
    contentWidth,
    7,
    3,
  );
  y = general.endY + 0.8;
  general = wrap(
    documentText(locale, "consentGeneralTwo"),
    margin,
    contentWidth,
    7,
    3,
  );
  y = general.endY + 0.8;

  title(documentText(locale, "consentSpecificRisks"));
  const procedureStartY = y;
  const columnEnds = [procedureStartY, procedureStartY];
  content.sections.forEach((section, index) => {
    const column = index % 2;
    const x = margin + column * (columnWidth + gutter);
    const blockHeight = drawProcedureBlock(section, x, columnEnds[column]);
    columnEnds[column] += blockHeight;
  });
  y = Math.max(columnEnds[0], columnEnds[1]) + 0.8;

  title(documentText(locale, "consentCommonRisks"));
  let common = wrap(
    documentText(locale, "consentCommonOne"),
    margin,
    contentWidth,
    bodySize,
    bodyLeading,
  );
  y = common.endY + 0.7;
  common = wrap(
    documentText(locale, "consentCommonTwo"),
    margin,
    contentWidth,
    bodySize,
    bodyLeading,
  );
  y = common.endY + 0.7;

  title(documentText(locale, "consentDeclaration"));
  const declaration = wrap(
    documentText(locale, "consentDeclarationText"),
    margin,
    contentWidth,
    bodySize,
    bodyLeading,
  );
  y = declaration.endY + 2.8;

  const signatureY = y;
  const signatureWidth = (contentWidth - 8) / 3;
  doc.setDrawColor(71, 85, 105);
  doc.setLineWidth(0.22);
   [documentText(locale, "patientOrRepresentative"), documentText(locale, "responsibleDoctor"), documentText(locale, "witness")].forEach((label, index) => {
    const x = margin + index * (signatureWidth + 4);
    doc.line(x, signatureY, x + signatureWidth, signatureY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    setColor([51, 65, 85]);
    doc.text(label, x + signatureWidth / 2, signatureY + 3.2, { align: "center" });
  });
  doc.setFontSize(6.6);
  doc.text(`${documentText(locale, "placeAndDate")}: ________________________________________________________________`, margin, signatureY + 11);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  setColor([100, 116, 139]);
  doc.text(documentText(locale, "consentTitle"), margin, footerY);
  doc.text(documentText(locale, "singlePage"), width - margin, footerY, { align: "right" });

  const safeName = content.patientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "paciente";

  return {
    doc,
    filename: `termo_consentimento_${safeName}_${clinicTodayDateOnly()}.pdf`,
  };
}