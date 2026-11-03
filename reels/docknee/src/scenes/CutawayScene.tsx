import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { COLORS, SAFE, clamp } from "../theme";
import { CUTAWAY_WORD, CUTAWAYS } from "../timeline";
import { KineticText, LightSweep, useSceneClock, type SceneClockProps } from "./common";

export type CutawaySceneProps = SceneClockProps & {
  id: keyof typeof CUTAWAYS;
  span: number;
};

/** 1.5 s human-presence cutaway: fast push-in on a doctor photo + connector line. */
export const CutawayScene: React.FC<CutawaySceneProps> = ({ id, span, ...clock }) => {
  const { f } = useSceneClock(clock);
  const c = CUTAWAYS[id];
  const t = [-8, span + 8];
  const x = interpolate(f, t, [c.from[0], c.to[0]], clamp);
  const y = interpolate(f, t, [c.from[1], c.to[1]], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDarkest, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          scale: interpolate(f, t, [c.from[2], c.to[2]], clamp),
          transformOrigin: `${x}% ${y}%`,
        }}
      >
        <Img
          src={staticFile(c.image)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${x}% ${y}%`,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,16,42,0.35) 0%, rgba(6,16,42,0) 30%, rgba(6,16,42,0.15) 52%, rgba(6,16,42,0.88) 72%, rgba(6,16,42,0.95) 100%)",
        }}
      />
      <LightSweep f={f + 30} period={60} opacity={0.12} />
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          right: SAFE.side,
          bottom: SAFE.bottom + 70,
        }}
      >
        <div
          style={{
            height: 10,
            borderRadius: 5,
            backgroundColor: COLORS.blue,
            marginBottom: 26,
            width: interpolate(f, [CUTAWAY_WORD - 4, CUTAWAY_WORD + 8], [0, 160], clamp),
            marginLeft: "auto",
            marginRight: "auto",
          }}
        />
        <KineticText text={c.text} f={f} at={CUTAWAY_WORD} size={92} stagger={3} letterSpacing={-2} />
      </div>
    </AbsoluteFill>
  );
};
