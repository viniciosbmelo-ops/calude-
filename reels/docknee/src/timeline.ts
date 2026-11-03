import { linearTiming, springTiming } from "@remotion/transitions";

export const FPS = 30;

// On-screen span of each scene (seconds * fps). Sum must equal 1800 (60s).
export const SPANS = {
  hook: 90,
  problem: 150,
  intro: 90,
  feature: 240,
  credibility: 120,
  cta: 150,
};

export const FEATURES = [
  { image: "post-01-prontuario-ia.png", caption: "Fale. A IA organiza." },
  { image: "post-02-planejamento-tablet.png", caption: "Medidas direto na imagem." },
  { image: "post-03-preparo-checklist.png", caption: "Nada esquecido no pré-op." },
  { image: "post-04-osteotomias.png", caption: "Correção planejada com precisão." },
  { image: "post-05-cora.png", caption: "CORA identificado e registrado." },
];

export const T_SHORT = 12;
export const T_MED = 15;
export const T_FEAT = 18;

export const timing = (d: number) =>
  d >= T_FEAT
    ? springTiming({ config: { damping: 200 }, durationInFrames: d })
    : linearTiming({ durationInFrames: d });

export const TOTAL_FRAMES =
  SPANS.hook +
  SPANS.problem +
  SPANS.intro +
  SPANS.feature * FEATURES.length +
  SPANS.credibility +
  SPANS.cta;
