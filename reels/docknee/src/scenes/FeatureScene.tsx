import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";
import { COLORS, FONT, SAFE, clamp } from "../theme";
import {
  FEATURE_BEATS as B,
  FEATURE_MARKS,
  FEATURE_ORDER,
  FEATURES,
  type FeatureDef,
} from "../timeline";
import { KineticText, LightSweep, beatPulse, useSceneClock, type SceneClockProps } from "./common";

export type FeatureSceneProps = SceneClockProps & {
  id: (typeof FEATURE_ORDER)[number];
  /** Scene length between its two cuts. */
  span: number;
};

const POST_W = 1122;
const POST_H = 1402;
const CARD_W = 960;
const CARD_TOP = 346;
const CAPTION_TOP = 1290;
const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/** Camera keyframes -> (cx, cy, zoom) for a scene frame. */
const camera = (def: FeatureDef, f: number) => {
  const { start, punch, pan, end } = def.cam;
  const drift = (k: [number, number, number], dz: number): [number, number, number] => [
    k[0],
    k[1],
    k[2] * dz,
  ];
  const keys: [number, [number, number, number]][] = [
    [-10, start],
    [B.punch, drift(start, 1.06)],
    [B.punch + 12, punch],
    [B.pan, drift(punch, 1.05)],
    [B.pan + 15, pan],
    [B.pullBack, drift(pan, 1.05)],
    [B.pullBack + 15, end],
    [B.pullBack + 60, drift(end, 1.06)],
  ];
  const t = keys.map((k) => k[0]);
  const pick = (i: number) =>
    interpolate(
      f,
      t,
      keys.map((k) => k[1][i]),
      { ...clamp, easing: inOut },
    );
  return { cx: pick(0), cy: pick(1), z: pick(2) };
};

export const FeatureScene: React.FC<FeatureSceneProps> = ({ id, span, ...clock }) => {
  const { f, abs } = useSceneClock(clock);
  const def = FEATURES[id];
  const index = FEATURE_ORDER.indexOf(id) + 1;
  const marks = FEATURE_MARKS[id];
  const src = staticFile(def.image);

  const cardH = Math.round((CARD_W * POST_H * def.cropBottom) / POST_W);
  const { cx, cy, z } = camera(def, f);
  const imgW = CARD_W * z;
  const imgH = (imgW * POST_H) / POST_W;
  // Clamp so the camera never shows anything below cropBottom (baked-in CTA + logo).
  const left = Math.min(0, Math.max(CARD_W - imgW, CARD_W / 2 - cx * imgW));
  const top = Math.min(0, Math.max(cardH - def.cropBottom * imgH, cardH / 2 - cy * imgH));

  const pulse = beatPulse(abs);
  const enter = interpolate(f, [-8, 14], [0, 1], {
    ...clamp,
    easing: Easing.spring({ damping: 14, stiffness: 140 }),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDarkest, overflow: "hidden" }}>
      {/* Blurred, darkened post as background, slowly drifting */}
      <AbsoluteFill
        style={{
          scale: interpolate(f, [0, span], [1.4, 1.6]),
          rotate: `${interpolate(f, [0, span], [-2, 2])}deg`,
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 30%",
            filter: "blur(46px) brightness(0.4) saturate(1.3)",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 42%, rgba(26,155,240,${0.18 + pulse * 0.12}) 0%, rgba(10,26,63,0.55) 45%, rgba(6,16,42,0.92) 100%)`,
        }}
      />
      <LightSweep f={f} period={195} opacity={0.08} />

      {/* Step label + progress */}
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 18,
          left: SAFE.side,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          opacity: interpolate(f, [0, 5], [0, 1], clamp),
          translate: interpolate(f, [0, 10], ["-60px 0px", "0px 0px"], {
            ...clamp,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 40,
            color: COLORS.white,
            backgroundColor: "rgba(10,26,63,0.88)",
            border: `3px solid ${COLORS.blue}`,
            borderRadius: 999,
            padding: "10px 30px 10px 12px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: COLORS.blue,
              fontSize: 32,
              scale: 1 + pulse * 0.08,
            }}
          >
            {index}
          </span>
          <span>
            <span style={{ color: COLORS.blue }}>·</span> {def.step}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, paddingLeft: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              style={{
                width: 54,
                height: 8,
                borderRadius: 4,
                backgroundColor: "rgba(255,255,255,0.22)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  backgroundColor: COLORS.blue,
                  width:
                    n < index
                      ? "100%"
                      : n === index
                        ? `${interpolate(f, [0, span], [0, 100], clamp)}%`
                        : "0%",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* The post (cropped above its baked-in CTA) with an animated camera */}
      <div
        style={{
          position: "absolute",
          top: CARD_TOP,
          left: (1080 - CARD_W) / 2,
          width: CARD_W,
          height: cardH,
          borderRadius: 30,
          overflow: "hidden",
          boxShadow: `0 40px 90px rgba(0,0,0,0.6), 0 0 0 3px rgba(26,155,240,${0.35 + pulse * 0.4})`,
          scale: interpolate(enter, [0, 1], [1.12, 1]),
          rotate: `${interpolate(enter, [0, 1], [-3, 0])}deg`,
          translate: `0px ${interpolate(enter, [0, 1], [80, 0])}px`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: imgW,
            height: imgH,
          }}
        >
          <Img src={src} style={{ width: "100%", height: "100%" }} />
          {marks.map((m, i) => {
            const k = interpolate(f, [m.at, m.at + 8, m.at + 30], [0, 1, 1], clamp);
            const out = interpolate(f, [m.at + 26, m.at + 34], [1, 0], clamp);
            if (k <= 0 || out <= 0) return null;
            const size = 120;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: m.x * imgW - size / 2,
                  top: m.y * imgH - size / 2,
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  border: `7px solid ${COLORS.blue}`,
                  boxShadow: `0 0 30px rgba(26,155,240,0.9), inset 0 0 20px rgba(26,155,240,0.5)`,
                  opacity: out,
                  scale: interpolate(k, [0, 1], [1.8, 1], {
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                }}
              />
            );
          })}
        </div>
        {/* Sheen on the punch-in beat */}
        <div
          style={{
            position: "absolute",
            top: -200,
            bottom: -200,
            width: 220,
            rotate: "20deg",
            left: interpolate(f, [B.punch, B.punch + 14], [-400, CARD_W + 200], clamp),
            background:
              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0) 100%)",
          }}
        />
      </div>

      {/* Captions, each landing on a beat */}
      <div
        style={{
          position: "absolute",
          top: Math.max(CAPTION_TOP, CARD_TOP + cardH + 40),
          left: SAFE.side - 10,
          right: SAFE.side - 10,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <KineticText text={def.captions[0]} f={f} at={B.caption1} size={56} />
        <KineticText
          text={def.captions[1]}
          f={f}
          at={B.caption2}
          size={46}
          weight={700}
          color={COLORS.blue}
        />
      </div>
    </AbsoluteFill>
  );
};
