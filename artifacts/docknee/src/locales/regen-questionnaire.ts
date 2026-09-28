import type { Locale } from "@/lib/i18n";

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
const radio = (id: string, label: string, options: { label: string; value: number }[]): RegenScaleQuestion => ({ id, label, type: "radio", options });
const slider = (id: string, label: string): RegenScaleQuestion => ({ id, label, type: "slider", min: 0, max: 10, step: 1 });

const severity = (labels: string[], values = [4, 3, 2, 1, 0]) => labels.map((label, index) => ({ label, value: values[index] }));
const womacSeverity = (labels: string[]) => labels.map((label, index) => ({ label, value: index }));
const difficulty = (labels: string[]) => labels.map((label, index) => ({ label, value: index }));

/** Visible copy for the public regenerative questionnaire. IDs and values remain clinical payload identifiers. */
export const regenQuestionnaireMessages: Record<Locale, Record<string, LocalizedScale>> = {
  "pt-BR": {
    "VAS Dor": { id: "VAS Dor", title: "Escala de Dor (VAS)", description: "Avalie sua dor no joelho. Mova o controle deslizante para indicar o nível de dor.", maxScore: 10, questions: [slider("vas", "Como você avalia sua dor no joelho hoje? (0 = sem dor, 10 = pior dor imaginável)")] },
    Tegner: { id: "Tegner", title: "Escala de Atividade de Tegner", description: "Selecione o nível de atividade física que mais se aproxima da sua situação atual.", maxScore: 10, questions: [radio("tegner", "Selecione o nível de atividade que descreve melhor sua situação atual:", [
      "0 — Licença por invalidez ou pensão devido ao joelho", "1 — Atividades sedentárias; trabalho de escritório", "2 — Atividades leves; caminhada em terreno plano", "3 — Natação ou caminhada na floresta", "4 — Ciclismo, ski alpino, jogging 2× por semana", "5 — Jogging pelo menos 5× por semana; futebol recreativo", "6 — Tênis, badminton; handebol recreativo; jogging (mín 1× sem)", "7 — Futebol / handebol em nível de divisão mais baixa", "8 — Futebol, handebol, squash (elite júnior ou master)", "9 — Futebol, handebol, squash (divisão superior)", "10 — Futebol ou handebol (nível nacional / internacional)",
    ].map((label, value) => ({ label, value }))) ] },
    IKDC: { id: "IKDC", title: "IKDC Subjetivo do Joelho", description: "Responda às perguntas considerando sua situação atual do joelho.", maxScore: 100, questions: [
      radio("atividade_atual", "1. Qual o mais alto nível de atividade que você consegue realizar sem dor significativa?", [{ label: "Atividades muito intensas (saltar, corte em esportes como basquete, futebol)", value: 4 }, { label: "Atividades intensas (trabalho físico pesado, ski, tênis)", value: 3 }, { label: "Atividades moderadas (trabalho físico moderado, corrida)", value: 2 }, { label: "Atividades leves (caminhada, serviço doméstico leve)", value: 1 }, { label: "Incapaz de realizar qualquer atividade citada acima", value: 0 }]),
      radio("dor_frequencia", "2. Com que frequência você tem dor?", severity(["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"], [10, 8, 6, 4, 0])),
      slider("dor_intensidade", "3. Se você sente dor, qual a intensidade? (0 = sem dor, 10 = pior dor imaginável)"),
      radio("rigidez", "4. Qual o grau de rigidez do seu joelho?", severity(["Nenhuma", "Leve", "Moderada", "Grave", "Extrema"], [10, 8, 6, 2, 0])),
      radio("edema", "5. Com que frequência o joelho incha?", severity(["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"], [10, 8, 6, 4, 0])),
      radio("travamento", "6. Seu joelho trava ou bloqueia?", severity(["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"], [15, 10, 5, 2, 0])),
      radio("falseamento", "7. Seu joelho falha (cede)?", severity(["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"], [15, 10, 5, 2, 0])),
      radio("nivel_atual_atividade", "8. Qual o mais alto nível de atividade que você consegue realizar ATUALMENTE?", [{ label: "Atividades muito intensas", value: 4 }, { label: "Atividades intensas", value: 3 }, { label: "Atividades moderadas", value: 2 }, { label: "Atividades leves", value: 1 }, { label: "Incapaz", value: 0 }]),
      slider("funcao_geral", "9. Como você classificaria o funcionamento do seu joelho (0 = incapacidade total, 10 = funcionamento normal)?"),
      slider("funcao_esporte", "10. Como você classificaria seu joelho ANTES DO PROBLEMA? (0 = incapacidade total, 10 = normal)"),
    ] },
    "KOOS-12": { id: "KOOS-12", title: "KOOS-12 — Lesão do Joelho e Osteoartrose", description: "Responda às perguntas considerando seu joelho NA ÚLTIMA SEMANA.", maxScore: 100, questions: [
      radio("dor_freq", "1. Com que frequência seu joelho dói?", severity(["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"])),
      ...[["dor_torcao", "2. Dor ao torcer/girar o joelho"], ["dor_extensao", "3. Dor ao estender completamente o joelho"], ["rigidez_manha", "4. Rigidez matinal do joelho (ao acordar)"], ["rigidez_tarde", "5. Rigidez após sentar, deitar ou descansar o joelho"]].map(([id, label]) => radio(id, label, severity(["Nenhuma", "Leve", "Moderada", "Grave", "Extrema"]))),
      ...[["adl_escadas", "6. Dificuldade para subir escadas"], ["adl_levantar", "7. Dificuldade para se levantar da cadeira"], ["adl_caminhar", "8. Dificuldade para caminhar em superfície plana"], ["sport_agachar", "9. Dificuldade para agachar"], ["sport_correr", "10. Dificuldade para correr"]].map(([id, label]) => radio(id, label, severity(["Nenhuma", "Leve", "Moderada", "Grave", "Extrema/impossível"]))),
      radio("qol_consciente", "11. Com que frequência você está consciente do problema no seu joelho?", severity(["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"])),
      radio("qol_modificou", "12. Você modificou seu estilo de vida para evitar atividades potencialmente prejudiciais ao joelho?", severity(["De forma alguma", "Levemente", "Moderadamente", "Muito", "Totalmente"])),
    ] },
    WOMAC: { id: "WOMAC", title: "WOMAC — Índice de Osteoartrite", description: "Avalie seu joelho nas últimas 48 horas.", maxScore: 100, questions: [
      ...[["dor_caminhar", "DOR 1. Ao caminhar em superfície plana"], ["dor_escadas", "DOR 2. Ao subir ou descer escadas"], ["dor_noite", "DOR 3. À noite (ao dormir)"], ["dor_repouso", "DOR 4. Em repouso (sentado ou deitado)"], ["dor_carga", "DOR 5. Ao apoiar o peso no joelho"], ["rig_manha", "RIGIDEZ 1. Rigidez matinal (ao acordar)"], ["rig_tarde", "RIGIDEZ 2. Rigidez após sentar, deitar ou descansar"]].map(([id, label]) => radio(id, label, womacSeverity(["Nenhuma", "Leve", "Moderada", "Intensa", "Muito intensa"]))),
      ...[["fis_descer", "FUNÇÃO 1. Descer escadas"], ["fis_subir", "FUNÇÃO 2. Subir escadas"], ["fis_levantar", "FUNÇÃO 3. Levantar-se de uma cadeira ou cama"], ["fis_caminhar", "FUNÇÃO 4. Caminhar em superfície plana"], ["fis_ficar_pe", "FUNÇÃO 5. Ficar em pé"]].map(([id, label]) => radio(id, label, difficulty(["Nenhuma dificuldade", "Leve", "Moderada", "Intensa", "Muito intensa/impossível"]))),
    ] },
  },
  es: {
    "VAS Dor": { id: "VAS Dor", title: "Escala de dolor (VAS)", description: "Evalúe el dolor de su rodilla. Mueva el control deslizante para indicar el nivel de dolor.", maxScore: 10, questions: [slider("vas", "¿Cómo evalúa hoy el dolor de su rodilla? (0 = sin dolor, 10 = el peor dolor imaginable)")] },
    Tegner: { id: "Tegner", title: "Escala de actividad de Tegner", description: "Seleccione el nivel de actividad física que más se aproxime a su situación actual.", maxScore: 10, questions: [radio("tegner", "Seleccione el nivel de actividad que mejor describe su situación actual:", [
      "0 — Baja por incapacidad o pensión debido a la rodilla", "1 — Actividades sedentarias; trabajo de oficina", "2 — Actividades ligeras; caminar en terreno llano", "3 — Natación o caminata por el bosque", "4 — Ciclismo, esquí alpino, jogging 2× por semana", "5 — Jogging al menos 5× por semana; fútbol recreativo", "6 — Tenis, bádminton; balonmano recreativo; jogging (mín. 1× sem)", "7 — Fútbol / balonmano en división inferior", "8 — Fútbol, balonmano, squash (élite júnior o máster)", "9 — Fútbol, balonmano, squash (división superior)", "10 — Fútbol o balonmano (nivel nacional / internacional)",
    ].map((label, value) => ({ label, value }))) ] },
    IKDC: { id: "IKDC", title: "IKDC subjetivo de rodilla", description: "Responda las preguntas considerando la situación actual de su rodilla.", maxScore: 100, questions: [
      radio("atividade_atual", "1. ¿Cuál es el nivel más alto de actividad que puede realizar sin dolor significativo?", [{ label: "Actividades muy intensas (saltar, cambios de dirección en deportes como baloncesto, fútbol)", value: 4 }, { label: "Actividades intensas (trabajo físico pesado, esquí, tenis)", value: 3 }, { label: "Actividades moderadas (trabajo físico moderado, correr)", value: 2 }, { label: "Actividades ligeras (caminar, tareas domésticas ligeras)", value: 1 }, { label: "Incapaz de realizar cualquiera de las actividades anteriores", value: 0 }]),
      radio("dor_frequencia", "2. ¿Con qué frecuencia tiene dolor?", severity(["Nunca", "Rara vez", "A veces", "Frecuentemente", "Siempre"], [10, 8, 6, 4, 0])),
      slider("dor_intensidade", "3. Si siente dolor, ¿cuál es su intensidad? (0 = sin dolor, 10 = el peor dolor imaginable)"),
      radio("rigidez", "4. ¿Cuál es el grado de rigidez de su rodilla?", severity(["Ninguna", "Leve", "Moderada", "Grave", "Extrema"], [10, 8, 6, 2, 0])),
      radio("edema", "5. ¿Con qué frecuencia se hincha la rodilla?", severity(["Nunca", "Rara vez", "A veces", "Frecuentemente", "Siempre"], [10, 8, 6, 4, 0])),
      radio("travamento", "6. ¿Su rodilla se traba o bloquea?", severity(["Nunca", "Rara vez", "A veces", "Frecuentemente", "Siempre"], [15, 10, 5, 2, 0])),
      radio("falseamento", "7. ¿Su rodilla falla (cede)?", severity(["Nunca", "Rara vez", "A veces", "Frecuentemente", "Siempre"], [15, 10, 5, 2, 0])),
      radio("nivel_atual_atividade", "8. ¿Cuál es el nivel más alto de actividad que puede realizar ACTUALMENTE?", [{ label: "Actividades muy intensas", value: 4 }, { label: "Actividades intensas", value: 3 }, { label: "Actividades moderadas", value: 2 }, { label: "Actividades ligeras", value: 1 }, { label: "Incapaz", value: 0 }]),
      slider("funcao_geral", "9. ¿Cómo calificaría el funcionamiento de su rodilla? (0 = incapacidad total, 10 = funcionamiento normal)"),
      slider("funcao_esporte", "10. ¿Cómo calificaría su rodilla ANTES DEL PROBLEMA? (0 = incapacidad total, 10 = normal)"),
    ] },
    "KOOS-12": { id: "KOOS-12", title: "KOOS-12 — Lesión de rodilla y osteoartritis", description: "Responda las preguntas considerando su rodilla DURANTE LA ÚLTIMA SEMANA.", maxScore: 100, questions: [
      radio("dor_freq", "1. ¿Con qué frecuencia le duele la rodilla?", severity(["Nunca", "Rara vez", "A veces", "Frecuentemente", "Siempre"])),
      ...[["dor_torcao", "2. Dolor al torcer/girar la rodilla"], ["dor_extensao", "3. Dolor al extender completamente la rodilla"], ["rigidez_manha", "4. Rigidez matinal de la rodilla (al despertar)"], ["rigidez_tarde", "5. Rigidez después de sentarse, acostarse o descansar la rodilla"]].map(([id, label]) => radio(id, label, severity(["Ninguna", "Leve", "Moderada", "Grave", "Extrema"]))),
      ...[["adl_escadas", "6. Dificultad para subir escaleras"], ["adl_levantar", "7. Dificultad para levantarse de una silla"], ["adl_caminhar", "8. Dificultad para caminar sobre una superficie plana"], ["sport_agachar", "9. Dificultad para agacharse"], ["sport_correr", "10. Dificultad para correr"]].map(([id, label]) => radio(id, label, severity(["Ninguna", "Leve", "Moderada", "Grave", "Extrema/imposible"]))),
      radio("qol_consciente", "11. ¿Con qué frecuencia es consciente del problema en su rodilla?", severity(["Nunca", "Rara vez", "A veces", "Frecuentemente", "Siempre"])),
      radio("qol_modificou", "12. ¿Ha modificado su estilo de vida para evitar actividades potencialmente perjudiciales para la rodilla?", severity(["De ninguna manera", "Levemente", "Moderadamente", "Mucho", "Totalmente"])),
    ] },
    WOMAC: { id: "WOMAC", title: "WOMAC — Índice de osteoartritis", description: "Evalúe su rodilla durante las últimas 48 horas.", maxScore: 100, questions: [
      ...[["dor_caminhar", "DOLOR 1. Al caminar sobre una superficie plana"], ["dor_escadas", "DOLOR 2. Al subir o bajar escaleras"], ["dor_noite", "DOLOR 3. Por la noche (al dormir)"], ["dor_repouso", "DOLOR 4. En reposo (sentado o acostado)"], ["dor_carga", "DOLOR 5. Al apoyar peso sobre la rodilla"], ["rig_manha", "RIGIDEZ 1. Rigidez matinal (al despertar)"], ["rig_tarde", "RIGIDEZ 2. Rigidez después de sentarse, acostarse o descansar"]].map(([id, label]) => radio(id, label, womacSeverity(["Ninguna", "Leve", "Moderada", "Intensa", "Muy intensa"]))),
      ...[["fis_descer", "FUNCIÓN 1. Bajar escaleras"], ["fis_subir", "FUNCIÓN 2. Subir escaleras"], ["fis_levantar", "FUNCIÓN 3. Levantarse de una silla o cama"], ["fis_caminhar", "FUNCIÓN 4. Caminar sobre una superficie plana"], ["fis_ficar_pe", "FUNCIÓN 5. Estar de pie"]].map(([id, label]) => radio(id, label, difficulty(["Sin dificultad", "Leve", "Moderada", "Intensa", "Muy intensa/imposible"]))),
    ] },
  },
};

const koosKeys = ["dor_freq", "dor_torcao", "dor_extensao", "rigidez_manha", "rigidez_tarde", "adl_escadas", "adl_levantar", "adl_caminhar", "sport_agachar", "sport_correr", "qol_consciente", "qol_modificou"];
const womacKeys = ["dor_caminhar", "dor_escadas", "dor_noite", "dor_repouso", "dor_carga", "rig_manha", "rig_tarde", "fis_descer", "fis_subir", "fis_levantar", "fis_caminhar", "fis_ficar_pe"];

export function getRegenScales(locale: Locale): Record<string, RegenScaleDef> {
  const localized = regenQuestionnaireMessages[locale];
  return {
    "VAS Dor": { ...localized["VAS Dor"], calcScore: a => a.vas ?? 0 },
    Tegner: { ...localized.Tegner, calcScore: a => a.tegner ?? 0 },
    IKDC: { ...localized.IKDC, calcScore: a => Math.round((((a.atividade_atual ?? 0) + (a.dor_frequencia ?? 0) + 10 - (a.dor_intensidade ?? 5) + (a.rigidez ?? 0) + (a.edema ?? 0) + (a.travamento ?? 0) + (a.falseamento ?? 0) + (a.nivel_atual_atividade ?? 0) + (a.funcao_geral ?? 0) + (a.funcao_esporte ?? 0)) / 98) * 100) },
    "KOOS-12": { ...localized["KOOS-12"], calcScore: a => Math.round((koosKeys.reduce((sum, key) => sum + (a[key] ?? 0), 0) / (koosKeys.length * 4)) * 100) },
    WOMAC: { ...localized.WOMAC, calcScore: a => Math.round(100 - (womacKeys.reduce((sum, key) => sum + (a[key] ?? 0), 0) / (womacKeys.length * 4)) * 100) },
  };
}