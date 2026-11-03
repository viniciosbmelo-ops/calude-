import data from "./timeline.json";

// Single source of truth shared with audio/generate_audio.py.
// 120 BPM @ 30 fps -> 1 beat = 15 frames, 1 bar = 60 frames.
// Musical downbeats fall on frame 30 + 60k (the track opens with a 2-beat pickup),
// so every scene cut below sits on a beat and the big ones on a bar line.
export const FPS = data.fps;
export const BPM = data.bpm;
export const FRAMES_PER_BEAT = data.framesPerBeat;
export const FRAMES_PER_BAR = data.framesPerBar;
export const FIRST_DOWNBEAT = data.firstDownbeat;
export const TOTAL_FRAMES = data.totalFrames;

export type TransitionType =
  | "whip"
  | "zoomThrough"
  | "barWipe"
  | "chevron"
  | "iris";

export type SceneId = (typeof data.scenes)[number]["id"];

export type SceneSlot = {
  id: string;
  start: number;
  end: number;
  tIn?: { type: TransitionType; frames: number };
};

export const SCENES = data.scenes as SceneSlot[];
export const FEATURE_BEATS = data.featureBeats;
export const HOOK_WORDS = data.hookWords;
export const PROBLEM_BEATS = data.problemBeats;
export const CUTAWAY_WORD = data.cutawayWord;
export const CRED_BEATS = data.credBeats;
export const CTA_BEATS = data.ctaBeats;
/** Beat-synced highlight rings per feature (image-fraction coords, cut-relative frame). */
export const FEATURE_MARKS = data.featureMarks;

/** Frames since the previous downbeat-aligned beat, for beat-synced pulses. */
export const beatPhase = (absFrame: number) =>
  (((absFrame - FIRST_DOWNBEAT) % FRAMES_PER_BEAT) + FRAMES_PER_BEAT) %
  FRAMES_PER_BEAT;

// Validate: cuts contiguous, on the beat grid, total = 1800.
SCENES.forEach((s, i) => {
  if (s.start % FRAMES_PER_BEAT !== 0) {
    throw new Error(`Scene ${s.id} does not start on a beat`);
  }
  if (i > 0 && SCENES[i - 1].end !== s.start) {
    throw new Error(`Gap before scene ${s.id}`);
  }
  if (s.tIn && s.tIn.frames % 2 !== 0) {
    throw new Error(`Transition into ${s.id} must have an even length`);
  }
});
if (SCENES[SCENES.length - 1].end !== TOTAL_FRAMES) {
  throw new Error("Timeline must end at TOTAL_FRAMES");
}

export type FeatureDef = {
  image: string;
  step: string;
  /** Fraction of the post height that is safe to show (hides baked-in CTA + logo). */
  cropBottom: number;
  captions: [string, string];
  /** Camera keyframes in image-fraction coords: [cx, cy, zoom]. */
  cam: {
    start: [number, number, number];
    punch: [number, number, number];
    pan: [number, number, number];
    end: [number, number, number];
  };
};

export const FEATURES: Record<"f1" | "f2" | "f3" | "f4" | "f5", FeatureDef> = {
  f1: {
    image: "post-01-prontuario-ia.png",
    step: "Consulta",
    cropBottom: 0.765,
    captions: ["Você fala. A IA transcreve.", "Você revisa e valida."],
    cam: {
      start: [0.5, 0.4, 1.0],
      punch: [0.4, 0.56, 2.1],
      pan: [0.66, 0.55, 2.0],
      end: [0.55, 0.5, 1.35],
    },
  },
  f2: {
    image: "post-03-preparo-checklist.png",
    step: "Pré-operatório",
    cropBottom: 0.86,
    captions: ["Avaliação clínica documentada.", "Etapa por etapa."],
    cam: {
      start: [0.5, 0.4, 1.0],
      punch: [0.42, 0.6, 1.9],
      pan: [0.47, 0.75, 1.9],
      end: [0.5, 0.6, 1.3],
    },
  },
  f3: {
    image: "post-05-cora.png",
    step: "Diagnóstico",
    cropBottom: 0.85,
    captions: ["Análise do CORA organizada.", "Base para a osteotomia."],
    cam: {
      start: [0.5, 0.42, 1.0],
      punch: [0.63, 0.52, 2.2],
      pan: [0.26, 0.72, 2.0],
      end: [0.5, 0.55, 1.3],
    },
  },
  f4: {
    image: "post-04-osteotomias.png",
    step: "Planejamento",
    cropBottom: 0.775,
    captions: ["Eixos, ângulos e medidas.", "Organizados para a correção."],
    cam: {
      start: [0.5, 0.4, 1.0],
      punch: [0.53, 0.54, 2.3],
      pan: [0.72, 0.52, 2.1],
      end: [0.55, 0.5, 1.35],
    },
  },
  f5: {
    image: "post-02-planejamento-tablet.png",
    step: "Na prática",
    cropBottom: 0.86,
    captions: ["Planejamento direto no tablet.", "Um registro real em uso."],
    cam: {
      start: [0.5, 0.42, 1.0],
      punch: [0.45, 0.6, 2.2],
      pan: [0.6, 0.64, 1.8],
      end: [0.5, 0.55, 1.25],
    },
  },
};

export const FEATURE_ORDER = ["f1", "f2", "f3", "f4", "f5"] as const;

export const CUTAWAYS: Record<
  "c1" | "c2" | "c3" | "c4",
  { image: string; text: string; from: [number, number, number]; to: [number, number, number] }
> = {
  // [objectPosition x%, y%, scale]
  c1: { image: "doctor-portrait-smiling.jpg", text: "Antes de operar,", from: [50, 37, 1.3], to: [50, 37, 1.55] },
  c2: { image: "doctor-desk-wide.jpg", text: "na hora de analisar,", from: [40, 45, 1.05], to: [58, 45, 1.2] },
  c3: { image: "hero-doctor-tablet-knee-model.jpg", text: "na hora de planejar,", from: [18, 50, 1.3], to: [24, 46, 1.55] },
  c4: { image: "hero-doctor-tablet-knee-model.jpg", text: "e no dia a dia.", from: [60, 62, 1.6], to: [64, 60, 1.9] },
};
