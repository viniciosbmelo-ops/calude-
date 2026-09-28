import type { ScopedMessages } from "@/lib/i18n";

export const xrayPlanningMessages = {
  "pt-BR": {
    title: "Planejamento por Imagem",
    mobileDescription: "Analise radiografias sem vincular a procedimento",
    description: "Analise radiografias de forma rápida, sem necessidade de vincular a um paciente ou procedimento.",
    panoramicTab: "📐 RX Panorâmico",
    ptsTab: "📏 RX Perfil — PTS",
    panoramicDescription: "RX Panorâmico — Eixo mecânico, aLDFA, aMPTA, JLCA, MAD, WBL e planejamento de osteotomia.",
    ptsDescription: "RX Perfil — Slope Tibial Posterior (PTS) com QC de malrotação. Indicado em revisão de LCA e planejamento de osteotomia de redução de slope (SRO).",
  },
  es: {
    title: "Planificación por imagen",
    mobileDescription: "Analice radiografías sin vincularlas a un procedimiento",
    description: "Analice radiografías rápidamente, sin necesidad de vincularlas a un paciente o procedimiento.",
    panoramicTab: "📐 RX Panorámica",
    ptsTab: "📏 RX Perfil — PTS",
    panoramicDescription: "RX Panorámica — Eje mecánico, aLDFA, aMPTA, JLCA, MAD, WBL y planificación de osteotomía.",
    ptsDescription: "RX Perfil — Pendiente tibial posterior (PTS) con control de calidad de malrotación. Indicada en revisión de LCA y planificación de osteotomía de reducción de pendiente (SRO).",
  },
} satisfies ScopedMessages<Record<string, string>>;