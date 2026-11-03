import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";

const WORDS: { text: string; accent?: boolean }[] = [
  { text: "Quanto" },
  { text: "tempo", accent: true },
  { text: "você" },
  { text: "perde" },
  { text: "documentando" },
  { text: "cirurgia?", accent: true },
];

const FIRST_WORD_AT = 3;
const WORD_GAP = 4;

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDeep }}>
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, 110], [1.04, 1.16], clamp),
          transformOrigin: "60% 60%",
        }}
      >
        <Img
          src={staticFile("hero-doctor-tablet-knee-model.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,16,42,0.92) 0%, rgba(6,16,42,0.75) 38%, rgba(6,16,42,0.05) 62%, rgba(6,16,42,0.0) 80%, rgba(6,16,42,0.45) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 40,
          left: SAFE.side,
          right: SAFE.side,
          display: "flex",
          flexWrap: "wrap",
          columnGap: 26,
          rowGap: 4,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 104,
          lineHeight: 1.08,
          letterSpacing: -2,
          color: COLORS.white,
          textShadow: "0 6px 30px rgba(0,0,0,0.45)",
        }}
      >
        {WORDS.map((w, i) => {
          const start = FIRST_WORD_AT + i * WORD_GAP;
          return (
            <span
              key={w.text}
              style={{
                display: "inline-block",
                color: w.accent ? COLORS.blue : COLORS.white,
                opacity: interpolate(frame, [start, start + 3], [0, 1], clamp),
                scale: interpolate(frame, [start, start + 8], [0.4, 1], {
                  ...clamp,
                  easing: Easing.spring({ damping: 12, stiffness: 180 }),
                }),
                translate: interpolate(
                  frame,
                  [start, start + 8],
                  ["0px 40px", "0px 0px"],
                  { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) },
                ),
                transformOrigin: "50% 80%",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
