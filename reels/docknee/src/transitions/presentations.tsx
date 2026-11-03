import React, { useId } from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import {
  linearTiming,
  type TransitionPresentation,
  type TransitionPresentationComponentProps,
  type TransitionTiming,
} from "@remotion/transitions";
import { COLORS } from "../theme";
import type { TransitionType } from "../timeline";

// All presentations use a symmetric in-out curve so the visual "cut"
// (progress 0.5) lands exactly on the music beat, which is the scene boundary.
const ease = Easing.bezier(0.7, 0, 0.3, 1);
const W = 1080;
const H = 1920;
const c = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type P = Record<string, never>;
type Props = TransitionPresentationComponentProps<P>;

/* ---------------- Whip pan with horizontal motion blur ---------------- */
const Whip: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
  const id = useId().replace(/:/g, "");
  const p = ease(presentationProgress);
  const entering = presentationDirection === "entering";
  const blur = Math.sin(Math.PI * presentationProgress) * 90;
  const x = entering ? interpolate(p, [0, 1], [W, 0]) : interpolate(p, [0, 1], [0, -W]);
  return (
    <AbsoluteFill>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={`whip-${id}`} x="-20%" y="0" width="140%" height="100%">
          <feGaussianBlur stdDeviation={`${blur.toFixed(2)} 0`} />
        </filter>
      </svg>
      <AbsoluteFill
        style={{
          translate: `${x}px 0px`,
          filter: blur > 0.5 ? `url(#whip-${id})` : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
      {entering ? (
        // Thin blue speed streak riding the seam
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: x - 14,
            width: 14,
            backgroundColor: COLORS.blue,
            opacity: Math.sin(Math.PI * presentationProgress),
            boxShadow: `0 0 60px 20px rgba(26,155,240,0.55)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/* ---------------- Zoom-through with radial blur + flash ---------------- */
const ZoomThrough: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
  const p = ease(presentationProgress);
  const entering = presentationDirection === "entering";
  if (!entering) {
    return (
      <AbsoluteFill
        style={{
          scale: interpolate(p, [0, 1], [1, 2.6]),
          filter: `blur(${interpolate(p, [0, 0.5], [0, 22], c)}px)`,
          opacity: interpolate(p, [0.4, 0.55], [1, 0], c),
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          scale: interpolate(p, [0, 1], [0.55, 1]),
          filter: `blur(${interpolate(p, [0.45, 1], [22, 0], c)}px)`,
          opacity: interpolate(p, [0.45, 0.6], [0, 1], c),
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(26,155,240,0.7) 35%, rgba(10,26,63,0) 70%)`,
          opacity: interpolate(presentationProgress, [0.3, 0.5, 0.75], [0, 0.85, 0], c),
          scale: interpolate(presentationProgress, [0.3, 0.75], [0.6, 1.8], c),
        }}
      />
    </AbsoluteFill>
  );
};

/* ---------------- Diagonal brand bar wipe (right -> left) ---------------- */
const SLANT = 420; // horizontal offset between top and bottom of the edge
const LEAD = 300; // width of the bars travelling ahead of the reveal edge
const BarWipe: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
  const p = ease(presentationProgress);
  if (presentationDirection === "exiting") {
    return (
      <AbsoluteFill
        style={{
          translate: `${interpolate(p, [0, 1], [0, -160])}px 0px`,
          filter: `brightness(${interpolate(p, [0, 1], [1, 0.55])})`,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  // E = bottom x of the reveal edge.
  const E = interpolate(p, [0, 1], [W + LEAD, -SLANT - 10]);
  const band = (a: number, b: number) =>
    `${E - a + SLANT},0 ${E - b + SLANT},0 ${E - b},${H} ${E - a},${H}`;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          clipPath: `polygon(${E + SLANT}px 0px, ${W + SLANT + 20}px 0px, ${W + SLANT + 20}px ${H}px, ${E}px ${H}px)`,
          translate: `${interpolate(p, [0, 1], [140, 0])}px 0px`,
        }}
      >
        {children}
      </AbsoluteFill>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <polygon points={band(LEAD, LEAD - 170)} fill={COLORS.blue} />
        <polygon points={band(LEAD - 205, LEAD - 232)} fill={COLORS.white} />
        <polygon points={band(LEAD - 260, LEAD - 300)} fill={COLORS.navyDeep} />
      </svg>
    </AbsoluteFill>
  );
};

/* ---------------- Chevron shape wipe (echoes the logo's >> mark) ---------------- */
const BW = 150; // blue band width
const Chevron: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
  const p = ease(presentationProgress);
  if (presentationDirection === "exiting") {
    return (
      <AbsoluteFill
        style={{
          scale: interpolate(p, [0, 1], [1, 1.12]),
          filter: `brightness(${interpolate(p, [0, 1], [1, 0.5])})`,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  const half = H / 2;
  // T = x of the chevron tip of the revealed area.
  const T = interpolate(p, [0, 1], [-BW - 60, W + half + 10]);
  const chev = (t: number, w: number) =>
    `${t - half},0 ${t - half + w},0 ${t + w},${half} ${t - half + w},${H} ${t - half},${H} ${t},${half}`;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          clipPath: `polygon(-2000px 0px, ${T - half}px 0px, ${T}px ${half}px, ${T - half}px ${H}px, -2000px ${H}px)`,
          scale: interpolate(p, [0, 1], [1.15, 1]),
        }}
      >
        {children}
      </AbsoluteFill>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <polygon points={chev(T + 24, 22)} fill={COLORS.white} />
        <polygon points={chev(T + 60, BW)} fill={COLORS.blue} />
      </svg>
    </AbsoluteFill>
  );
};

/* ---------------- Iris reveal with brand rings ---------------- */
const R_MAX = Math.hypot(W / 2, H / 2) + 40;
const Iris: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
  const p = ease(presentationProgress);
  if (presentationDirection === "exiting") {
    return (
      <AbsoluteFill
        style={{
          scale: interpolate(p, [0, 1], [1, 1.25]),
          filter: `blur(${interpolate(p, [0, 1], [0, 10])}px) brightness(${interpolate(p, [0, 1], [1, 0.5])})`,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  const r = interpolate(p, [0, 1], [0, R_MAX]);
  const ring = (rr: number, w: number, color: string) => (
    <div
      style={{
        position: "absolute",
        left: W / 2 - rr,
        top: H / 2 - rr,
        width: rr * 2,
        height: rr * 2,
        borderRadius: "50%",
        border: `${w}px solid ${color}`,
        boxSizing: "border-box",
      }}
    />
  );
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `circle(${r}px at 50% 50%)` }}>{children}</AbsoluteFill>
      {r > 2 ? ring(r + 26, 30, COLORS.blue) : null}
      {r > 2 ? ring(r + 70, 10, COLORS.white) : null}
    </AbsoluteFill>
  );
};

const COMPONENTS: Record<TransitionType, React.FC<Props>> = {
  whip: Whip,
  zoomThrough: ZoomThrough,
  barWipe: BarWipe,
  chevron: Chevron,
  iris: Iris,
};

export const presentationFor = (type: TransitionType): TransitionPresentation<P> => ({
  component: COMPONENTS[type],
  props: {},
});

export const timingFor = (frames: number): TransitionTiming =>
  linearTiming({ durationInFrames: frames });
