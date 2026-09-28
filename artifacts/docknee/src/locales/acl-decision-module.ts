import type { ScopedMessages } from "@/lib/i18n";

export const aclDecisionMessages = {
  "pt-BR": {
    description: "Suporte à decisão sobre reforço extra-articular (LET/LAL) com base em fatores clínicos, de exame e de imagem. Baseado no Consenso Delphi de Berthran et al. e no Algoritmo da ESSKA 2026.",
    calculating: "Calculando...", calculate: "Calcular Decisão LEAP", additionalFactors: "Fatores adicionais para o cálculo ({state})", hide: "ocultar", show: "exibir",
    delay: "Atraso cirúrgico (dias desde a lesão)", delayPlaceholder: "ex: 90", tunnel: "Túnel Ósseo Comprometido (revisão)", allograft: "Aloenxerto em Paciente Jovem (revisão)", isolatedAcl: "Considerar Conduta de LCA Isolada (sem reforço) na Revisão",
    error: "Erro ao calcular Módulo de Decisão do LCA", indication: "Indicação de Reforço Extra-Articular (LEAP)", indicated: "Indicado", notIndicated: "Não indicado pelas regras atuais", accessoryFactors: "Fatores Acessórios Presentes", lever: "Alavanca:", contraindicated: "Contraindicado/limitado se:",
    leap: "LEAP — Reforço Extra-Articular", pts: "Slope Tibial Posterior", graft: "Escolha de Enxerto", revision: "Revisão de LCA", behavioral: "Fatores Comportamentais",
  },
  es: {
    description: "Apoyo a la decisión sobre refuerzo extraarticular (LET/LAL) basado en factores clínicos, de exploración y de imagen. Basado en el Consenso Delphi de Berthran et al. y el Algoritmo ESSKA 2026.",
    calculating: "Calculando...", calculate: "Calcular decisión LEAP", additionalFactors: "Factores adicionales para el cálculo ({state})", hide: "ocultar", show: "mostrar",
    delay: "Retraso quirúrgico (días desde la lesión)", delayPlaceholder: "p. ej.: 90", tunnel: "Túnel óseo comprometido (revisión)", allograft: "Aloinjerto en paciente joven (revisión)", isolatedAcl: "Considerar conducta de LCA aislado (sin refuerzo) en la revisión",
    error: "Error al calcular el módulo de decisión del LCA", indication: "Indicación de refuerzo extraarticular (LEAP)", indicated: "Indicado", notIndicated: "No indicado por las reglas actuales", accessoryFactors: "Factores accesorios presentes", lever: "Palanca:", contraindicated: "Contraindicado/limitado si:",
    leap: "LEAP — Refuerzo extraarticular", pts: "Pendiente tibial posterior", graft: "Elección de injerto", revision: "Revisión de LCA", behavioral: "Factores conductuales",
  },
} satisfies ScopedMessages<Record<string, string>>;