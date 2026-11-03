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

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDeep }}>
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, 120], [1.12, 1.02], clamp),
          transformOrigin: "50% 35%",
        }}
      >
        <Img
          src={staticFile("doctor-portrait-smiling.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,16,42,0) 40%, rgba(6,16,42,0.75) 58%, rgba(6,16,42,0.95) 75%, rgba(6,16,42,0.98) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          right: SAFE.side,
          bottom: SAFE.bottom + 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            fontSize: 176,
            fontWeight: 800,
            letterSpacing: -5,
            lineHeight: 1,
            color: COLORS.white,
            clipPath: `inset(-20% ${interpolate(frame, [8, 30], [100, 0], {
              ...clamp,
              easing: Easing.bezier(0.65, 0, 0.35, 1),
            })}% -20% 0%)`,
          }}
        >
          Doc<span style={{ color: COLORS.blue }}>Knee</span>
        </div>
        <div
          style={{
            marginTop: 18,
            height: 8,
            borderRadius: 4,
            backgroundColor: COLORS.blue,
            width: interpolate(frame, [22, 40], [0, 240], {
              ...clamp,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        />
        <div
          style={{
            marginTop: 30,
            fontSize: 50,
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "center",
            color: COLORS.white,
            opacity: interpolate(frame, [30, 42], [0, 1], clamp),
            translate: interpolate(frame, [30, 44], ["0px 30px", "0px 0px"], {
              ...clamp,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Documentação cirúrgica de joelho
        </div>
      </div>
    </AbsoluteFill>
  );
};
