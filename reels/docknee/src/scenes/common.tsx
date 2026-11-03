import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT, clamp } from "../theme";
import { beatPhase } from "../timeline";

/** Every scene receives where its cut sits so it can time against the beat grid. */
export type SceneClockProps = {
  /** Frames between the sequence start and the cut (half the incoming transition). */
  lead: number;
  /** Absolute frame of the cut (scene start on the beat grid). */
  cut: number;
};

/** f = frames since this scene's cut (negative during the incoming transition). */
export const useSceneClock = ({ lead, cut }: SceneClockProps) => {
  const frame = useCurrentFrame();
  const f = frame - lead;
  return { f, abs: cut + f };
};

/** 1 on every beat, decaying to 0 before the next. */
export const beatPulse = (abs: number) => Math.exp(-beatPhase(abs) / 4);

const popEase = Easing.bezier(0.16, 1, 0.3, 1);

/** Word-by-word kinetic text. Starts at `at` (scene frame), 2-frame stagger. */
export const KineticText: React.FC<{
  text: string;
  f: number;
  at: number;
  size: number;
  color?: string;
  weight?: number;
  align?: "left" | "center";
  stagger?: number;
  accentWords?: string[];
  lineHeight?: number;
  letterSpacing?: number;
}> = ({
  text,
  f,
  at,
  size,
  color = COLORS.white,
  weight = 800,
  align = "center",
  stagger = 2,
  accentWords = [],
  lineHeight = 1.1,
  letterSpacing = -1,
}) => {
  const words = text.split(" ");
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        columnGap: size * 0.26,
        fontFamily: FONT,
        fontWeight: weight,
        fontSize: size,
        lineHeight,
        letterSpacing,
        color,
        textShadow: "0 6px 28px rgba(0,0,0,0.45)",
      }}
    >
      {words.map((w, i) => {
        const s = at + i * stagger;
        return (
          <span
            key={`${w}-${i}`}
            style={{
              display: "inline-block",
              color: accentWords.includes(w) ? COLORS.blue : undefined,
              opacity: interpolate(f, [s, s + 3], [0, 1], clamp),
              translate: interpolate(f, [s, s + 7], ["0px 46px", "0px 0px"], {
                ...clamp,
                easing: popEase,
              }),
              scale: interpolate(f, [s, s + 7], [0.6, 1], {
                ...clamp,
                easing: Easing.spring({ damping: 11, stiffness: 220 }),
              }),
              filter: `blur(${interpolate(f, [s, s + 5], [8, 0], clamp)}px)`,
              transformOrigin: "50% 90%",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Small DocKnee wordmark. */
export const Wordmark: React.FC<{ size: number }> = ({ size }) => (
  <span
    style={{
      fontFamily: FONT,
      fontWeight: 800,
      fontSize: size,
      letterSpacing: -size * 0.03,
      color: COLORS.white,
    }}
  >
    Doc<span style={{ color: COLORS.blue }}>Knee</span>
  </span>
);

/** Two stacked chevrons echoing the DocKnee logo. */
export const Chevrons: React.FC<{ size: number; color?: string; opacity?: number }> = ({
  size,
  color = COLORS.blue,
  opacity = 1,
}) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 150 100" style={{ opacity }}>
    <path d="M10 5 L50 50 L10 95 L35 95 L75 50 L35 5 Z" fill={color} />
    <path d="M65 5 L105 50 L65 95 L90 95 L130 50 L90 5 Z" fill={color} opacity={0.6} />
  </svg>
);

/** Slow diagonal light sweep used on photo backgrounds (keeps every shot moving). */
export const LightSweep: React.FC<{ f: number; period?: number; opacity?: number }> = ({
  f,
  period = 120,
  opacity = 0.18,
}) => {
  const x = interpolate(((f % period) + period) % period, [0, period], [-900, 1500]);
  return (
    <div
      style={{
        position: "absolute",
        top: -400,
        bottom: -400,
        left: x,
        width: 320,
        rotate: "18deg",
        background:
          "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(140,205,255,1) 50%, rgba(255,255,255,0) 100%)",
        opacity,
        mixBlendMode: "screen",
      }}
    />
  );
};
