import React from "react";
import { Composition, Folder } from "remotion";
import "./theme";
import { DockneeReel } from "./DockneeReel";
import { HookScene } from "./scenes/HookScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { IntroScene } from "./scenes/IntroScene";
import { FeatureScene, FeatureSceneProps } from "./scenes/FeatureScene";
import { CredibilityScene } from "./scenes/CredibilityScene";
import { CtaScene } from "./scenes/CtaScene";
import { FEATURES, FPS, SPANS, TOTAL_FRAMES } from "./timeline";

const W = 1080;
const H = 1920;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DockneeReel"
        component={DockneeReel}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={TOTAL_FRAMES}
      />
      <Folder name="DockneeReel-Cenas">
        <Composition id="Hook" component={HookScene} width={W} height={H} fps={FPS} durationInFrames={SPANS.hook} />
        <Composition id="Problema" component={ProblemScene} width={W} height={H} fps={FPS} durationInFrames={SPANS.problem} />
        <Composition id="Intro" component={IntroScene} width={W} height={H} fps={FPS} durationInFrames={SPANS.intro} />
        <Composition
          id="Recurso"
          component={FeatureScene}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={SPANS.feature}
          defaultProps={
            {
              image: FEATURES[0].image,
              caption: FEATURES[0].caption,
              index: 1,
              total: FEATURES.length,
            } satisfies FeatureSceneProps
          }
        />
        <Composition id="Credibilidade" component={CredibilityScene} width={W} height={H} fps={FPS} durationInFrames={SPANS.credibility} />
        <Composition id="CTA" component={CtaScene} width={W} height={H} fps={FPS} durationInFrames={SPANS.cta} />
      </Folder>
    </>
  );
};
