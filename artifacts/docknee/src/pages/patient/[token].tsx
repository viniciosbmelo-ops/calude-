import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { CheckCircle2, ChevronRight, Loader2, Lock, ClipboardList } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { normalizeDoctorLocale, publicPatientFlowMessages, surgicalOptionSpanish, surgicalScaleSpanish } from "@/locales/public-patient-flows";

// ─── Scale definitions ────────────────────────────────────────────────────────

type ScaleQuestion = {
  id: string;
  label: string;
  type: "radio" | "slider" | "select";
  options?: { label: string; value: number }[];
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

export function displayScale(def: ScaleDef, locale: "pt-BR" | "es"): ScaleDef {
  if (locale !== "es") return def;
  return {
    ...def,
    title: surgicalScaleSpanish[`${def.id}.title`] ?? def.title,
    description: surgicalScaleSpanish[`${def.id}.description`] ?? def.description,
    questions: def.questions.map((question) => ({
      ...question,
      label: surgicalScaleSpanish[`${def.id}.${question.id}`] ?? question.label,
      options: question.options?.map((option) => ({
        ...option,
        label: surgicalScaleSpanish[`${def.id}.${question.id}.${option.value}`] ?? surgicalOptionSpanish[option.label] ?? option.label,
      })),
    })),
  };
}

export const SCALES: Record<string, ScaleDef> = {
  "VAS Dor": {
    id: "VAS Dor",
    title: "Escala de Dor (VAS)",
    description: "Avalie sua dor no joelho. Mova o controle deslizante para indicar o nível de dor.",
    maxScore: 10,
    questions: [
      {
        id: "vas",
        label: "Como você avalia sua dor no joelho hoje? (0 = sem dor, 10 = pior dor imaginável)",
        type: "slider",
        min: 0,
        max: 10,
        step: 1,
      },
    ],
    calcScore: (a) => a["vas"] ?? 0,
  },

  "Tegner": {
    id: "Tegner",
    title: "Escala de Atividade de Tegner",
    description: "Selecione o nível de atividade física que mais se aproxima da sua situação atual.",
    maxScore: 10,
    questions: [
      {
        id: "tegner",
        label: "Selecione o nível de atividade que descreve melhor sua situação atual:",
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
    description: "Responda às perguntas sobre seu joelho nas últimas semanas.",
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
          { label: "Marcante após caminhada maior que 2km", value: 10 },
          { label: "Marcante após caminhada menor que 2km", value: 5 },
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
      (a["claudicacao"] ?? 0) +
      (a["apoio"] ?? 0) +
      (a["bloqueio"] ?? 0) +
      (a["instabilidade"] ?? 0) +
      (a["dor"] ?? 0) +
      (a["edema"] ?? 0) +
      (a["escadas"] ?? 0) +
      (a["agachar"] ?? 0),
  },

  "IKDC": {
    id: "IKDC",
    title: "IKDC Subjetivo do Joelho",
    description: "Responda às perguntas considerando sua situação atual do joelho.",
    maxScore: 100,
    questions: [
      {
        id: "atividade_atual",
        label: "1. Qual o mais alto nível de atividade que você consegue realizar sem dor significativa?",
        type: "radio",
        options: [
          { label: "Atividades muito intensas (saltar, corte em esportes como basquete, futebol)", value: 4 },
          { label: "Atividades intensas (trabalho físico pesado, ski, tênis)", value: 3 },
          { label: "Atividades moderadas (trabalho físico moderado, corrida)", value: 2 },
          { label: "Atividades leves (caminhada, serviço doméstico leve)", value: 1 },
          { label: "Incapaz de realizar qualquer atividade citada acima", value: 0 },
        ],
      },
      {
        id: "dor_frequencia",
        label: "2. Com que frequência você tem dor?",
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
        label: "3. Se você sente dor, qual a intensidade? (0 = sem dor, 10 = pior dor imaginável)",
        type: "slider",
        min: 0,
        max: 10,
        step: 1,
      },
      {
        id: "rigidez",
        label: "4. Qual o grau de rigidez do seu joelho?",
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
        label: "6. Seu joelho trava ou bloqueia?",
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
        label: "7. Seu joelho falha (cede)?",
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
        id: "nivel_atual_atividade",
        label: "8. Qual o mais alto nível de atividade que você consegue realizar ATUALMENTE?",
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
        label: "9. Como você classificaria o funcionamento do seu joelho em uma escala de 0 a 10? (0 = incapacidade total, 10 = funcionamento normal)",
        type: "slider",
        min: 0,
        max: 10,
        step: 1,
      },
      {
        id: "funcao_esporte",
        label: "10. Como você classificaria o seu joelho ANTES DA LESÃO? (0 = incapacidade total, 10 = normal)",
        type: "slider",
        min: 0,
        max: 10,
        step: 1,
      },
    ],
    calcScore: (a) => {
      const dor = 10 - (a["dor_intensidade"] ?? 5);
      const funcGeral = a["funcao_geral"] ?? 0;
      const funcEsporte = a["funcao_esporte"] ?? 0;
      const rawPoints =
        (a["atividade_atual"] ?? 0) +
        (a["dor_frequencia"] ?? 0) +
        dor +
        (a["rigidez"] ?? 0) +
        (a["edema"] ?? 0) +
        (a["travamento"] ?? 0) +
        (a["falseamento"] ?? 0) +
        (a["nivel_atual_atividade"] ?? 0) +
        funcGeral +
        funcEsporte;
      const maxRaw = 4 + 10 + 10 + 10 + 10 + 15 + 15 + 4 + 10 + 10;
      return Math.round((rawPoints / maxRaw) * 100);
    },
  },

  "Kujala": {
    id: "Kujala",
    title: "Escala de Kujala (Dor Patelofemoral)",
    description: "Responda às perguntas sobre sua patela (rótula) e dor frontal do joelho.",
    maxScore: 100,
    questions: [
      { id: "claudicacao", label: "1. Claudicação", type: "radio", options: [{ label: "Nenhuma", value: 5 }, { label: "Leve / periódica", value: 3 }, { label: "Constante", value: 0 }] },
      { id: "apoio", label: "2. Apoio", type: "radio", options: [{ label: "Apoio completo", value: 5 }, { label: "Apoio com bengala / muleta", value: 2 }, { label: "Não consegue apoiar", value: 0 }] },
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
    description: "Responda sobre como você se sente em relação ao retorno ao esporte. Avalie cada afirmação de 0 a 10, onde 0 = discordo completamente e 10 = concordo completamente.",
    maxScore: 100,
    questions: [
      { id: "medo_lesao", label: "1. Tenho medo de me machucar novamente quando retornar ao esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "nervoso_esporte", label: "2. Fico nervoso(a) quando penso em praticar esportes com contato físico.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "confianca_suportar", label: "3. Tenho confiança de que meu joelho irá suportar o esforço do esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "joelho_aguentara", label: "4. Acredito que meu joelho aguentará todas as exigências do esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "nao_recuperado", label: "5. Sinto que meu joelho ainda não se recuperou completamente para o esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "satisfeito_nivel", label: "6. Estou satisfeito(a) com meu nível atual de participação esportiva.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "frustracao_nivel", label: "7. É frustrante não conseguir competir no meu nível anterior.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "preocupacao_ceder", label: "8. Preocupo-me que meu joelho vá ceder durante a prática esportiva.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "seguro_dedicar", label: "9. Sinto-me seguro(a) para me dedicar totalmente ao esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "nivel_anterior", label: "10. Acredito que voltarei ao meu nível de desempenho anterior quando retornar ao esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "arriscado_retornar", label: "11. Acho que seria arriscado demais retornar ao esporte no meu estado atual.", type: "slider" as const, min: 0, max: 10, step: 1 },
      { id: "animado_retorno", label: "12. Estou animado(a) com a perspectiva de retornar ao esporte.", type: "slider" as const, min: 0, max: 10, step: 1 },
    ],
    calcScore: (a) => {
      const negative = ["medo_lesao", "nervoso_esporte", "nao_recuperado", "frustracao_nivel", "preocupacao_ceder", "arriscado_retornar"];
      const positive = ["confianca_suportar", "joelho_aguentara", "satisfeito_nivel", "seguro_dedicar", "nivel_anterior", "animado_retorno"];
      let total = 0; let count = 0;
      for (const k of negative) { if (a[k] != null) { total += (10 - (a[k] ?? 0)); count++; } }
      for (const k of positive) { if (a[k] != null) { total += (a[k] ?? 0); count++; } }
      if (count === 0) return 0;
      return Math.round((total / count) * 10);
    },
  },

  "Marx": {
    id: "Marx",
    title: "Escala de Atividade de Marx",
    description: "Considerando os últimos 12 meses, com que frequência você realizou as atividades abaixo durante seu esporte ou atividade física principal?",
    maxScore: 16,
    questions: [
      { id: "correr", label: "1. Correr", type: "radio" as const, options: [{ label: "Nunca", value: 0 }, { label: "Raramente (menos de 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (1× por semana ou mais)", value: 3 }, { label: "Diariamente (todos os dias)", value: 4 }] },
      { id: "desacelerar", label: "2. Desacelerar bruscamente (parar de correr de forma repentina)", type: "radio" as const, options: [{ label: "Nunca", value: 0 }, { label: "Raramente (menos de 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (1× por semana ou mais)", value: 3 }, { label: "Diariamente (todos os dias)", value: 4 }] },
      { id: "corte_lateral", label: "3. Realizar corte lateral (mudar de direção bruscamente)", type: "radio" as const, options: [{ label: "Nunca", value: 0 }, { label: "Raramente (menos de 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (1× por semana ou mais)", value: 3 }, { label: "Diariamente (todos os dias)", value: 4 }] },
      { id: "pivotar", label: "4. Girar (pivotar) sobre uma perna", type: "radio" as const, options: [{ label: "Nunca", value: 0 }, { label: "Raramente (menos de 1× por mês)", value: 1 }, { label: "Às vezes (1–3× por mês)", value: 2 }, { label: "Frequentemente (1× por semana ou mais)", value: 3 }, { label: "Diariamente (todos os dias)", value: 4 }] },
    ],
    calcScore: (a) => (a["correr"] ?? 0) + (a["desacelerar"] ?? 0) + (a["corte_lateral"] ?? 0) + (a["pivotar"] ?? 0),
  },

  "KOOS-12": {
    id: "KOOS-12",
    title: "KOOS-12 — Lesão do Joelho e Osteoartrose",
    description: "Responda às perguntas considerando seu joelho NA ÚLTIMA SEMANA. Indique o grau de dificuldade ou problema.",
    maxScore: 100,
    questions: [
      { id: "dor_freq", label: "1. Com que frequência seu joelho dói?", type: "radio" as const, options: [{ label: "Nunca", value: 4 }, { label: "Raramente", value: 3 }, { label: "Às vezes", value: 2 }, { label: "Frequentemente", value: 1 }, { label: "Sempre", value: 0 }] },
      { id: "dor_torcao", label: "2. Dor ao torcer/girar o joelho", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema", value: 0 }] },
      { id: "dor_extensao", label: "3. Dor ao estender completamente o joelho", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema", value: 0 }] },
      { id: "rigidez_manha", label: "4. Rigidez matinal do joelho (ao acordar)", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema", value: 0 }] },
      { id: "rigidez_tarde", label: "5. Rigidez após sentar, deitar ou descansar o joelho", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema", value: 0 }] },
      { id: "adl_escadas", label: "6. Dificuldade para subir escadas", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema/impossível", value: 0 }] },
      { id: "adl_levantar", label: "7. Dificuldade para se levantar da cadeira", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema/impossível", value: 0 }] },
      { id: "adl_caminhar", label: "8. Dificuldade para caminhar em superfície plana", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema/impossível", value: 0 }] },
      { id: "sport_agachar", label: "9. Dificuldade para agachar", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema/impossível", value: 0 }] },
      { id: "sport_correr", label: "10. Dificuldade para correr", type: "radio" as const, options: [{ label: "Nenhuma", value: 4 }, { label: "Leve", value: 3 }, { label: "Moderada", value: 2 }, { label: "Grave", value: 1 }, { label: "Extrema/impossível", value: 0 }] },
      { id: "qol_consciente", label: "11. Com que frequência você está consciente do problema no seu joelho?", type: "radio" as const, options: [{ label: "Nunca", value: 4 }, { label: "Raramente", value: 3 }, { label: "Às vezes", value: 2 }, { label: "Frequentemente", value: 1 }, { label: "Sempre", value: 0 }] },
      { id: "qol_modificou", label: "12. Você modificou seu estilo de vida para evitar atividades potencialmente prejudiciais ao joelho?", type: "radio" as const, options: [{ label: "De forma alguma", value: 4 }, { label: "Levemente", value: 3 }, { label: "Moderadamente", value: 2 }, { label: "Muito", value: 1 }, { label: "Totalmente", value: 0 }] },
    ],
    calcScore: (a) => {
      const keys = ["dor_freq","dor_torcao","dor_extensao","rigidez_manha","rigidez_tarde","adl_escadas","adl_levantar","adl_caminhar","sport_agachar","sport_correr","qol_consciente","qol_modificou"];
      const total = keys.reduce((s, k) => s + (a[k] ?? 0), 0);
      return Math.round((total / (keys.length * 4)) * 100);
    },
  },

  "WOMAC": {
    id: "WOMAC",
    title: "WOMAC — Índice de Osteoartrite",
    description: "Avalie seu joelho nas últimas 48 horas. As perguntas referem-se à intensidade de dor, rigidez e dificuldade física.",
    maxScore: 100,
    questions: [
      { id: "dor_caminhar", label: "DOR 1. Ao caminhar em superfície plana", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "dor_escadas", label: "DOR 2. Ao subir ou descer escadas", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "dor_noite", label: "DOR 3. À noite (ao dormir)", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "dor_repouso", label: "DOR 4. Em repouso (sentado ou deitado)", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "dor_carga", label: "DOR 5. Ao apoiar o peso no joelho", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "rig_manha", label: "RIGIDEZ 1. Rigidez matinal (ao acordar)", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "rig_tarde", label: "RIGIDEZ 2. Rigidez após sentar, deitar ou descansar", type: "radio" as const, options: [{ label: "Nenhuma", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa", value: 4 }] },
      { id: "fis_descer", label: "FUNÇÃO 1. Descer escadas", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_subir", label: "FUNÇÃO 2. Subir escadas", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_levantar", label: "FUNÇÃO 3. Levantar-se de uma cadeira ou cama", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_ficar_pe", label: "FUNÇÃO 4. Ficar em pé", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_caminhar", label: "FUNÇÃO 5. Caminhar em superfície plana", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_carro", label: "FUNÇÃO 6. Entrar e sair de um carro", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_compras", label: "FUNÇÃO 7. Fazer compras", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_meias", label: "FUNÇÃO 8. Colocar meias ou meia-calça", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_cama", label: "FUNÇÃO 9. Deitar e levantar da cama", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_banho", label: "FUNÇÃO 10. Entrar e sair do banho/banheira", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_sentado", label: "FUNÇÃO 11. Ficar sentado", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_vaso", label: "FUNÇÃO 12. Sentar e levantar do vaso sanitário", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_tarefas", label: "FUNÇÃO 13. Tarefas domésticas pesadas", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
      { id: "fis_tarefas_leves", label: "FUNÇÃO 14. Tarefas domésticas leves", type: "radio" as const, options: [{ label: "Nenhuma dificuldade", value: 0 }, { label: "Leve", value: 1 }, { label: "Moderada", value: 2 }, { label: "Intensa", value: 3 }, { label: "Muito intensa/impossível", value: 4 }] },
    ],
    calcScore: (a) => {
      const keys = ["dor_caminhar","dor_escadas","dor_noite","dor_repouso","dor_carga","rig_manha","rig_tarde","fis_descer","fis_subir","fis_levantar","fis_ficar_pe","fis_caminhar","fis_carro","fis_compras","fis_meias","fis_cama","fis_banho","fis_sentado","fis_vaso","fis_tarefas","fis_tarefas_leves"];
      const total = keys.reduce((s, k) => s + (a[k] ?? 0), 0);
      return Math.round(100 - (total / (keys.length * 4)) * 100);
    },
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PatientInfo = {
  tempo: string;
  escalasEnviadas: string[];
  completedScales: string[];
  noScales?: boolean;
  doctorLocale?: "pt-BR" | "es";
};

async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// ─── CPF Gate Screen ──────────────────────────────────────────────────────────

function CpfGate({ token, onVerified }: { token: string; onVerified: (info: PatientInfo) => void }) {
  const t = useScopedTranslations(publicPatientFlowMessages);
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const formatCpf = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpf.trim()) { setError(t("enterCpf")); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/patient/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cpf }),
      });
      const data = await readJsonSafely(res);
      if (!res.ok || !data.ok) {
        // API errors are authored by the server and may be in its default
        // language. Keep this public flow in the token owner's locale.
        setError(t("incorrectCpf"));
      } else {
        onVerified(data as unknown as PatientInfo);
      }
    } catch {
      setError(t("connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-2">
            <ClipboardList className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">DocSholder</h1>
          <p className="text-muted-foreground text-sm">{t("surgicalQuestionnaires")}</p>
        </div>

        <Card className="shadow-md border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary" />
              {t("accessProtected")}
            </CardTitle>
            <CardDescription>
              {t("cpfInstructions")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cpf">{t("cpfLabel")}</Label>
                <Input
                  id="cpf"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={(e) => {
                    setCpf(formatCpf(e.target.value));
                    setError("");
                  }}
                  className={error ? "border-destructive" : ""}
                  autoComplete="off"
                  inputMode="numeric"
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                {loading ? t("verifying") : t("accessQuestionnaires")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {t("contactResponsible")}
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function PatientScalesPage() {
  const params = useParams();
  const token = params.token || "";
  const { beginTemporaryDisplayLanguage, locale } = useLanguage();
  const t = useScopedTranslations(publicPatientFlowMessages);

  const [verified, setVerified] = useState(false);
  const [info, setInfo] = useState<PatientInfo | null>(null);
  const [localeReady, setLocaleReady] = useState(false);
  const [bootstrapInvalid, setBootstrapInvalid] = useState(false);

  const [currentScaleIdx, setCurrentScaleIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [allDone, setAllDone] = useState(false);

  // Bootstrap determines the locale from the doctor who owns this link. The
  // browser never supplies a locale to the API.
  useEffect(() => {
    if (!token) {
      setBootstrapInvalid(true);
      setLocaleReady(true);
      return;
    }
    let mounted = true;
    let releaseDisplayLanguage: (() => void) | undefined;

    void fetch(`/api/patient/${token}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("invalid-patient-token");
        return readJsonSafely(response);
      })
      .then((data) => {
        if (!mounted) return;
        if (data.doctorLocale !== "pt-BR" && data.doctorLocale !== "es") {
          throw new Error("invalid-patient-bootstrap");
        }
        releaseDisplayLanguage = beginTemporaryDisplayLanguage(data.doctorLocale);
        setLocaleReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setBootstrapInvalid(true);
        setLocaleReady(true);
      });

    return () => {
      mounted = false;
      releaseDisplayLanguage?.();
    };
  }, [beginTemporaryDisplayLanguage, token]);

  // Auto-initialize slider answers to 0 (min) when changing scales so the
  // submit button is not blocked by an "unanswered" slider that visually shows a value.
  useEffect(() => {
    if (!info) return;
    const scaleName = info.escalasEnviadas[currentScaleIdx];
    const def = SCALES[scaleName];
    if (!def) return;
    const init: Record<string, number> = {};
    def.questions.forEach(q => {
      if (q.type === "slider") init[q.id] = q.min ?? 0;
    });
    setAnswers(init);
    setSubmitError("");
  }, [currentScaleIdx, info]);

  // Skip to the next defined+pending scale whenever the current one is missing
  // from SCALES (unknown scale sent by doctor) to avoid an infinite render loop.
  useEffect(() => {
    if (!info) return;
    const scaleName = info.escalasEnviadas[currentScaleIdx];
    if (!scaleName) return;
    if (!SCALES[scaleName] && !completed.includes(scaleName)) {
      const next = info.escalasEnviadas.findIndex(
        (e, i) => i !== currentScaleIdx && !completed.includes(e) && SCALES[e]
      );
      if (next !== -1) setCurrentScaleIdx(next);
      else setAllDone(true);
    }
  }, [currentScaleIdx, completed, info]);

  const handleVerified = (data: PatientInfo) => {
    const scales = data.escalasEnviadas || [];
    const completedScales = data.completedScales || [];
    setInfo(data);
    setCompleted(completedScales);
    const firstPending = scales.findIndex(
      (e: string) => !completedScales.includes(e)
    );
    setCurrentScaleIdx(Math.max(0, firstPending));
    if (scales.length > 0 && scales.every((e: string) => completedScales.includes(e))) {
      setAllDone(true);
    }
    setVerified(true);
  };

  if (!localeReady) {
    const safeFallback = publicPatientFlowMessages["pt-BR"];
    return (
      <div className="min-h-screen flex items-center justify-center p-4" aria-busy="true">
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {safeFallback.loadingQuestionnaires}
        </div>
      </div>
    );
  }

  if (bootstrapInvalid) {
    const safeFallback = publicPatientFlowMessages["pt-BR"];
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-2">
            <p className="text-destructive font-medium">{safeFallback.invalidLink}</p>
            <p className="text-sm text-muted-foreground">{safeFallback.invalidLinkContactDoctor}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verified) {
    return <CpfGate token={token} onVerified={handleVerified} />;
  }

  // Verified but no scales configured yet
  if (info?.noScales || (info?.escalasEnviadas?.length === 0)) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-md">
          <CardContent className="pt-10 pb-8 space-y-4 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                <ClipboardList className="h-8 w-8 text-amber-500" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t("accessProtected")}</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {t("questionnairesPreparing")}
                <br />
                {t("waitAndAccessAgain")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              {t("contactOffice")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!info) return null;

  const pendingScales = info.escalasEnviadas.filter(e => !completed.includes(e));
  const currentScaleName = info.escalasEnviadas[currentScaleIdx];
  const currentScaleDef = SCALES[currentScaleName];
  const currentDisplayScaleDef = currentScaleDef && displayScale(currentScaleDef, locale);

  const handleAnswerChange = (questionId: string, value: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const isCurrentScaleComplete = () => {
    if (!currentScaleDef) return false;
    return currentScaleDef.questions.every(q => answers[q.id] !== undefined);
  };

  const handleSubmitScale = async () => {
    if (!currentScaleDef || !isCurrentScaleComplete()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const score = currentScaleDef.calcScore(answers);
      const res = await fetch(`/api/patient/${token}/scale/${encodeURIComponent(currentScaleName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ respostas: answers, score }),
      });
      const data = await readJsonSafely(res);
      if (!res.ok || data.ok !== true) {
        // Do not surface a server-authored fallback that can be Portuguese
        // for a Spanish token owner.
        setSubmitError(t("submitAnswersError"));
        return;
      }
      if (data.ok === true) {
        const newCompleted = [...completed, currentScaleName];
        setCompleted(newCompleted);
        setAnswers({});
        if (data.allCompleted || newCompleted.length === info.escalasEnviadas.length) {
          setAllDone(true);
        } else {
          const nextPending = info.escalasEnviadas.findIndex(
            e => !newCompleted.includes(e)
          );
          if (nextPending !== -1) setCurrentScaleIdx(nextPending);
        }
      }
    } catch {
      setSubmitError(t("internetConnectionError"));
    } finally {
      setSubmitting(false);
    }
  };

  const completedCount = completed.length;
  const totalCount = info.escalasEnviadas.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  if (allDone) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center shadow-md">
          <CardContent className="pt-10 pb-8 space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-green-700">{t("completed")}</h2>
              <p className="text-muted-foreground mt-1 text-sm whitespace-pre-line">
                {t("completionDescription", { total: totalCount, plural: totalCount !== 1 ? "s" : "" })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentScaleDef || !currentDisplayScaleDef || completed.includes(currentScaleName)) {
    const nextIdx = info.escalasEnviadas.findIndex(e => !completed.includes(e));
    if (nextIdx !== -1) {
      setCurrentScaleIdx(nextIdx);
      return null;
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-16">
        {/* Header */}
        <div className="pt-6 text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground">DocSholder</h1>
        </div>

        {/* Progress */}
        <Card className="shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>{t("progress")}</span>
              <span>{t("scalesProgress", { completed: completedCount, total: totalCount })}</span>
            </div>
            <Progress
              value={progressPct}
              className="h-2"
              aria-label={t("scalesProgress", { completed: completedCount, total: totalCount })}
              aria-valuetext={t("scalesProgress", { completed: completedCount, total: totalCount })}
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {info.escalasEnviadas.map(name => {
                const scale = SCALES[name];
                const displayName = scale ? displayScale(scale, locale).title : name;
                return (
                  <span
                    key={name}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      completed.includes(name)
                        ? "bg-green-100 text-green-700"
                        : name === currentScaleName
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {displayName}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Current Scale */}
        <Card className="shadow-md">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{currentDisplayScaleDef.title}</CardTitle>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                {t("scalePosition", { current: currentScaleIdx + 1, total: totalCount })}
              </span>
            </div>
            <CardDescription>{currentDisplayScaleDef.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentDisplayScaleDef.questions.map((question) => (
              <div key={question.id} className="space-y-3">
                <p className="text-sm font-medium leading-relaxed">{question.label}</p>

                {question.type === "radio" && question.options && (
                  <div className="space-y-2">
                    {question.options.map((option) => (
                      <label
                        key={option.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          answers[question.id] === option.value
                            ? "bg-primary/10 border-primary"
                            : "bg-background border-border hover:bg-muted/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option.value}
                          checked={answers[question.id] === option.value}
                          onChange={() => handleAnswerChange(question.id, option.value)}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="text-sm">{option.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {question.type === "slider" && (
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs text-muted-foreground px-1">
                      <span>{question.min ?? 0}</span>
                      <span className="text-base font-bold text-primary">
                        {answers[question.id] ?? Math.round(((question.max ?? 10) - (question.min ?? 0)) / 2)}
                      </span>
                      <span>{question.max ?? 10}</span>
                    </div>
                    <Slider
                      min={question.min ?? 0}
                      max={question.max ?? 10}
                      step={question.step ?? 1}
                      value={[answers[question.id] ?? Math.round(((question.max ?? 10) - (question.min ?? 0)) / 2)]}
                      onValueChange={(vals) => handleAnswerChange(question.id, vals[0])}
                      className="w-full"
                      aria-label={question.label}
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="pt-4 border-t space-y-2">
              {submitError && (
                <p className="text-center text-xs text-destructive font-medium">{submitError}</p>
              )}
              <Button
                onClick={handleSubmitScale}
                disabled={!isCurrentScaleComplete() || submitting}
                className="w-full gap-2"
                size="lg"
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("sending")}</>
                  : pendingScales.length > 1
                  ? <><ChevronRight className="h-4 w-4" /> {t("next")}</>
                  : <><CheckCircle2 className="h-4 w-4" /> {t("finish")}</>
                }
              </Button>
              {!isCurrentScaleComplete() && (
                <p className="text-center text-xs text-muted-foreground mt-2">
                  {t("answerAllQuestions")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
