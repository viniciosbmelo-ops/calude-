import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";
import { HOOK_WORDS } from "../timeline";
import { LightSweep, beatPulse, useSceneClock, type SceneClockProps } from "./common";

const WORDS: { text: string; accent?: boolean }[] = [
  { text: "Quanto" },
  { text: "tempo", accent: true },
  { text: "você" },
  { text: "perde" },
  { text: "documentando" },
  { text: "cirurgia?", accent: true },
];

export const HookScene: React.FC<SceneClockProps> = (clock) => {
  const { f, abs } = useSceneClock(clock);
  const pulse = beatPulse(abs);
  // Camera: slow push, plus a punch on the first downbeat (frame 30) and the bar at 60.
  const punch =
    interpolate(f, [30, 36], [0, 0.05], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) }) +
    interpolate(f, [60, 66], [0, 0.05], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDeep, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          scale: interpolate(f, [0, 100], [1.06, 1.18], clamp) + punch,
          transformOrigin: "62% 62%",
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
            "linear-gradient(180deg, rgba(6,16,42,0.94) 0%, rgba(6,16,42,0.78) 36%, rgba(6,16,42,0.05) 60%, rgba(6,16,42,0) 80%, rgba(6,16,42,0.5) 100%)",
        }}
      />
      <LightSweep f={f} period={90} opacity={0.1} />
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
          fontSize: 106,
          lineHeight: 1.08,
          letterSpacing: -2,
          color: COLORS.white,
          textShadow: "0 6px 30px rgba(0,0,0,0.45)",
        }}
      >
        {WORDS.map((w, i) => {
          const start = HOOK_WORDS[i];
          return (
            <span
              key={w.text}
              style={{
                position: "relative",
                display: "inline-block",
                color: w.accent ? COLORS.blue : COLORS.white,
                opacity: interpolate(f, [start, start + 2], [0, 1], clamp),
                scale:
                  interpolate(f, [start, start + 7], [0.4, 1], {
                    ...clamp,
                    easing: Easing.spring({ damping: 11, stiffness: 200 }),
                  }) + (w.accent && f > start + 7 ? pulse * 0.04 : 0),
                translate: interpolate(f, [start, start + 7], ["0px 40px", "0px 0px"], {
                  ...clamp,
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                transformOrigin: "50% 80%",
              }}
            >
              {w.text}
              {i === WORDS.length - 1 ? (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: -4,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: COLORS.white,
                    width: `${interpolate(f, [60, 68], [0, 100], {
                      ...clamp,
                      easing: Easing.bezier(0.65, 0, 0.35, 1),
                    })}%`,
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
