import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";
import { PROBLEM_BEATS } from "../timeline";
import { beatPulse, useSceneClock, type SceneClockProps } from "./common";

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% ${interpolate(frame, [0, 160], [35, 60])}%, #13306F 0%, ${COLORS.navy} 45%, ${COLORS.navyDarkest} 100%)`,
      }}
    />
  );
};

const StruckWord: React.FC<{ lines: string[]; size: number }> = ({
  lines,
  size,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingLeft: SAFE.side,
        paddingRight: SAFE.side,
        opacity: interpolate(frame, [0, 3], [0, 1], clamp),
        scale: interpolate(frame, [0, 8], [1.6, 1], {
          ...clamp,
          easing: Easing.spring({ damping: 14, stiffness: 200 }),
        }),
        // little shake when the strike hits (on the off-beat)
        translate: `${frame >= 15 && frame < 21 ? Math.sin(frame * 3) * 10 : 0}px 0px`,
      }}
    >
      {lines.map((line, i) => (
        <div
          key={line}
          style={{
            position: "relative",
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.12,
            letterSpacing: -2,
            color: COLORS.white,
            textAlign: "center",
          }}
        >
          {line}
          <div
            style={{
              position: "absolute",
              left: -12,
              top: "50%",
              height: 14,
              borderRadius: 7,
              backgroundColor: COLORS.blue,
              opacity: frame >= 15 + i * 3 ? 1 : 0,
              width: interpolate(frame, [15 + i * 3, 21 + i * 3], ["0%", "105%"], {
                ...clamp,
                easing: Easing.bezier(0.65, 0, 0.35, 1),
              }),
              rotate: "-3deg",
            }}
          />
        </div>
      ))}
    </AbsoluteFill>
  );
};

const Punchline: React.FC = () => {
  const frame = useCurrentFrame();
  const lines: { text: string; accent?: boolean }[] = [
    { text: "Seu" },
    { text: "planejamento" },
    { text: "merece" },
    { text: "mais.", accent: true },
  ];
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingLeft: SAFE.side,
        paddingRight: SAFE.side,
      }}
    >
      {lines.map((l, i) => {
        const s = i * 3;
        return (
          <div
            key={l.text}
            style={{
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: l.accent ? 168 : 112,
              lineHeight: 1.05,
              letterSpacing: -3,
              color: l.accent ? COLORS.blue : COLORS.white,
              opacity: interpolate(frame, [s, s + 5], [0, 1], clamp),
              translate: interpolate(frame, [s, s + 10], ["0px 60px", "0px 0px"], {
                ...clamp,
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            {l.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const ProblemScene: React.FC<SceneClockProps> = (clock) => {
  const { f, abs } = useSceneClock(clock);
  const [a, b, c, d] = PROBLEM_BEATS.map((x) => x + clock.lead);
  const pulse = beatPulse(abs);
  return (
    <AbsoluteFill style={{ scale: 1 + pulse * 0.015 + Math.max(0, f - 60) * 0.0008 }}>
      <Background />
      <Sequence from={a} durationInFrames={b - a} layout="absolute-fill" name="Papel">
        <StruckWord lines={["Papel."]} size={170} />
      </Sequence>
      <Sequence from={b} durationInFrames={c - b} layout="absolute-fill" name="Planilha">
        <StruckWord lines={["Planilha."]} size={150} />
      </Sequence>
      <Sequence from={c} durationInFrames={d - c} layout="absolute-fill" name="Foto solta">
        <StruckWord lines={["Foto solta", "no celular."]} size={130} />
      </Sequence>
      <Sequence from={d} layout="absolute-fill" name="Punchline">
        <Punchline />
      </Sequence>
    </AbsoluteFill>
  );
};
