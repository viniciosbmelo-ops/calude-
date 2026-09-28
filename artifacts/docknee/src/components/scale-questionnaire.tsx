import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { publicPatientFlowMessages, surgicalOptionSpanish, surgicalScaleSpanish } from "@/locales/public-patient-flows";

type QuestionOption = { label: string; value: number };
type ScaleQuestion = {
  id: string;
  label: string;
  type: "radio" | "slider";
  options?: QuestionOption[];
  min?: number;
  max?: number;
  step?: number;
};
type ScaleDef = {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  questions: ScaleQuestion[];
  calcScore: (answers: Record<string, number>) => number;
};

export const SCALE_DEFS: Record<string, ScaleDef> = {
  "VAS Dor": {
    id: "VAS Dor",
    title: "Escala de Dor (VAS)",
    description: "Avalie a dor do paciente no joelho.",
    maxScore: 10,
    questions: [
      { id: "vas", label: "Como o paciente avalia sua dor no joelho hoje? (0 = sem dor, 10 = pior dor imaginável)", type: "slider", min: 0, max: 10, step: 1 },
    ],
    calcScore: (a) => a["vas"] ?? 0,
  },

  "Tegner": {
    id: "Tegner",
    title: "Escala de Atividade de Tegner",
    description: "Selecione o nível de atividade física atual do paciente.",
    maxScore: 10,
    questions: [
      {
        id: "tegner",
        label: "Selecione o nível de atividade que melhor descreve a situação atual:",
        type: "radio",
        options: [
          { label: "0 — Licença por invalidez ou pensão devido ao joelho", value: 0 },
          { label: "1 — Atividades sedentárias; trabalho de escritório", value: 1 },
          { label: "2 — Atividades leves; caminhada em terreno plano", value: 2 },
          { label: "3 — Natação ou caminhada na floresta", value: 3 },
          { label: "4 — Ciclismo, ski alpino, jogging 2× por semana", value: 4 },
          { label: "5 — Jogging pelo menos 5× por semana; futebol recreativo", value: 5 },
          { label: "6 — Tênis, badminton; handebol recreativo; jogging (mín 1× sem)", value: 6 },
          { label: "7 — Futebol / handebol em nível de divisão mais baixa", value: 7 },
          { label: "8 — Futebol, handebol, squash (elite júnior ou master)", value: 8 },
          { label: "9 — Futebol, handebol, squash (divisão superior)", value: 9 },
          { label: "10 — Futebol ou handebol (nível nacional / internacional)", value: 10 },
        ],
      },
    ],
    calcScore: (a) => a["tegner"] ?? 0,
  },

  "Lysholm": {
    id: "Lysholm",
    title: "Escala de Lysholm",
    description: "8 perguntas sobre o joelho do paciente. Pontuação máxima: 100.",
    maxScore: 100,
    questions: [
      {
        id: "claudicacao",
        label: "1. Claudicação (mancada)",
        type: "radio",
        options: [
          { label: "Nenhuma", value: 5 },
          { label: "Leve ou periódica", value: 3 },
          { label: "Grave ou constante", value: 0 },
        ],
      },
      {
        id: "apoio",
        label: "2. Apoio",
        type: "radio",
        options: [
          { label: "Apoio completo sem suporte", value: 5 },
          { label: "Necessita de bengala ou muleta", value: 2 },
          { label: "Não consegue apoiar o peso", value: 0 },
        ],
      },
      {
        id: "bloqueio",
        label: "3. Bloqueio (travamento do joelho)",
        type: "radio",
        options: [
          { label: "Nenhum bloqueio", value: 15 },
          { label: "Bloqueio parcial ocasional", value: 10 },
          { label: "Bloqueio frequente", value: 6 },
          { label: "Articulação bloqueada no exame", value: 2 },
          { label: "Articulação bloqueada e fixada", value: 0 },
        ],
      },
      {
        id: "instabilidade",
        label: "4. Instabilidade (falseamento)",
        type: "radio",
        options: [
          { label: "Nunca", value: 25 },
          { label: "Raramente em atividades intensas ou esporte", value: 20 },
          { label: "Frequentemente em atividades intensas ou esporte", value: 15 },
          { label: "Ocasionalmente em atividades diárias", value: 10 },
          { label: "Frequentemente em atividades diárias", value: 5 },
          { label: "A cada passo", value: 0 },
        ],
      },
      {
        id: "dor",
        label: "5. Dor",
        type: "radio",
        options: [
          { label: "Nenhuma", value: 25 },
          { label: "Inconstante e leve com exercício intenso", value: 20 },
          { label: "Marcante com exercício intenso", value: 15 },
          { label: "Marcante após caminhada maior que 2 km", value: 10 },
          { label: "Marcante após caminhada menor que 2 km", value: 5 },
          { label: "Constante", value: 0 },
        ],
      },
      {
        id: "edema",
        label: "6. Edema (inchaço)",
        type: "radio",
        options: [
          { label: "Nenhum", value: 10 },
          { label: "Com esforço intenso", value: 6 },
          { label: "Com esforço moderado", value: 2 },
          { label: "Constante", value: 0 },
        ],
      },
      {
        id: "escadas",
        label: "7. Subir escadas",
        type: "radio",
        options: [
          { label: "Sem problema", value: 10 },
          { label: "Levemente comprometido", value: 6 },
          { label: "Um degrau por vez", value: 2 },
          { label: "Incapaz", value: 0 },
        ],
      },
      {
        id: "agachar",
        label: "8. Agachar",
        type: "radio",
        options: [
          { label: "Sem problema", value: 5 },
          { label: "Levemente comprometido", value: 4 },
          { label: "Não além de 90 graus", value: 2 },
          { label: "Incapaz", value: 0 },
        ],
      },
    ],
    calcScore: (a) =>
      (a["claudicacao"] ?? 0) + (a["apoio"] ?? 0) + (a["bloqueio"] ?? 0) +
      (a["instabilidade"] ?? 0) + (a["dor"] ?? 0) + (a["edema"] ?? 0) +
      (a["escadas"] ?? 0) + (a["agachar"] ?? 0),
  },

  "IKDC": {
    id: "IKDC",
    title: "IKDC Subjetivo do Joelho",
    description: "10 perguntas sobre nível de atividade, dor, rigidez e função. Resultado: 0–100.",
    maxScore: 100,
    questions: [
      {
        id: "atividade_dor",
        label: "1. Qual o mais alto nível de atividade que o paciente consegue realizar sem dor significativa?",
        type: "radio",
        options: [
          { label: "Atividades muito intensas (saltar, corte em esportes)", value: 4 },
          { label: "Atividades intensas (trabalho físico pesado, ski, tênis)", value: 3 },
          { label: "Atividades moderadas (trabalho físico moderado, corrida)", value: 2 },
          { label: "Atividades leves (caminhada, serviço doméstico leve)", value: 1 },
          { label: "Incapaz de realizar qualquer atividade", value: 0 },
        ],
      },
      {
        id: "dor_frequencia",
        label: "2. Com que frequência tem dor?",
        type: "radio",
        options: [
          { label: "Nunca", value: 10 },
          { label: "Raramente", value: 8 },
          { label: "Às vezes", value: 6 },
          { label: "Frequentemente", value: 4 },
          { label: "Sempre", value: 0 },
        ],
      },
      {
        id: "dor_intensidade",
        label: "3. Intensidade da dor (0 = sem dor, 10 = pior dor imaginável)",
        type: "slider",
        min: 0, max: 10, step: 1,
      },
      {
        id: "rigidez",
        label: "4. Grau de rigidez do joelho",
        type: "radio",
        options: [
          { label: "Nenhuma", value: 10 },
          { label: "Leve", value: 8 },
          { label: "Moderada", value: 6 },
          { label: "Grave", value: 2 },
          { label: "Extrema", value: 0 },
        ],
      },
      {
        id: "edema",
        label: "5. Com que frequência o joelho incha?",
        type: "radio",
        options: [
          { label: "Nunca", value: 10 },
          { label: "Raramente", value: 8 },
          { label: "Às vezes", value: 6 },
          { label: "Frequentemente", value: 4 },
          { label: "Sempre", value: 0 },
        ],
      },
      {
        id: "travamento",
        label: "6. O joelho trava ou bloqueia?",
        type: "radio",
        options: [
          { label: "Nunca", value: 15 },
          { label: "Raramente", value: 10 },
          { label: "Às vezes", value: 5 },
          { label: "Frequentemente", value: 2 },
          { label: "Sempre", value: 0 },
        ],
      },
      {
        id: "falseamento",
        label: "7. O joelho falha (cede)?",
        type: "radio",
        options: [
          { label: "Nunca", value: 15 },
          { label: "Raramente", value: 10 },
          { label: "Às vezes", value: 5 },
          { label: "Frequentemente", value: 2 },
          { label: "Sempre", value: 0 },
        ],
      },
      {
        id: "nivel_atual",
        label: "8. Qual o mais alto nível de atividade que consegue realizar ATUALMENTE?",
        type: "radio",
        options: [
          { label: "Atividades muito intensas", value: 4 },
          { label: "Atividades intensas", value: 3 },
          { label: "Atividades moderadas", value: 2 },
          { label: "Atividades leves", value: 1 },
          { label: "Incapaz", value: 0 },
        ],
      },
      {
        id: "funcao_geral",
        label: "9. Como classificaria o funcionamento do joelho HOJE? (0 = incapacidade total, 10 = normal)",
        type: "slider", min: 0, max: 10, step: 1,
      },
      {
        id: "funcao_pre",
        label: "10. Como classificaria o joelho ANTES DA LESÃO? (0 = incapacidade total, 10 = normal)",
        type: "slider", min: 0, max: 10, step: 1,
      },
    ],
    calcScore: (a) => {
      const dor = 10 - (a["dor_intensidade"] ?? 5);
      const raw =
        (a["atividade_dor"] ?? 0) + (a["dor_frequencia"] ?? 0) + dor +
        (a["rigidez"] ?? 0) + (a["edema"] ?? 0) + (a["travamento"] ?? 0) +
        (a["falseamento"] ?? 0) + (a["nivel_atual"] ?? 0) +
        (a["funcao_geral"] ?? 0) + (a["funcao_pre"] ?? 0);
      const max = 4 + 10 + 10 + 10 + 10 + 15 + 15 + 4 + 10 + 10;
      return Math.round((raw / max) * 100 * 10) / 10;
    },
  },

  "Kujala": {
    id: "Kujala",
    title: "Escala de Kujala (Dor Patelofemoral)",
    description: "13 perguntas sobre sua patela (rótula) e dor frontal do joelho. Pontuação máxima: 100.",
    maxScore: 100,
    questions: [
      { id: "claudicacao", label: "1. Claudicação", type: "radio", options: [{ label: "Nenhuma", value: 5 }, { label: "Leve / periódica", value: 3 }, { label: "Constante", value: 0 }] },
      { id: "apoio", label: "2. Apoio", type: "radio", options: [{ label: "Apoio completo", value: 5 }, { label: "Com bengala / muleta", value: 2 }, { label: "Não consegue apoiar", value: 0 }] },
      { id: "andar", label: "3. Caminhar", type: "radio", options: [{ label: "Ilimitado", value: 5 }, { label: "Mais de 2km", value: 3 }, { label: "1 a 2km", value: 2 }, { label: "Menos de 1km", value: 0 }] },
      { id: "escadas", label: "4. Subir escadas", type: "radio", options: [{ label: "Sem problema", value: 10 }, { label: "Leve dificuldade", value: 8 }, { label: "Muito devagar", value: 6 }, { label: "Menos de 10 degraus", value: 4 }, { label: "Incapaz", value: 0 }] },
      { id: "agachar", label: "5. Agachar", type: "radio", options: [{ label: "Sem problema", value: 5 }, { label: "Leve dificuldade", value: 4 }, { label: "Não além de 90°", value: 3 }, { label: "Leve flexão apenas", value: 2 }, { label: "Incapaz", value: 0 }] },
      { id: "correr", label: "6. Correr", type: "radio", options: [{ label: "Sem problema", value: 10 }, { label: "Dor após mais de 2km", value: 8 }, { label: "Dor após menos de 2km", value: 6 }, { label: "Dor após menos de 1km", value: 3 }, { label: "Sempre com dor", value: 0 }] },
      { id: "pular", label: "7. Pular", type: "radio", options: [{ label: "Sem problema", value: 10 }, { label: "Leve dificuldade", value: 7 }, { label: "Dificuldade moderada", value: 4 }, { label: "Apenas um salto", value: 2 }, { label: "Incapaz", value: 0 }] },
      { id: "ajoelhar", label: "8. Sentar com o joelho dobrado por longo período", type: "radio", options: [{ label: "Sem problema", value: 10 }, { label: "Dói após algum tempo", value: 8 }, { label: "Dói após menos de 30 minutos", value: 6 }, { label: "Dói imediatamente", value: 3 }, { label: "Incapaz", value: 0 }] },
      { id: "dor_frente", label: "9. Dor na parte frontal do joelho", type: "radio", options: [{ label: "Nenhuma", value: 10 }, { label: "Leve / ocasional", value: 8 }, { label: "Moderada / às vezes", value: 6 }, { label: "Grave / frequente", value: 3 }, { label: "Constante / intensa", value: 0 }] },
      { id: "edema", label: "10. Edema do joelho", type: "radio", options: [{ label: "Nenhum", value: 10 }, { label: "Após atividade intensa", value: 8 }, { label: "Após atividade moderada", value: 6 }, { label: "Após atividade leve", value: 3 }, { label: "Constante", value: 0 }] },
      { id: "luxacao", label: "11. Episódios de luxação ou subluxação da patela", type: "radio", options: [{ label: "Nunca", value: 10 }, { label: "1 episódio", value: 6 }, { label: "2 episódios", value: 4 }, { label: "3 ou mais episódios", value: 2 }, { label: "Com qualquer atividade", value: 0 }] },
      { id: "atrofia", label: "12. Atrofia da coxa (músculo)", type: "radio", options: [{ label: "Nenhuma", value: 5 }, { label: "Leve (1–2 cm)", value: 3 }, { label: "Grave (mais de 2 cm)", value: 0 }] },
      { id: "flexao", label: "13. Amplitude de flexão", type: "radio", options: [{ label: "Normal (mais de 130°)", value: 5 }, { label: "130° ou menos", value: 4 }, { label: "120° ou menos", value: 3 }, { label: "90° ou menos", value: 2 }, { label: "60° ou menos", value: 1 }] },
    ],
    calcScore: (a) => Object.values(a).reduce((sum, v) => sum + (v ?? 0), 0),
  },

  "ACL-RSI": {
    id: "ACL-RSI",
    title: "ACL-RSI — Prontidão Psicológica para Retorno ao Esporte",
    description: "12 afirmações avaliadas de 0 a 10 (0 = discordo completamente, 10 = concordo completamente). Resultado: 0–100.",
    maxScore: 100,
    questions: [
      { id: "medo_lesao", label: "1. Tenho medo de me machucar novamente quando retornar ao esporte.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "nervoso_esporte", label: "2. Fico nervoso(a) quando penso em praticar esportes com contato físico.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "confianca_suportar", label: "3. Tenho confiança de que meu joelho irá suportar o esforço do esporte.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "joelho_aguentara", label: "4. Acredito que meu joelho aguentará todas as exigências do esporte.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "nao_recuperado", label: "5. Sinto que meu joelho ainda não se recuperou completamente para o esporte.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "satisfeito_nivel", label: "6. Estou satisfeito(a) com meu nível atual de participação esportiva.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "frustracao_nivel", label: "7. É frustrante não conseguir competir no meu nível anterior.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "preocupacao_ceder", label: "8. Preocupo-me que meu joelho vá ceder durante a prática esportiva.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "seguro_dedicar", label: "9. Sinto-me seguro(a) para me dedicar totalmente ao esporte.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "nivel_anterior", label: "10. Acredito que voltarei ao meu nível de desempenho anterior.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "arriscado_retornar", label: "11. Acho que seria arriscado demais retornar ao esporte no meu estado atual.", type: "slider", min: 0, max: 10, step: 1 },
      { id: "animado_retorno", label: "12. Estou animado(a) com a perspectiva de retornar ao esporte.", type: "slider", min: 0, max: 10, step: 1 },
    ],
    calcScore: (a) => {
      const neg = ["medo_lesao", "nervoso_esporte", "nao_recuperado", "frustracao_nivel", "preocupacao_ceder", "arriscado_retornar"];
      const pos = ["confianca_suportar", "joelho_aguentara", "satisfeito_nivel", "seguro_dedicar", "nivel_anterior", "animado_retorno"];
      let total = 0, count = 0;
      for (const k of neg) { if (a[k] != null) { total += 10 - (a[k] ?? 0); count++; } }
      for (const k of pos) { if (a[k] != null) { total += a[k] ?? 0; count++; } }
      return count === 0 ? 0 : Math.round((total / count) * 10);
    },
  },

  "Marx": {
    id: "Marx",
    title: "Escala de Atividade de Marx",
    description: "4 perguntas sobre a frequência de atividades esportivas nos últimos 12 meses. Pontuação máxima: 16.",
    maxScore: 16,
    questions: [
      { id: "correr", label: "1. Correr", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Raramente (< 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (≥ 1× por semana)", value: 3 }, { label: "Diariamente", value: 4 }] },
      { id: "desacelerar", label: "2. Desacelerar bruscamente (parar de correr de forma repentina)", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Raramente (< 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (≥ 1× por semana)", value: 3 }, { label: "Diariamente", value: 4 }] },
      { id: "corte_lateral", label: "3. Corte lateral (mudar de direção bruscamente)", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Raramente (< 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (≥ 1× por semana)", value: 3 }, { label: "Diariamente", value: 4 }] },
      { id: "pivotar", label: "4. Girar (pivotar) sobre uma perna", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Raramente (< 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (≥ 1× por semana)", value: 3 }, { label: "Diariamente", value: 4 }] },
    ],
    calcScore: (a) => (a["correr"] ?? 0) + (a["desacelerar"] ?? 0) + (a["corte_lateral"] ?? 0) + (a["pivotar"] ?? 0),
  },

  "KOOS-12": {
    id: "KOOS-12",
    title: "KOOS-12 — Knee injury and Osteoarthritis Outcome Score",
    description: "12 perguntas sobre sintomas, dor, função e qualidade de vida do joelho na última semana. Resultado: 0–100 (100 = sem limitação). Fórmula: 100 − (soma × 100 / 48).",
    maxScore: 100,
    questions: [
      { id: "S1", label: "SINTOMAS — Com que frequência você sente sintomas no joelho (inchaço, estalido, sensação de travamento)?", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Raramente", value: 1 }, { label: "Às vezes", value: 2 }, { label: "Frequentemente", value: 3 }, { label: "Sempre", value: 4 }] },
      { id: "P1", label: "DOR — Com que frequência você sente dor no joelho?", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Mensalmente", value: 1 }, { label: "Semanalmente", value: 2 }, { label: "Diariamente", value: 3 }, { label: "Sempre", value: 4 }] },
      { id: "P2", label: "DOR — Ao subir ou descer escadas", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema", value: 4 }] },
      { id: "P3", label: "DOR — À noite na cama", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema", value: 4 }] },
      { id: "P4", label: "DOR — Ao sentar ou deitar", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema", value: 4 }] },
      { id: "A1", label: "FUNÇÃO — Subir escadas (dificuldade)", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema / impossível", value: 4 }] },
      { id: "A2", label: "FUNÇÃO — Levantar-se de uma cadeira", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema / impossível", value: 4 }] },
      { id: "A3", label: "FUNÇÃO — Dobrar completamente o joelho", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema / impossível", value: 4 }] },
      { id: "A4", label: "FUNÇÃO — Caminhar em terreno plano", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema / impossível", value: 4 }] },
      { id: "A5", label: "FUNÇÃO — Entrar e sair de um carro", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema / impossível", value: 4 }] },
      { id: "A6", label: "FUNÇÃO — Tarefas domésticas leves (cozinhar, limpar poeira, etc.)", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 3 }, { label: "Extrema / impossível", value: 4 }] },
      { id: "Q1", label: "QUALIDADE DE VIDA — Com que frequência seu joelho afeta sua vida?", type: "radio", options: [{ label: "Nunca", value: 0 }, { label: "Mensalmente", value: 1 }, { label: "Semanalmente", value: 2 }, { label: "Diariamente", value: 3 }, { label: "Constantemente", value: 4 }] },
    ],
    calcScore: (a) => {
      const sum = Object.values(a).reduce((acc, v) => acc + (v ?? 0), 0);
      return Math.round(100 - (sum * 100 / 48));
    },
  },
  "WOMAC": {
    id: "WOMAC",
    title: "WOMAC — Western Ontario and McMaster Universities",
    description: "24 perguntas sobre dor, rigidez e função. Resultado normalizado 0–100 (100 = sem limitação).",
    maxScore: 100,
    questions: [
      { id: "d1", label: "DOR 1. Ao caminhar em terreno plano", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "d2", label: "DOR 2. Ao subir ou descer escadas", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "d3", label: "DOR 3. À noite na cama", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "d4", label: "DOR 4. Ao sentar ou deitar", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "d5", label: "DOR 5. Em pé, com peso sobre o joelho", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "r1", label: "RIGIDEZ 6. Rigidez matinal (ao acordar)", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "r2", label: "RIGIDEZ 7. Rigidez após sentar, deitar ou repousar", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f1", label: "FUNÇÃO 8. Descer escadas", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f2", label: "FUNÇÃO 9. Subir escadas", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f3", label: "FUNÇÃO 10. Levantar de uma cadeira", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f4", label: "FUNÇÃO 11. Ficar em pé", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f5", label: "FUNÇÃO 12. Agachar", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f6", label: "FUNÇÃO 13. Caminhar em terreno plano", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f7", label: "FUNÇÃO 14. Entrar e sair do carro", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f8", label: "FUNÇÃO 15. Fazer compras", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f9", label: "FUNÇÃO 16. Calçar meias / meia-calça", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f10", label: "FUNÇÃO 17. Levantar da cama", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f11", label: "FUNÇÃO 18. Tirar meias / meia-calça", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f12", label: "FUNÇÃO 19. Deitar na cama", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f13", label: "FUNÇÃO 20. Entrar e sair da banheira", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f14", label: "FUNÇÃO 21. Sentar", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f15", label: "FUNÇÃO 22. Sentar e levantar do vaso sanitário", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f16", label: "FUNÇÃO 23. Realizar tarefas domésticas pesadas", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
      { id: "f17", label: "FUNÇÃO 24. Realizar tarefas domésticas leves", type: "radio", options: [{ label: "Nenhuma", value: 0 }, { label: "Pouca", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muitíssima", value: 4 }] },
    ],
    calcScore: (a) => {
      const sum = Object.values(a).reduce((acc, v) => acc + (v ?? 0), 0);
      return Math.round(100 - (sum / 96) * 100);
    },
  },
};

interface ScaleQuestionnaireDialogProps {
  scaleId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (score: number) => void;
}

export function ScaleQuestionnaireDialog({ scaleId, open, onClose, onConfirm }: ScaleQuestionnaireDialogProps) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(publicPatientFlowMessages);
  const scaleDefinition = SCALE_DEFS[scaleId];
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);

  if (!scaleDefinition) return null;
  // Scale IDs, question IDs and numeric option values are persisted clinical
  // data. Only their authored display text is substituted.
  const scale: ScaleDef = locale === "es" ? {
    ...scaleDefinition,
    title: surgicalScaleSpanish[`${scaleDefinition.id}.title`] ?? scaleDefinition.title,
    description: surgicalScaleSpanish[`${scaleDefinition.id}.description`] ?? scaleDefinition.description,
    questions: scaleDefinition.questions.map((question) => ({
      ...question,
      label: surgicalScaleSpanish[`${scaleDefinition.id}.${question.id}`] ?? question.label,
      options: question.options?.map((option) => ({
        ...option,
        label: surgicalScaleSpanish[`${scaleDefinition.id}.${question.id}.${option.value}`]
          ?? surgicalOptionSpanish[option.label]
          ?? option.label,
      })),
    })),
  } : scaleDefinition;

  const answeredCount = Object.keys(answers).length;
  const total = scale.questions.length;
  const allAnswered = answeredCount === total;
  const score = allAnswered ? scale.calcScore(answers) : null;

  const handleClose = () => {
    setAnswers({});
    setDone(false);
    onClose();
  };

  const handleConfirm = () => {
    if (score !== null) {
      onConfirm(score);
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            {scale.title}
          </DialogTitle>
          <DialogDescription>{scale.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1 mb-4">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("scalesProgress", { completed: answeredCount, total })}</span>
            {score !== null && (
              <span className="font-semibold text-primary">{t("score")}: {score} / {scale.maxScore}</span>
            )}
          </div>
          <Progress value={(answeredCount / total) * 100} className="h-1.5" />
        </div>

        <div className="space-y-6">
          {scale.questions.map((q) => (
            <div key={q.id} className="space-y-2">
              <Label className={`text-sm font-medium leading-snug ${answers[q.id] !== undefined ? "text-foreground" : "text-muted-foreground"}`}>
                {answers[q.id] !== undefined && <CheckCircle2 className="inline h-3.5 w-3.5 text-green-500 mr-1" />}
                {q.label}
              </Label>

              {q.type === "radio" && q.options && (
                <div className="space-y-1.5 pl-1">
                  {q.options.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm
                        ${answers[q.id] === opt.value
                          ? "bg-primary/10 border-primary text-primary font-medium"
                          : "border-border hover:bg-muted/50"}`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        className="mt-0.5 accent-primary shrink-0"
                        checked={answers[q.id] === opt.value}
                        onChange={() => setAnswers(prev => ({ ...prev, [q.id]: opt.value }))}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}

              {q.type === "slider" && (
                <div className="pl-1 space-y-2">
                  <Slider
                    min={q.min ?? 0}
                    max={q.max ?? 10}
                    step={q.step ?? 1}
                    value={[answers[q.id] ?? Math.floor((q.max ?? 10) / 2)]}
                    onValueChange={([v]) => setAnswers(prev => ({ ...prev, [q.id]: v }))}
                    className="mt-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{q.min ?? 0}</span>
                    <span className="font-bold text-primary text-sm">{answers[q.id] ?? "—"}</span>
                    <span>{q.max ?? 10}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {allAnswered && score !== null && (
          <div className="mt-6 p-4 rounded-xl bg-primary/5 border border-primary/20 text-center space-y-1">
            <p className="text-sm text-muted-foreground">{t("calculatedScore")}</p>
            <p className="text-3xl font-bold text-primary">{score} <span className="text-base font-normal text-muted-foreground">/ {scale.maxScore}</span></p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={handleClose}>{t("cancel")}</Button>
          <Button onClick={handleConfirm} disabled={!allAnswered}>
            {t("useScore", { score: score ?? "—" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
