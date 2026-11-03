import React from "react";
import { Composition } from "remotion";
import "./theme";
import { DockneeReel } from "./DockneeReel";
import { FPS, TOTAL_FRAMES } from "./timeline";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DockneeReel"
      component={DockneeReel}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={TOTAL_FRAMES}
    />
  );
};
