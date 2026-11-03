import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";

export type FeatureSceneProps = {
  image: string;
  index: number;
  total: number;
  caption: string;
};

// 4:5 post (1122x1402) shown on a 9:16 canvas, sized to stay inside IG safe zones.
const CARD_WIDTH = 900;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 1402) / 1122);
const CARD_TOP = 300;

export const FeatureScene: React.FC<FeatureSceneProps> = ({
  image,
  index,
  total,
  caption,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const src = staticFile(image);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDarkest }}>
      {/* Blurred, darkened copy as background */}
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, durationInFrames], [1.35, 1.5]),
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.45) saturate(1.2)",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,16,42,0.55) 0%, rgba(6,16,42,0.1) 30%, rgba(6,16,42,0.1) 65%, rgba(6,16,42,0.7) 100%)",
        }}
      />

      {/* Number chip */}
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 4,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: interpolate(frame, [6, 14], [0, 1], clamp),
          translate: interpolate(frame, [6, 16], ["0px -20px", "0px 0px"], {
            ...clamp,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 36,
            letterSpacing: 3,
            color: COLORS.white,
            backgroundColor: "rgba(10,26,63,0.85)",
            border: `2px solid ${COLORS.blue}`,
            borderRadius: 999,
            padding: "8px 30px",
          }}
        >
          <span style={{ color: COLORS.blue }}>{pad(index)}</span> / {pad(total)}
        </div>
      </div>

      {/* The post with gentle Ken Burns */}
      <div
        style={{
          position: "absolute",
          top: CARD_TOP,
          left: (1080 - CARD_WIDTH) / 2,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: 28,
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
          scale: interpolate(frame, [0, durationInFrames], [0.985, 1.03]),
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>

      {/* Caption */}
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          right: SAFE.side,
          top: CARD_TOP + CARD_HEIGHT + 34,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 18,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 46,
          lineHeight: 1.15,
          color: COLORS.white,
          textAlign: "center",
          opacity: interpolate(frame, [18, 28], [0, 1], clamp),
          translate: interpolate(frame, [18, 32], ["0px 24px", "0px 0px"], {
            ...clamp,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            width: 10,
            alignSelf: "stretch",
            borderRadius: 5,
            backgroundColor: COLORS.blue,
            flexShrink: 0,
          }}
        />
        <div>{caption}</div>
      </div>
    </AbsoluteFill>
  );
};
