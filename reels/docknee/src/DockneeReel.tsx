import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { zoom } from "./zoomPresentation";
import { HookScene } from "./scenes/HookScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { IntroScene } from "./scenes/IntroScene";
import { FeatureScene } from "./scenes/FeatureScene";
import { CredibilityScene } from "./scenes/CredibilityScene";
import { CtaScene } from "./scenes/CtaScene";
import {
  FEATURES,
  SPANS,
  T_FEAT,
  T_MED,
  T_SHORT,
  timing,
} from "./timeline";
import { COLORS } from "./theme";

// Each sequence lasts its on-screen span plus the transition that follows it,
// so the total length equals the sum of spans (1800 frames).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const featureTransitions: TransitionPresentation<any>[] = [
  slide({ direction: "from-right" }),
  wipe({ direction: "from-left" }),
  zoom(),
  slide({ direction: "from-bottom" }),
];

export const DockneeReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDarkest }}>
      <TransitionSeries>
        <TransitionSeries.Sequence name="Hook" durationInFrames={SPANS.hook + T_SHORT}>
          <HookScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-bottom" })}
          timing={timing(T_SHORT)}
        />
        <TransitionSeries.Sequence name="Problema" durationInFrames={SPANS.problem + T_MED}>
          <ProblemScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing(T_MED)} />
        <TransitionSeries.Sequence name="Intro" durationInFrames={SPANS.intro + T_FEAT}>
          <IntroScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={timing(T_FEAT)}
        />
        {FEATURES.flatMap((f, i) => {
          const last = i === FEATURES.length - 1;
          const nodes = [
            <TransitionSeries.Sequence
              key={`seq-${f.image}`}
              name={`Recurso ${i + 1}`}
              durationInFrames={SPANS.feature + (last ? T_MED : T_FEAT)}
            >
              <FeatureScene
                image={f.image}
                caption={f.caption}
                index={i + 1}
                total={FEATURES.length}
              />
            </TransitionSeries.Sequence>,
          ];
          if (!last) {
            nodes.push(
              <TransitionSeries.Transition
                key={`tr-${f.image}`}
                presentation={featureTransitions[i]}
                timing={timing(T_FEAT)}
              />,
            );
          }
          return nodes;
        })}
        <TransitionSeries.Transition presentation={fade()} timing={timing(T_MED)} />
        <TransitionSeries.Sequence
          name="Credibilidade"
          durationInFrames={SPANS.credibility + T_MED}
        >
          <CredibilityScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={zoom()} timing={timing(T_MED)} />
        <TransitionSeries.Sequence name="CTA" durationInFrames={SPANS.cta}>
          <CtaScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
