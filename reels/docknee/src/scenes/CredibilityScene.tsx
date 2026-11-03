import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { COLORS, SAFE, clamp } from "../theme";
import { CRED_BEATS } from "../timeline";
import { KineticText, LightSweep, useSceneClock, type SceneClockProps } from "./common";

export type CredibilitySceneProps = SceneClockProps & {
  variant: "a" | "b";
  span: number;
};

const VARIANTS = {
  a: {
    image: "doctor-portrait-smiling.jpg",
    lines: ["Feito por quem", "opera joelho."],
    at: [CRED_BEATS.a1, CRED_BEATS.a2],
    pos: [50, 34, 50, 36],
    scale: [1.05, 1.22],
  },
  b: {
    image: "doctor-desk-wide.jpg",
    lines: ["Para a rotina do", "cirurgião de joelho."],
    at: [CRED_BEATS.b1, CRED_BEATS.b2],
    pos: [38, 45, 60, 45],
    scale: [1.08, 1.2],
  },
} as const;

export const CredibilityScene: React.FC<CredibilitySceneProps> = ({ variant, span, ...clock }) => {
  const { f } = useSceneClock(clock);
  const v = VARIANTS[variant];
  const t = [-8, span + 8];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDeep, overflow: "hidden" }}>
      <AbsoluteFill style={{ scale: interpolate(f, t, [...v.scale], clamp) }}>
        <Img
          src={staticFile(v.image)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${interpolate(f, t, [v.pos[0], v.pos[2]], clamp)}% ${interpolate(f, t, [v.pos[1], v.pos[3]], clamp)}%`,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,16,42,0.35) 0%, rgba(6,16,42,0) 25%, rgba(6,16,42,0.1) 48%, rgba(6,16,42,0.86) 64%, rgba(6,16,42,0.97) 100%)",
        }}
      />
      <LightSweep f={f} period={90} opacity={0.08} />
      <div
        style={{
          position: "absolute",
          left: SAFE.side - 20,
          right: SAFE.side - 20,
          bottom: SAFE.bottom + 60,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <KineticText text={v.lines[0]} f={f} at={v.at[0]} size={96} letterSpacing={-3} />
        <KineticText
          text={v.lines[1]}
          f={f}
          at={v.at[1]}
          size={96}
          letterSpacing={-3}
          color={COLORS.blue}
        />
      </div>
    </AbsoluteFill>
  );
};
