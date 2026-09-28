import { describe, expect, it } from "vitest";
import {
  accessRouteForLocale,
  applicationLocationForLocale,
  brFormatAnamnesisRows,
  brHasAnamnesisData,
  clinicalReportFollowupHeaders,
  conditionNameForLocale,
  guidanceForLocale,
  regenPeriodForLocale,
  regenScaleForLocale,
  sexForLocale,
  sideForLocale,
} from "./regen";
import { message } from "../lib/locale-catalog";

describe("Spanish regenerative report controlled values", () => {
  it("uses Spanish messages for a missing case and known report-generation error", () => {
    expect(message("es", "caseNotFound")).toBe("Caso no encontrado.");
    expect(message("es", "reportGenerationFailed")).toBe("No se pudo generar el informe.");
  });

  it("localizes identification and procedure enums without changing unknown free text", () => {
    const seededCodes = [
      "OA_QUADRIL", "OA_OMBRO", "TENDINOPATIA_OMBRO", "BURSITE_OMBRO",
      "LESAO_LABRAL_OMBRO", "OA_COTOVELO", "TENDINOPATIA_COTOVELO", "OA_TORNOZELO",
      "OA_PUNHO", "TENDINOPATIA_PUNHO", "SINDROME_TUNEL_CARPO", "OA_COLUNA_CERVICAL",
      "HERNIA_DISCAL_CERVICAL", "OA_COLUNA_TORACICA", "HERNIA_DISCAL_TORACICA",
      "OA_COLUNA_LOMBAR", "HERNIA_DISCAL_LOMBAR", "CONDRAL_FOCAL",
      "OSTEOCONDRAL", "TENDINOPATIA", "SINOVITE", "BURSITE",
      "FRATURA_FADIGA", "POS_OPERATORIO", "EPICONDILITE", "FASCITE_PLANTAR", "CUSTOM",
    ];
    for (const code of seededCodes) {
      expect(conditionNameForLocale(code, "pt-BR")).not.toBe(code);
      expect(conditionNameForLocale(code, "es")).not.toBe(code);
    }
    expect(conditionNameForLocale("OA_OMBRO", "es")).toBe("Osteoartritis de hombro");
    expect(conditionNameForLocale("OSTEOCONDRAL", "es")).toBe("Lesión osteocondral");
    expect(sexForLocale("feminino", "es")).toBe("Femenino");
    expect(sideForLocale("direito", "es")).toBe("Derecho");
    expect(accessRouteForLocale("intra_articular", "es")).toBe("Intraarticular");
    expect(guidanceForLocale("ultrassom", "es")).toBe("Ecografía");
    expect(guidanceForLocale("ás cegas (palpação)", "es")).toBe("Palpación sin imagen");
    expect(guidanceForLocale("outro", "es")).toBe("Otro");
    expect(guidanceForLocale("Referência anatômica (às cegas)", "es")).toBe("Referencia anatómica (a ciegas)");
    expect(applicationLocationForLocale("Tecido periarticular", "es")).toBe("Tejido periarticular");
    expect(accessRouteForLocale("rota personalizada", "es")).toBe("rota personalizada");
  });

  it("localizes follow-up periods and known scale names only for presentation", () => {
    const persistedPeriod = "30 dias";
    const persistedScales = ["VAS", "VAS Dor", "Escala livre", "Escala personalizada"];

    expect(regenPeriodForLocale(persistedPeriod, "es")).toBe("30 días");
    expect(persistedScales.map(scale => regenScaleForLocale(scale, "es"))).toEqual([
      "EVA",
      "EVA Dolor",
      "Escala livre",
      "Escala personalizada",
    ]);

    // Presentation helpers must not mutate identifiers/values destined for persistence.
    expect(persistedPeriod).toBe("30 dias");
    expect(persistedScales).toEqual(["VAS", "VAS Dor", "Escala livre", "Escala personalizada"]);
    expect(regenPeriodForLocale("período livre", "es")).toBe("período livre");
  });

  it("uses Spanish editorial headers in the generated follow-up PDF table", () => {
    const spanishHeaders = clinicalReportFollowupHeaders("es");

    expect(spanishHeaders).toEqual([
      "Período",
      "Escala de evaluación",
      "Puntuación",
      "Completado el",
    ]);
    expect(spanishHeaders).not.toContain("Escala");
    expect(clinicalReportFollowupHeaders("pt-BR")).toContain("Escala");
  });

  it("localizes anamnesis labels and controlled values while preserving clinician-entered details", () => {
    const rows = brFormatAnamnesisRows({
      tabagismo: "sim",
      tabagismo_qtd: 10,
      alcool: "social",
      autoimune: true,
      autoimune_qual: "Boa",
      sono_horas: 6,
      sono_qualidade: "ruim",
      sedentarismo: false,
      exercicio_regular: true,
      exercicio_qual: "Sim",
      proteina: "adequada",
      ultraprocessados: "às vezes",
      corticoides: true,
      aines: true,
      imunossupressores: true,
      anticoagulantes: true,
      glp1_agonistas: true,
      estatinas: true,
      suplementos: true,
      suplementos_detalhe: "Sem resposta",
      infiltracoes_anteriores: true,
      infiltTipos: ["Corticoide", "Ácido Hialurônico"],
      infiltracoes_tipo: "HA",
      infiltracoes_numero: 3,
      infiltracoes_quando: "Boa",
      prp_ha_previo: true,
      prp_ha_tipo: "LP-PRP",
      prp_ha_sessoes: 3,
      prp_ha_data: "Sem resposta",
      prp_ha_resposta: "sem",
      prp_ha_duracao: "Sim",
    }, "es");
    const valueFor = (label: string) => rows.find(row => row.label === label)?.value;

    expect(valueFor("Tabaquismo")).toBe("Fumador activo — 10 cigarrillos/día");
    expect(valueFor("Consumo de alcohol")).toBe("Consumo social");
    expect(valueFor("Enfermedad autoinmune")).toBe("Sí — Boa");
    expect(valueFor("Calidad del sueño")).toBe("Mala");
    expect(valueFor("Horas de sueño")).toBe("6 hora(s) por noche");
    expect(valueFor("Actividad física")).toBe("No sedentario · Ejercicio regular · Actividad: Sim");
    expect(valueFor("Perfil alimentario — proteína")).toBe("Adecuada");
    expect(valueFor("Perfil alimentario — ultraprocesados")).toBe("A veces");
    expect(valueFor("Medicamentos relevantes")).toBe(
      "Corticoides · AINEs · Inmunosupresores · Anticoagulantes · Agonistas de GLP-1 · Estatinas",
    );
    expect(valueFor("Suplementos alimentarios")).toBe("Sí — Sem resposta");
    expect(valueFor("Antecedentes de infiltraciones / PRP")).toBe(
      "Infiltraciones anteriores: Sí — Corticoide, Ácido hialurónico · 3 registrada(s) · Boa · PRP/HA previo: Sí — LP-PRP (pobre en leucocitos) · 3 sesión(es) · Sem resposta · Respuesta Sin respuesta · Duración del efecto: Sim",
    );
  });
});

describe("clinical report regenerative anamnesis", () => {
  it("formats every relevant answer from the new-case anamnese form", () => {
    const rows = brFormatAnamnesisRows({
      tabagismo: true,
      cigsDay: 10,
      alcool: true,
      obesidade: true,
      obesidadeImc: 31.2,
      circAbdominal: 98,
      diabetes: true,
      diabetesTipo: "Pre-DM",
      diabetesHba1c: 6.8,
      resistIns: true,
      homaIr: 2.8,
      autoimune: true,
      autoimuneQual: "Artrite reumatoide",
      infeccaoRecente: true,
      infeccaoQual: "COVID-19 há 2 semanas",
      horasSono: 5,
      qualidadeSono: "ruim",
      apneia: true,
      cpap: true,
      proteina: "insuficiente",
      ultraproc: true,
      baixasFrutas: true,
      perdaPeso: 5,
      suplementos: true,
      suplementosDetalhe: "Creatina e ômega-3",
      sedentario: true,
      exercRegular: true,
      exercQual: "Caminhada",
      exercFreq: "3×/semana",
      sobreCarga: true,
      medicCorticoide: true,
      medicAines: true,
      medicEstatinas: true,
      medicAnticoag: true,
      medicImunosupr: true,
      glp1Agonistas: true,
      medicOutras: "Metformina",
      ciruPrev: true,
      ciruQual: "Artroscopia de ombro",
      infiltPrev: true,
      infiltTipos: ["Corticoide", "Ácido Hialurônico"],
      infiltData: "Há 3–6 meses",
      prpPrev: true,
      prpData: "Há mais de 6 meses",
      prpResposta: "sem",
    });

    expect(rows).toEqual(expect.arrayContaining([
      { label: "Tabagismo", value: "Fumante ativo — 10 cigarros/dia" },
      { label: "Consumo de álcool", value: "Consumo frequente" },
      { label: "IMC / composição corporal", value: "IMC 31.2 kg/m² · Circunferência abdominal 98 cm" },
      { label: "Diabetes / controle glicêmico", value: "Sim — Pré-diabetes · HbA1c 6.8%" },
      { label: "Resistência à insulina", value: "Sim — HOMA-IR 2.8" },
      { label: "Doença autoimune", value: "Sim — Artrite reumatoide" },
      { label: "Infecção recente", value: "Sim — COVID-19 há 2 semanas" },
      { label: "Qualidade do sono", value: "Ruim" },
      { label: "Horas de sono", value: "5 hora(s) por noite" },
      { label: "Apneia do sono", value: "Sim" },
      { label: "Uso de CPAP", value: "Sim" },
      { label: "Atividade física", value: "Sedentarismo · Exercício regular · Atividade: Caminhada · Frequência: 3×/semana · Sobrecarga ocupacional" },
      { label: "Perfil alimentar — proteína", value: "Insuficiente" },
      { label: "Perfil alimentar — ultraprocessados", value: "Frequente" },
      { label: "Perfil alimentar — frutas e vegetais", value: "Insuficiente" },
      { label: "Perda de peso recente", value: "5 kg" },
      { label: "Suplementos alimentares", value: "Sim — Creatina e ômega-3" },
      { label: "Medicações interferentes", value: "Corticoides · AINEs · Imunossupressores · Anticoagulantes · Agonistas de GLP-1 · Estatinas · Outras: Metformina" },
      { label: "Cirurgia prévia", value: "Sim — Artroscopia de ombro" },
      {
        label: "Histórico de infiltrações / PRP",
        value: "Infiltrações anteriores: Sim — Corticoide, Ácido Hialurônico · Há 3–6 meses · PRP/HA prévio: Sim — Há mais de 6 meses · Resposta Sem resposta",
      },
    ]));
  });

  it("preserves the detailed field names persisted by AnamneseRegenTab", () => {
    const rows = brFormatAnamnesisRows({
      tabagismo: "ex-fumante",
      tabagismo_qtd: 8,
      tabagismo_pack_years: 14,
      alcool: "social",
      obesidade: true,
      obesidade_imc: 33.4,
      obesidade_ca: 112,
      diabetes: "DM2",
      diabetes_hba1c: 7.2,
      resistencia_insulina: true,
      homa_ir: 3.1,
      autoimune: true,
      autoimune_qual: "Lúpus",
      infeccao_recente: true,
      infeccao_qual: "Sinusite em abril de 2026",
      sono_horas: 6,
      sono_qualidade: "regular",
      apneia: true,
      cpap: true,
      proteina: "adequada",
      ultraprocessados: "às vezes",
      frutas_vegetais: "adequado",
      perda_peso_recente: true,
      perda_peso_kg: 8,
      suplementos: true,
      suplementos_detalhe: "Whey e creatina",
      sedentarismo: false,
      exercicio_regular: true,
      exercicio_freq: "Pilates 2×/semana",
      sobrecarga_ocupacional: true,
      corticoides: true,
      corticoides_detalhe: "Prednisona 5 mg/dia há 6 meses",
      aines: true,
      aines_detalhe: "Ibuprofeno 600 mg quando necessário",
      estatinas: true,
      estatinas_detalhe: "Atorvastatina 40 mg",
      anticoagulantes: true,
      anticoagulantes_detalhe: "AAS 100 mg/dia",
      anticoagulantes_inr: 2.1,
      imunossupressores: true,
      imunossupressores_detalhe: "Metotrexato",
      glp1_agonistas: true,
      glp1_qual: "semaglutida",
      glp1_dose: "1 mg/semana",
      medicacoes_outras: "Colchicina",
      cirurgias_previas: true,
      cirurgias_quais: "Meniscectomia artroscópica em 2019",
      cirurgias_implantes: "Âncoras metálicas",
      infiltracoes_anteriores: true,
      infiltracoes_tipo: "HA",
      infiltracoes_numero: 3,
      infiltracoes_quando: "mar/2024",
      prp_ha_previo: true,
      prp_ha_tipo: "LP-PRP",
      prp_ha_sessoes: 3,
      prp_ha_data: "15/03/2024",
      prp_ha_resposta: "parcial",
      prp_ha_duracao: "6 meses",
    });
    const valueFor = (label: string) => rows.find(row => row.label === label)?.value;

    expect(valueFor("Tabagismo")).toBe("Ex-fumante — 8 cigarros/dia · 14 maços-ano");
    expect(valueFor("IMC / composição corporal")).toBe("IMC 33.4 kg/m² · Circunferência abdominal 112 cm");
    expect(valueFor("Diabetes / controle glicêmico")).toBe("Sim — DM2 · HbA1c 7.2%");
    expect(valueFor("Atividade física")).toBe("Não sedentário · Exercício regular · Frequência: Pilates 2×/semana · Sobrecarga ocupacional");
    expect(valueFor("Medicações interferentes")).toBe(
      "Corticoides — Prednisona 5 mg/dia há 6 meses · AINEs — Ibuprofeno 600 mg quando necessário · Imunossupressores — Metotrexato · Anticoagulantes — AAS 100 mg/dia · INR 2.1 · Agonistas de GLP-1 — Semaglutida · 1 mg/semana · Estatinas — Atorvastatina 40 mg · Outras: Colchicina",
    );
    expect(valueFor("Cirurgia prévia")).toBe("Sim — Meniscectomia artroscópica em 2019 · Implantes: Âncoras metálicas");
    expect(valueFor("Histórico de infiltrações / PRP")).toBe(
      "Infiltrações anteriores: Sim — Ácido hialurônico · 3 registrada(s) · mar/2024 · PRP/HA prévio: Sim — LP-PRP (pobre em leucócitos) · 3 sessão(ões) · 15/03/2024 · Resposta Parcial · Duração do efeito: 6 meses",
    );
  });

  it("formats the legacy anamnese schema without exposing stored keys or raw JSON", () => {
    const rows = brFormatAnamnesisRows({
      tabagismo: "ex-fumante",
      alcool: "social",
      obesidade_imc: 26,
      sono_horas: 7,
      sono_qualidade: "boa",
      apneia: false,
      sedentarismo: false,
      exercicio_regular: true,
      proteina: "adequada",
      ultraprocessados: "às vezes",
      corticoides: false,
      resistencia_insulina: false,
      autoimune: false,
      prp_ha_previo: false,
      infiltracoes_anteriores: false,
    });

    expect(rows).toEqual(expect.arrayContaining([
      { label: "Tabagismo", value: "Ex-fumante" },
      { label: "Consumo de álcool", value: "Consumo social" },
      { label: "IMC / composição corporal", value: "IMC 26.0 kg/m²" },
      { label: "Qualidade do sono", value: "Boa" },
      { label: "Apneia do sono", value: "Não" },
      { label: "Atividade física", value: "Não sedentário · Exercício regular" },
      { label: "Perfil alimentar — proteína", value: "Adequada" },
      { label: "Perfil alimentar — ultraprocessados", value: "Às vezes" },
      { label: "Medicações interferentes", value: "Nenhuma declarada" },
      { label: "Resistência à insulina", value: "Não" },
      { label: "Doença autoimune", value: "Não" },
      {
        label: "Histórico de infiltrações / PRP",
        value: "Infiltrações anteriores: Não · PRP/HA prévio: Não",
      },
    ]));
  });

  it("omits the section when anamnese has no values", () => {
    expect(brHasAnamnesisData(null)).toBe(false);
    expect(brHasAnamnesisData({})).toBe(false);
    expect(brHasAnamnesisData({ apneia: null, notas: "" })).toBe(false);
    expect(brHasAnamnesisData({ apneia: false })).toBe(true);
  });
});