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

export const CredibilityScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDeep }}>
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, 140], [1.08, 1.0], clamp),
          translate: interpolate(frame, [0, 140], ["30px 0px", "-30px 0px"], clamp),
        }}
      >
        <Img
          src={staticFile("doctor-desk-wide.jpg")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 50%",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,16,42,0.35) 0%, rgba(6,16,42,0) 25%, rgba(6,16,42,0.1) 50%, rgba(6,16,42,0.85) 66%, rgba(6,16,42,0.97) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          right: SAFE.side,
          bottom: SAFE.bottom + 50,
          fontFamily: FONT,
          textAlign: "center",
        }}
      >
        {[
          { text: "Feito por quem", accent: false },
          { text: "opera joelho.", accent: true },
        ].map((l, i) => (
          <div
            key={l.text}
            style={{
              fontWeight: 800,
              fontSize: 104,
              lineHeight: 1.08,
              letterSpacing: -3,
              color: l.accent ? COLORS.blue : COLORS.white,
              opacity: interpolate(frame, [8 + i * 8, 18 + i * 8], [0, 1], clamp),
              translate: interpolate(
                frame,
                [8 + i * 8, 24 + i * 8],
                ["0px 50px", "0px 0px"],
                { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) },
              ),
            }}
          >
            {l.text}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
