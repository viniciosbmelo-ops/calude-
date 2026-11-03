import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const FONT = "Montserrat";

for (const weight of ["500", "700", "800", "900"]) {
  loadFont({
    family: FONT,
    url: staticFile(`fonts/Montserrat-${weight}.woff2`),
    weight,
  });
}

export const COLORS = {
  navy: "#0B1F4D",
  navyDeep: "#0A1A3F",
  navyDarkest: "#06102A",
  blue: "#1A9BF0",
  white: "#FFFFFF",
  muted: "rgba(255,255,255,0.78)",
};

// Instagram Reels UI safe zones (1080x1920)
export const SAFE = {
  top: 220,
  bottom: 320,
  side: 80,
};

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
