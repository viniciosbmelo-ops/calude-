import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";

type ZoomProps = Record<string, never>;

const ZoomPresentation: React.FC<
  TransitionPresentationComponentProps<ZoomProps>
> = ({ children, presentationDirection, presentationProgress }) => {
  const entering = presentationDirection === "entering";
  return (
    <AbsoluteFill
      style={{
        opacity: entering
          ? interpolate(presentationProgress, [0, 0.6], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          : interpolate(presentationProgress, [0.4, 1], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
        scale: entering
          ? interpolate(presentationProgress, [0, 1], [0.82, 1])
          : interpolate(presentationProgress, [0, 1], [1, 1.18]),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const zoom = (): TransitionPresentation<ZoomProps> => ({
  component: ZoomPresentation,
  props: {},
});
