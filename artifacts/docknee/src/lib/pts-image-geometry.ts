export interface ImagePoint {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface ViewportRect extends ImageSize {
  left: number;
  top: number;
}

export type PtsTouchMode = "none" | "marking" | "pan" | "pinch";

/**
 * A point is committed only by a clean, single-finger marking gesture. A
 * pinch deliberately uses mode="pinch" and multiTouch=true even when it began
 * while a point was pending, so lifting the pinch can never synthesize a mark.
 */
export function canCommitTouchMark(
  mode: PtsTouchMode,
  multiTouch: boolean,
  touchesRemaining: number,
): boolean {
  return mode === "marking" && !multiTouch && touchesRemaining === 0;
}

/**
 * Convert a client-space coordinate to the normalized coordinate used by the
 * PTS overlays. The rect must be the image's actual (possibly transformed)
 * bounding rect; using the container rect would be wrong when the image is
 * zoomed or panned.
 */
export function clientToNormalizedImagePoint(
  clientX: number,
  clientY: number,
  imageRect: ViewportRect,
): ImagePoint | null {
  if (imageRect.width <= 0 || imageRect.height <= 0) return null;
  const point = {
    x: (clientX - imageRect.left) / imageRect.width,
    y: (clientY - imageRect.top) / imageRect.height,
  };
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  return point;
}

/**
 * Keep the transformed image from exposing a blank edge. Pan is measured in
 * viewport CSS pixels relative to the centered, untransformed image.
 */
export function clampImagePan(
  offset: ImagePoint,
  zoom: number,
  imageSize: ImageSize,
  viewportSize: ImageSize,
  minZoom = 1,
): ImagePoint {
  if (zoom <= minZoom || imageSize.width <= 0 || imageSize.height <= 0) {
    return { x: 0, y: 0 };
  }
  const maxX = Math.max(0, (imageSize.width * zoom - viewportSize.width) / 2);
  const maxY = Math.max(0, (imageSize.height * zoom - viewportSize.height) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

/**
 * Calculate the next pan while keeping the image pixel under a pinch focal
 * point stationary. The focal point is in client coordinates and the
 * viewport rect is untransformed, so this remains stable while the image
 * itself is being transformed.
 */
export function zoomPanAtFocalPoint(
  currentZoom: number,
  currentPan: ImagePoint,
  nextZoom: number,
  focalClientX: number,
  focalClientY: number,
  viewportRect: ViewportRect,
  imageSize: ImageSize,
): ImagePoint {
  const focalX = focalClientX - (viewportRect.left + viewportRect.width / 2);
  const focalY = focalClientY - (viewportRect.top + viewportRect.height / 2);
  const safeCurrentZoom = Math.max(currentZoom, 1e-6);
  const imageX = (focalX - currentPan.x) / safeCurrentZoom;
  const imageY = (focalY - currentPan.y) / safeCurrentZoom;
  const nextPan = {
    x: focalX - imageX * nextZoom,
    y: focalY - imageY * nextZoom,
  };
  return clampImagePan(nextPan, nextZoom, imageSize, viewportRect);
}