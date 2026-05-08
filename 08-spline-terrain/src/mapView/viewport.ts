/**
 * Viewport state for the map view.
 *
 * blocksPerPixel is one of three discrete zoom levels. cx/cz are world
 * coordinates of the canvas center.
 */

export const ZOOM_LEVELS = [1, 2, 4] as const;
export type ZoomLevel = typeof ZOOM_LEVELS[number];

export interface Viewport {
  cx: number;
  cz: number;
  blocksPerPixel: ZoomLevel;
  width:  number;
  height: number;
}

/** Convert a canvas pixel (px, py) to a world (wx, wz). */
export function pixelToWorld(v: Viewport, px: number, py: number): { wx: number; wz: number } {
  return {
    wx: v.cx + (px - v.width  / 2) * v.blocksPerPixel,
    wz: v.cz + (py - v.height / 2) * v.blocksPerPixel,
  };
}

/** Cycle zoom one step in. Returns same level if already at the zoomed-in end. */
export function zoomIn(level: ZoomLevel): ZoomLevel {
  const i = ZOOM_LEVELS.indexOf(level);
  return i > 0 ? ZOOM_LEVELS[i - 1] : level;
}

/** Cycle zoom one step out. Returns same level if already at the zoomed-out end. */
export function zoomOut(level: ZoomLevel): ZoomLevel {
  const i = ZOOM_LEVELS.indexOf(level);
  return i < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[i + 1] : level;
}
