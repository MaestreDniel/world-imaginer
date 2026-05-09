// Piecewise-linear splines with anchor blending for terrain shaping.

export interface SplinePoint { x: number; y: number; }

/** Control points sorted by x, length >= 2. */
export type Spline = SplinePoint[];

/** A sub-spline anchored at a 1D key value (e.g. a continentalness band). */
export interface AnchoredSpline {
  anchor: number;
  spline: Spline;
}

export interface TerrainShape {
  /** continentalness in [-1,1] -> base height. */
  continent: Spline;
  /** Erosion sub-splines anchored at continentalness values, sorted by anchor. */
  erosionByContinent: AnchoredSpline[];
  /** Peaks & valleys sub-splines anchored at erosion values, sorted by anchor. */
  pvByErosion: AnchoredSpline[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear evaluation. Clamps to endpoints outside [x0, xN]. */
export function evalSpline(s: Spline, x: number): number {
  const n = s.length;
  if (x <= s[0].x) return s[0].y;
  if (x >= s[n - 1].x) return s[n - 1].y;

  // Binary search for segment [i, i+1] with s[i].x <= x < s[i+1].x.
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (s[mid].x <= x) lo = mid; else hi = mid;
  }
  const a = s[lo], b = s[hi];
  const t = (x - a.x) / (b.x - a.x);
  return lerp(a.y, b.y, t);
}

/**
 * Evaluate an anchored list by blending the two sub-splines bracketing `key`.
 * Clamps to first / last anchor outside the anchored range.
 */
export function evalAnchored(list: AnchoredSpline[], key: number, innerX: number): number {
  const n = list.length;
  if (n === 0) return 0;
  if (key <= list[0].anchor) return evalSpline(list[0].spline, innerX);
  if (key >= list[n - 1].anchor) return evalSpline(list[n - 1].spline, innerX);

  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].anchor <= key) lo = mid; else hi = mid;
  }
  const a = list[lo], b = list[hi];
  const t = (key - a.anchor) / (b.anchor - a.anchor);
  return lerp(evalSpline(a.spline, innerX), evalSpline(b.spline, innerX), t);
}

/** Default shape. Intended as a starting point users can tweak at runtime. */
export const DEFAULT_TERRAIN_SHAPE: TerrainShape = {
  continent: [
    { x: -1.0, y: -40 },
    { x: -0.3, y: -9 },
    { x: -0.05, y:  -5 },
    { x:  0.3, y:  40 },
    { x:  0.4, y:  90 },
    { x:  1.0, y: 100 },
  ],
  erosionByContinent: [
    { anchor: -0.2, spline: [{ x: -1, y:  2 }, { x: 0, y: 0 }, { x: 1, y:  -1 }] },
    { anchor:  0.4, spline: [{ x: -1, y: 40 }, { x: 0, y: 0 }, { x: 1, y: -10 }] },
  ],
  pvByErosion: [
    { anchor: -0.5, spline: [{ x: -1, y: -10 }, { x: 0, y: 0 }, { x: 1, y: 15 }] },
    { anchor:  0.5, spline: [{ x: -1, y:  -2 }, { x: 0, y: 0 }, { x: 1, y:  3 }] },
  ],
};
