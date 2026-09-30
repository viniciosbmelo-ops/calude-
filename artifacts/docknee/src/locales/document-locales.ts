import type { Locale, ScopedMessages } from "@/lib/i18n";
import { formatCalendarDate, safeFormatDate } from "@/lib/utils";

export const documentMessages = {
  "pt-BR": {
    patient: "Paciente", date: "Data", birthDate: "Data de nascimento", leave: "Afastamento",
    clinicalDocument: "Documento de uso clínico", generatedOn: "Gerado em",
    confidential: "Documento confidencial de uso médico", page: "Página {current} de {total}",
    consentTitle: "TERMO DE CONSENTIMENTO INFORMADO", consentSubtitle: "Procedimentos cirúrgicos de ombro e cotovelo",
    consentData: "1. Dados do consentimento", procedure: "Procedimento", laterality: "Lado",
    diagnosis: "Diagnóstico", hospital: "Hospital / local", responsibleDoctor: "Médico responsável",
    professionalRegistration: "Registro profissional", patientOrLegalRepresentative: "Paciente ou responsável legal",
    witness: "Testemunha", placeAndDate: "Local e data",
    notInformed: "Não informado", medicalPrescription: "RECEITA MÉDICA", medicalReport: "LAUDO MÉDICO", medicalCertificate: "ATESTADO MÉDICO",
    followupReport: "Relatório de Follow-up", filters: "Filtros", followups: "follow-ups", surgeries: "cirurgias",
    yes: "Sim", no: "Não", exportCsv: "Exportar CSV",
    clinicalReport: "Relatório clínico", back: "Voltar", savePdfPrint: "Salvar PDF / Imprimir",
    assessedOn: "Avaliado em", comparedWith: "Comparado com", clinicalAnalysis: "Análise clínica",
    consentAwareness: "2. Ciência e consentimento", consentSpecificRisks: "3. Características e riscos específicos", objective: "Objetivo", risks: "Riscos",
    consentCommonRisks: "4. Riscos comuns, anestesia e recuperação", consentDeclaration: "5. Declaração",
    birth: "Nascimento", expectedDate: "Data prevista", procedures: "Procedimento(s)",
    consentGeneralOne: "Declaro que recebi explicações claras do(a) Dr(a). {doctor} sobre {procedure}, seus objetivos, benefícios, limitações e alternativas, inclusive a opção de não realizar o procedimento.",
    consentGeneralTwo: "Compreendo que não há garantia de resultado e que a extensão da cirurgia poderá ser ajustada diante de achados relevantes, dentro da finalidade terapêutica explicada.",
    consentCommonOne: "Qualquer cirurgia pode envolver dor, sangramento, hematoma, infecção, cicatriz, alteração de sensibilidade, lesão de nervos ou vasos, trombose, embolia pulmonar, rigidez, reoperação, transfusão, complicações graves e, raramente, óbito. A anestesia e seus riscos serão esclarecidos pela equipe de anestesiologia.",
    consentCommonTwo: "Comprometo-me a seguir as orientações de preparo, medicamentos, curativos, restrição de carga, retornos e reabilitação. Tabagismo, doenças clínicas, medicamentos e baixa adesão podem aumentar riscos e comprometer o resultado.",
    consentDeclarationText: "Tive oportunidade de fazer perguntas e recebi respostas satisfatórias. Autorizo o procedimento descrito e as condutas complementares justificadas por achados intraoperatórios, dentro dos limites técnicos e éticos. Este termo não substitui a conversa presencial individualizada. Declaro que o li e compreendi.",
    patientOrRepresentative: "Paciente ou responsável", singlePage: "Página única",
    identification: "Identificação",
    generalClarifications: "2. Esclarecimentos gerais", specificRisks: "Riscos e possíveis intercorrências específicos:",
    commonRisksHeading: "Riscos comuns, anestesia e recuperação", consentDeclarationHeading: "Declaração de consentimento",
    legacyGeneralOne: "Declaro que recebi explicações claras do(a) Dr(a). {doctor} sobre o diagnóstico acima, a indicação de {procedure}, seus objetivos, etapas previsíveis, benefícios esperados, limitações e alternativas de tratamento, inclusive a alternativa de não realizar o procedimento neste momento.",
    legacyGeneralTwo: "Compreendo que a medicina não oferece garantia de resultado. A extensão do procedimento poderá ser ajustada diante de achados relevantes durante a cirurgia, quando isso for tecnicamente necessário e estiver de acordo com a finalidade terapêutica explicada.",
    legacyCommonOne: "Além dos riscos específicos, fui informado(a) de que qualquer procedimento cirúrgico pode envolver dor, sangramento, hematoma, infecção, cicatriz, alteração de sensibilidade, lesão de nervos ou vasos, trombose venosa, embolia pulmonar, rigidez, necessidade de reoperação, internação prolongada, transfusão, complicações clínicas graves e, raramente, óbito.",
    legacyCommonTwo: "A anestesia será discutida pela equipe de anestesiologia, que poderá esclarecer suas modalidades, riscos e cuidados. Comprometo-me a seguir as orientações de preparo, uso de medicamentos, restrição de carga, curativos, retorno e reabilitação. Entendo que tabagismo, doenças clínicas, uso de medicamentos e ausência de adesão às orientações podem aumentar riscos e comprometer o resultado.",
    legacyDeclarationOne: "Tive oportunidade de fazer perguntas e recebi respostas satisfatórias. Autorizo a realização do procedimento descrito, bem como as condutas complementares justificadas por achados intraoperatórios, dentro dos limites técnicos e éticos. Autorizo também o registro em prontuário e o uso de materiais, implantes, enxertos ou recursos indicados para o tratamento.",
    legacyDeclarationTwo: "Este termo não substitui a conversa presencial e individualizada com o médico responsável. Declaro que o li, compreendi seu conteúdo e recebi uma via quando solicitado.",
  },
  es: {
    patient: "Paciente", date: "Fecha", birthDate: "Fecha de nacimiento", leave: "Licencia",
    clinicalDocument: "Documento de uso clínico", generatedOn: "Generado el",
    confidential: "Documento confidencial de uso médico", page: "Página {current} de {total}",
    consentTitle: "CONSENTIMIENTO INFORMADO", consentSubtitle: "Procedimientos quirúrgicos de hombro y codo",
    consentData: "1. Datos del consentimiento", procedure: "Procedimiento", laterality: "Lado",
    diagnosis: "Diagnóstico", hospital: "Hospital / lugar", responsibleDoctor: "Médico responsable",
    professionalRegistration: "Registro profesional", patientOrLegalRepresentative: "Paciente o representante legal",
    witness: "Testigo", placeAndDate: "Lugar y fecha",
    notInformed: "No informado", medicalPrescription: "RECETA MÉDICA", medicalReport: "INFORME MÉDICO", medicalCertificate: "CERTIFICADO MÉDICO",
    followupReport: "Informe de seguimiento", filters: "Filtros", followups: "seguimientos", surgeries: "cirugías",
    yes: "Sí", no: "No", exportCsv: "Exportar CSV",
    clinicalReport: "Informe clínico", back: "Volver", savePdfPrint: "Guardar PDF / Imprimir",
    assessedOn: "Evaluado el", comparedWith: "Comparado con", clinicalAnalysis: "Análisis clínico",
    consentAwareness: "2. Información y consentimiento", consentSpecificRisks: "3. Características y riesgos específicos", objective: "Objetivo", risks: "Riesgos",
    consentCommonRisks: "4. Riesgos comunes, anestesia y recuperación", consentDeclaration: "5. Declaración",
    birth: "Nacimiento", expectedDate: "Fecha prevista", procedures: "Procedimiento(s)",
    consentGeneralOne: "Declaro que recibí explicaciones claras del/de la Dr./Dra. {doctor} sobre {procedure}, sus objetivos, beneficios, limitaciones y alternativas, incluida la opción de no realizar el procedimiento.",
    consentGeneralTwo: "Comprendo que no existe garantía de resultado y que la extensión de la cirugía podrá ajustarse ante hallazgos relevantes, dentro de la finalidad terapéutica explicada.",
    consentCommonOne: "Toda cirugía puede implicar dolor, sangrado, hematoma, infección, cicatriz, alteración de la sensibilidad, lesión de nervios o vasos, trombosis, embolia pulmonar, rigidez, reoperación, transfusión, complicaciones graves y, raramente, fallecimiento. La anestesia y sus riesgos serán explicados por el equipo de anestesiología.",
    consentCommonTwo: "Me comprometo a seguir las indicaciones de preparación, medicamentos, curaciones, restricción de carga, controles y rehabilitación. El tabaquismo, enfermedades clínicas, medicamentos y baja adherencia pueden aumentar los riesgos y comprometer el resultado.",
    consentDeclarationText: "Tuve la oportunidad de formular preguntas y recibí respuestas satisfactorias. Autorizo el procedimiento descrito y las medidas complementarias justificadas por hallazgos intraoperatorios, dentro de los límites técnicos y éticos. Este documento no sustituye la conversación presencial individualizada. Declaro que lo leí y comprendí.",
    patientOrRepresentative: "Paciente o representante", singlePage: "Página única",
    identification: "Identificación",
    generalClarifications: "2. Información general", specificRisks: "Riesgos y posibles complicaciones específicas:",
    commonRisksHeading: "Riesgos comunes, anestesia y recuperación", consentDeclarationHeading: "Declaración de consentimiento",
    legacyGeneralOne: "Declaro que recibí explicaciones claras del/de la Dr./Dra. {doctor} sobre el diagnóstico anterior, la indicación de {procedure}, sus objetivos, etapas previsibles, beneficios esperados, limitaciones y alternativas de tratamiento, incluida la alternativa de no realizar el procedimiento en este momento.",
    legacyGeneralTwo: "Comprendo que la medicina no ofrece garantía de resultado. La extensión del procedimiento podrá ajustarse ante hallazgos relevantes durante la cirugía, cuando sea técnicamente necesario y de acuerdo con la finalidad terapéutica explicada.",
    legacyCommonOne: "Además de los riesgos específicos, fui informado(a) de que cualquier procedimiento quirúrgico puede implicar dolor, sangrado, hematoma, infección, cicatriz, alteración de la sensibilidad, lesión de nervios o vasos, trombosis venosa, embolia pulmonar, rigidez, necesidad de reoperación, internación prolongada, transfusión, complicaciones clínicas graves y, raramente, fallecimiento.",
    legacyCommonTwo: "La anestesia será discutida por el equipo de anestesiología, que podrá explicar sus modalidades, riesgos y cuidados. Me comprometo a seguir las indicaciones de preparación, uso de medicamentos, restricción de carga, curaciones, controles y rehabilitación. Entiendo que el tabaquismo, enfermedades clínicas, uso de medicamentos y falta de adherencia a las indicaciones pueden aumentar los riesgos y comprometer el resultado.",
    legacyDeclarationOne: "Tuve la oportunidad de formular preguntas y recibí respuestas satisfactorias. Autorizo la realización del procedimiento descrito y las medidas complementarias justificadas por hallazgos intraoperatorios, dentro de los límites técnicos y éticos. También autorizo el registro en la historia clínica y el uso de materiales, implantes, injertos o recursos indicados para el tratamiento.",
    legacyDeclarationTwo: "Este consentimiento no sustituye la conversación presencial e individualizada con el médico responsable. Declaro que lo leí, comprendí su contenido y recibí una copia cuando la solicité.",
  },
} as const satisfies ScopedMessages<Record<string, string>>;

export type DocumentMessageKey = keyof typeof documentMessages["pt-BR"];

export function documentText(locale: Locale, key: DocumentMessageKey, params?: Record<string, string | number>) {
  let text: string = documentMessages[locale][key] ?? documentMessages["pt-BR"][key] ?? String(key);
  if (params) text = text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  return text;
}

export function documentDate(locale: Locale, value: Date | string | number, options: Intl.DateTimeFormatOptions) {
  return safeFormatDate(value, locale, options, "");
}

/** Calendar dates (birth date…) in documents — never timezone-shifted. */
export function documentCalendarDate(locale: Locale, value: Date | string | null | undefined, options: Intl.DateTimeFormatOptions) {
  return formatCalendarDate(value, locale, options, "");
}

/**
 * Labels used by the legacy clinical PDF layouts. Values are deliberately
 * limited to authored UI/document copy: measurements, enum values and any
 * patient/clinician-entered content are never transformed.
 */
const generatedCopy = {
  "pt-BR": {} as Record<string, string>,
  es: {
    "Resumo Cirurgico": "Resumen quirúrgico",
    "Identificacao do Paciente": "Identificación del paciente",
    "Classificacao do Caso": "Clasificación del caso",
    "Prontidao Biologica": "Preparación biológica",
    "Dados insuficientes — preencha a anamnese para laudo completo": "Datos insuficientes — complete la anamnesis para el informe completo",
    "Completude": "Completitud",
    "Prioridades de otimizacao:": "Prioridades de optimización:",
    "Algoritmos Clinicos": "Algoritmos clínicos",
    "Tecnica Principal": "Técnica principal",
    "pontos": "puntos",
    "Reconstrucao Extra-Articular:": "Reconstrucción extraarticular:",
    "Tecnica nao especificada": "Técnica no especificada",
    "Analise Radiografica (IA)": "Análisis radiográfico (IA)",
    "Observacoes": "Observaciones",
    "Diagnostico": "Diagnóstico",
    "Nome": "Nombre", "Sexo": "Sexo", "Telefone": "Teléfono", "Lado Preferido": "Lado preferido",
    "Data do Procedimento": "Fecha del procedimiento", "Hospital / Local": "Hospital / lugar",
    "Tipo de Caso": "Tipo de caso", "Alinhamento": "Alineación", "Grau": "Grado",
    "Procedimentos": "Procedimientos","Risco": "Riesgo", "Conduta": "Conducta",
    "Enxerto": "Injerto", "Diametro": "Diámetro", "Fixacao": "Fijación",
    "Fixacao Femoral": "Fijación femoral", "Fixacao Tibial": "Fijación tibial",
    "Reconstrucao": "Reconstrucción", "Tecnica": "Técnica",
    "RECOMENDACAO CIRURGICA": "RECOMENDACIÓN QUIRÚRGICA",
    "ANGULO DE CORRECAO NO CORA": "ÁNGULO DE CORRECCIÓN EN EL CORA",
    "! Alertas Tecnicos": "! Alertas técnicas",
    "Planejamento por nivel": "Planificación por nivel",
    "PLANEJAMENTO POR NÍVEL": "PLANIFICACIÓN POR NIVEL",
    "Contrib. Femoral": "Contrib. femoral", "Contrib. Tibial": "Contrib. tibial", "Comp. Articular": "Comp. articular",
    "Nível Femoral — DFO": "Nivel femoral — DFO", "Nível Tibial — HTO": "Nivel tibial — HTO",
    "ESCOLHA CIRÚRGICA": "ELECCIÓN QUIRÚRGICA", "Ângulo": "Ángulo", "Pré-op": "Preop.", "Pós-op": "Posop.",
    "Observações:": "Observaciones:", "Técnica:": "Técnica:",
    "TERMO DE CIÊNCIA E CONSENTIMENTO INFORMADO": "CONSENTIMIENTO INFORMADO",
    "1. Identificação": "1. Identificación", "2. Esclarecimentos gerais": "2. Información general",
    "Riscos e possíveis intercorrências específicos:": "Riesgos y posibles complicaciones específicas:",
    "Riscos comuns, anestesia e recuperação": "Riesgos comunes, anestesia y recuperación",
    "Declaração de consentimento": "Declaración de consentimiento",
    "Termo de ciência e consentimento informado": "Consentimiento informado",
    "Página única": "Página única",
    "Dados do consentimento": "Datos del consentimiento",
    "Objetivo:": "Objetivo:", "Riscos:": "Riesgos:",
    "Escalas Avaliadas — Contextualização por Período": "Escalas evaluadas — Contextualización por período",
    "Eventos Clínicos": "Eventos clínicos", "Complicações": "Complicaciones",
    "Evolução das Escalas": "Evolución de las escalas", "Situação": "Situación",
    "Variação vs. Anterior": "Variación frente al anterior", "Resultado": "Resultado",
    "Referência": "Referencia", "Dentro do esperado": "Dentro de lo esperado",
    "Acima do esperado": "Por encima de lo esperado", "Abaixo do esperado": "Por debajo de lo esperado",
  } as Record<string, string>,
};

export function generatedDocumentText(locale: Locale, authoredCopy: string): string {
  return generatedCopy[locale][authoredCopy] ?? authoredCopy;
}