import React from "react";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { presentationFor, timingFor } from "./transitions/presentations";
import { HookScene } from "./scenes/HookScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { RevealScene } from "./scenes/RevealScene";
import { FeatureScene } from "./scenes/FeatureScene";
import { CutawayScene } from "./scenes/CutawayScene";
import { CredibilityScene } from "./scenes/CredibilityScene";
import { CtaScene } from "./scenes/CtaScene";
import { Wordmark } from "./scenes/common";
import { SCENES, type SceneSlot } from "./timeline";
import { COLORS, SAFE, clamp } from "./theme";

const renderScene = (s: SceneSlot, lead: number) => {
  const clock = { lead, cut: s.start };
  const span = s.end - s.start;
  switch (s.id) {
    case "hook":
      return <HookScene {...clock} />;
    case "problem":
      return <ProblemScene {...clock} />;
    case "reveal":
      return <RevealScene {...clock} />;
    case "f1":
    case "f2":
    case "f3":
    case "f4":
    case "f5":
      return <FeatureScene {...clock} id={s.id} span={span} />;
    case "c1":
    case "c2":
    case "c3":
    case "c4":
      return <CutawayScene {...clock} id={s.id} span={span} />;
    case "credA":
      return <CredibilityScene {...clock} variant="a" span={span} />;
    case "credB":
      return <CredibilityScene {...clock} variant="b" span={span} />;
    case "cta":
      return <CtaScene {...clock} />;
    default:
      throw new Error(`Unknown scene ${s.id}`);
  }
};

/** Subtle persistent wordmark, shown between the reveal and the end card. */
const CornerMark: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [272, 284, 1640, 1650], [0, 0.9, 0.9, 0], clamp);
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: SAFE.top + 26,
        right: SAFE.side,
        opacity,
        translate: interpolate(frame, [272, 284], ["40px 0px", "0px 0px"], {
          ...clamp,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        textShadow: "0 2px 12px rgba(0,0,0,0.6)",
      }}
    >
      <Wordmark size={38} />
    </div>
  );
};

// Each scene's sequence spans [cut - tIn/2, nextCut + tOut/2], so every
// transition is centred on its cut, and every cut sits on the 120 BPM grid.
export const DockneeReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDarkest }}>
      <TransitionSeries>
        {SCENES.flatMap((s, i) => {
          const lead = (s.tIn?.frames ?? 0) / 2;
          const next = SCENES[i + 1];
          const tail = (next?.tIn?.frames ?? 0) / 2;
          const nodes: React.ReactNode[] = [];
          if (s.tIn) {
            nodes.push(
              <TransitionSeries.Transition
                key={`t-${s.id}`}
                presentation={presentationFor(s.tIn.type)}
                timing={timingFor(s.tIn.frames)}
              />,
            );
          }
          nodes.push(
            <TransitionSeries.Sequence
              key={s.id}
              name={s.id}
              durationInFrames={s.end - s.start + lead + tail}
            >
              {renderScene(s, lead)}
            </TransitionSeries.Sequence>,
          );
          return nodes;
        })}
      </TransitionSeries>
      <CornerMark />
      {/* Original procedural audio (see audio/generate_audio.py) */}
      <Audio src={staticFile("audio/docknee-music.wav")} />
      <Audio src={staticFile("audio/docknee-sfx.wav")} />
    </AbsoluteFill>
  );
};
