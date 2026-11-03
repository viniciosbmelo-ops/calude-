import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";
import { CTA_BEATS } from "../timeline";
import { Chevrons, beatPulse, useSceneClock, type SceneClockProps } from "./common";

/** The only CTA in the reel. Each element lands on a beat. */
export const CtaScene: React.FC<SceneClockProps> = (clock) => {
  const { f, abs } = useSceneClock(clock);
  const [b0, b1, b2, b3, b4] = CTA_BEATS;
  const pulse = beatPulse(abs);
  const enter = (s: number) => ({
    opacity: interpolate(f, [s, s + 3], [0, 1], clamp),
    translate: interpolate(f, [s, s + 9], ["0px 50px", "0px 0px"], {
      ...clamp,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
    scale: interpolate(f, [s, s + 9], [0.7, 1], {
      ...clamp,
      easing: Easing.spring({ damping: 11, stiffness: 200 }),
    }),
  });
  const buttonPulse = f > b4 + 10 ? pulse : 0;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% ${interpolate(f, [0, 150], [40, 52])}%, #1A44A0 0%, ${COLORS.navy} 42%, ${COLORS.navyDarkest} 100%)`,
        fontFamily: FONT,
        color: COLORS.white,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: SAFE.top,
        paddingBottom: SAFE.bottom,
        paddingLeft: SAFE.side,
        paddingRight: SAFE.side,
        overflow: "hidden",
      }}
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: i === 0 ? 260 : 1380,
            left: interpolate(f, [0, 150], i === 0 ? [-300, 200] : [700, 300]),
            opacity: 0.1,
            rotate: i === 0 ? "0deg" : "180deg",
          }}
        >
          <Chevrons size={300} />
        </div>
      ))}
      <div style={{ fontSize: 62, fontWeight: 700, ...enter(b0) }}>Conheça o</div>
      <div
        style={{
          fontSize: 172,
          fontWeight: 800,
          letterSpacing: -5,
          lineHeight: 1.05,
          ...enter(b1),
        }}
      >
        Doc<span style={{ color: COLORS.blue }}>Knee</span>
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 36,
          fontWeight: 500,
          color: COLORS.muted,
          textAlign: "center",
          ...enter(b2),
        }}
      >
        Plataforma de Documentação Cirúrgica de Joelho
      </div>
      <div
        style={{
          marginTop: 80,
          fontSize: 70,
          fontWeight: 800,
          color: COLORS.blue,
          ...enter(b3),
        }}
      >
        @dockneeapp
      </div>
      <div style={{ marginTop: 50, ...enter(b4) }}>
        <div
          style={{
            fontSize: 54,
            fontWeight: 800,
            color: COLORS.white,
            backgroundColor: COLORS.blue,
            borderRadius: 999,
            padding: "28px 72px",
            scale: 1 + buttonPulse * 0.06,
            boxShadow: `0 0 ${30 + buttonPulse * 50}px rgba(26,155,240,${0.4 + buttonPulse * 0.4})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            Link na bio
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              style={{ translate: `${buttonPulse * 8}px 0px` }}
            >
              <path
                d="M8 4l8 8-8 8"
                fill="none"
                stroke="white"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
