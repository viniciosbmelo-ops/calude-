import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = (s: number) => ({
    opacity: interpolate(frame, [s, s + 8], [0, 1], clamp),
    translate: interpolate(frame, [s, s + 14], ["0px 40px", "0px 0px"], {
      ...clamp,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  });
  const pulse = (Math.sin(((frame - 30) / 30) * Math.PI * 2) + 1) / 2;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 45%, #163A85 0%, ${COLORS.navy} 42%, ${COLORS.navyDarkest} 100%)`,
        fontFamily: FONT,
        color: COLORS.white,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: SAFE.top,
        paddingBottom: SAFE.bottom,
        paddingLeft: SAFE.side,
        paddingRight: SAFE.side,
      }}
    >
      <div style={{ fontSize: 58, fontWeight: 700, ...enter(4) }}>Conheça o</div>
      <div
        style={{
          fontSize: 168,
          fontWeight: 800,
          letterSpacing: -5,
          lineHeight: 1.05,
          ...enter(9),
        }}
      >
        Doc<span style={{ color: COLORS.blue }}>Knee</span>
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 34,
          fontWeight: 500,
          color: COLORS.muted,
          textAlign: "center",
          ...enter(14),
        }}
      >
        Plataforma de Documentação Cirúrgica de Joelho
      </div>
      <div
        style={{
          marginTop: 90,
          fontSize: 64,
          fontWeight: 800,
          color: COLORS.blue,
          ...enter(20),
        }}
      >
        @dockneeapp
      </div>
      <div style={{ marginTop: 56, ...enter(26) }}>
        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            color: COLORS.white,
            backgroundColor: COLORS.blue,
            borderRadius: 999,
            padding: "28px 72px",
            scale: interpolate(pulse, [0, 1], [1, 1.07]),
            boxShadow: `0 0 ${interpolate(pulse, [0, 1], [20, 70])}px rgba(26,155,240,${interpolate(pulse, [0, 1], [0.35, 0.8])})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            Link na bio
            <svg width="34" height="34" viewBox="0 0 24 24">
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
