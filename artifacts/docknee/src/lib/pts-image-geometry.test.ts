import { describe, expect, it } from "vitest";
import {
  clampImagePan,
  canCommitTouchMark,
  clientToNormalizedImagePoint,
  zoomPanAtFocalPoint,
} from "./pts-image-geometry";

describe("PTS transformed-image geometry", () => {
  it("cancels a pending mark when the gesture becomes a pinch", () => {
    expect(canCommitTouchMark("pinch", true, 0)).toBe(false);
    expect(canCommitTouchMark("marking", true, 0)).toBe(false);
    expect(canCommitTouchMark("marking", false, 1)).toBe(false);
    expect(canCommitTouchMark("marking", false, 0)).toBe(true);
  });

  it("maps a client point through the actual transformed image rect", () => {
    expect(clientToNormalizedImagePoint(250, 325, {
      left: 100, top: 200, width: 300, height: 250,
    })).toEqual({ x: 0.5, y: 0.5 });
    expect(clientToNormalizedImagePoint(99, 325, {
      left: 100, top: 200, width: 300, height: 250,
    })).toBeNull();
  });

  it("clamps both pan axes to the visible image bounds", () => {
    expect(clampImagePan(
      { x: 999, y: -999 },
      2,
      { width: 300, height: 200 },
      { width: 300, height: 200 },
    )).toEqual({ x: 150, y: -100 });
    expect(clampImagePan(
      { x: 10, y: 10 },
      1,
      { width: 300, height: 200 },
      { width: 300, height: 200 },
    )).toEqual({ x: 0, y: 0 });
  });

  it("keeps the image point under the pinch focal point stationary", () => {
    const viewport = { left: 100, top: 200, width: 300, height: 200 };
    const currentPan = { x: 30, y: -10 };
    const nextPan = zoomPanAtFocalPoint(
      1.5, currentPan, 2, 250, 300, viewport,
      { width: 300, height: 200 },
    );
    const focalOffset = { x: 0, y: 0 };
    const imagePoint = {
      x: (focalOffset.x - currentPan.x) / 1.5,
      y: (focalOffset.y - currentPan.y) / 1.5,
    };
    expect(nextPan.x + imagePoint.x * 2).toBeCloseTo(focalOffset.x);
    expect(nextPan.y + imagePoint.y * 2).toBeCloseTo(focalOffset.y);
  });
});