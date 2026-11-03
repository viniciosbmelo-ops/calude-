import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";
import { Chevrons, KineticText, beatPulse, useSceneClock, type SceneClockProps } from "./common";

/** "DocKnee" logo reveal on the drop (impact + ding at the cut). */
export const RevealScene: React.FC<SceneClockProps> = (clock) => {
  const { f, abs } = useSceneClock(clock);
  const pulse = beatPulse(abs);
  const pop = Easing.spring({ damping: 10, stiffness: 160 });
  const ring = (delay: number, color: string, w: number) => {
    const r = interpolate(f, [delay, delay + 22], [40, 1100], {
      ...clamp,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    return (
      <div
        style={{
          position: "absolute",
          left: 540 - r,
          top: 900 - r,
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          border: `${w}px solid ${color}`,
          opacity: interpolate(f, [delay, delay + 4, delay + 22], [0, 1, 0], clamp),
        }}
      />
    );
  };
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 47%, #1C4BA8 0%, ${COLORS.navy} ${38 + pulse * 6}%, ${COLORS.navyDarkest} 100%)`,
        overflow: "hidden",
      }}
    >
      {/* drifting chevrons in the background */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 330 + i * 520,
            left: interpolate(f, [-8, 70], [-500 + i * 120, 900 + i * 60]),
            opacity: 0.12,
          }}
        >
          <Chevrons size={260} />
        </div>
      ))}
      {ring(0, COLORS.blue, 26)}
      {ring(4, COLORS.white, 8)}
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          right: SAFE.side,
          top: 760,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            marginBottom: 20,
            scale: interpolate(f, [-2, 8], [0, 1], { ...clamp, easing: pop }),
            translate: interpolate(f, [-2, 10], ["-120px 0px", "0px 0px"], clamp),
          }}
        >
          <Chevrons size={110} />
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 190,
            fontWeight: 800,
            letterSpacing: -6,
            lineHeight: 1,
            color: COLORS.white,
            scale: interpolate(f, [0, 10], [1.6, 1], { ...clamp, easing: pop }) + pulse * 0.02,
            filter: `blur(${interpolate(f, [0, 6], [14, 0], clamp)}px)`,
            opacity: interpolate(f, [0, 2], [0, 1], clamp),
            clipPath: `inset(-20% ${interpolate(f, [0, 9], [50, 0], {
              ...clamp,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}% -20% ${interpolate(f, [0, 9], [50, 0], {
              ...clamp,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}%)`,
          }}
        >
          Doc<span style={{ color: COLORS.blue }}>Knee</span>
        </div>
        <div
          style={{
            marginTop: 22,
            height: 9,
            borderRadius: 5,
            backgroundColor: COLORS.blue,
            width: interpolate(f, [8, 20], [0, 280], {
              ...clamp,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        />
        <div style={{ marginTop: 34 }}>
          <KineticText text="Documentação cirúrgica de joelho" f={f} at={15} size={46} weight={700} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
