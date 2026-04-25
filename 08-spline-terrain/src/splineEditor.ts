// SVG-based visual editor for the three terrain-shape splines.
// Public factories: buildSplineGraph, buildAnchoredSplineGraph, buildSplineShapeToolbar.

import type { Spline, AnchoredSpline, TerrainShape } from "./splines";
import { DEFAULT_TERRAIN_SHAPE } from "./splines";

// ---------- Style + layout constants ----------

export const ANCHOR_PALETTE = [
  "#7ab8ff", "#f7a072", "#b5e48c", "#c77dff", "#ffd166",
] as const;

const PLOT = {
  vbW: 260,
  vbH: 150,
  left: 22,
  top: 6,
  right: 250,
  bottom: 136,
} as const;
// width = right - left = 228; height = bottom - top = 130.

const COLORS = {
  frame: "#0a1226",
  axis: "#34406a",
  grid: "#1f2848",
  curve: "#7ab8ff",
  point: "#e94560",
  pointHover: "#ffd166",
  label: "#7a8aa8",
  tip: "#16213e",
  tipText: "#e9ecef",
} as const;

const X_RANGE: [number, number] = [-1, 1];

// ---------- Public factory stubs (filled in by later tasks) ----------

export interface SplineGraphOpts {
  getSpline: () => Spline;
  setSpline: (s: Spline) => void;
  xRange: [number, number];
  yRange: [number, number];
  xLabel?: string;
}

export interface SplineGraphHandle {
  element: HTMLElement;
  rerender(): void;
}

export function buildSplineGraph(_opts: SplineGraphOpts): SplineGraphHandle {
  const element = document.createElement("div");
  return { element, rerender: () => {} };
}

export interface AnchoredSplineGraphOpts {
  getList: () => AnchoredSpline[];
  setList: (l: AnchoredSpline[]) => void;
  xRange: [number, number];
  yRange: [number, number];
  xLabel: string;
  anchorLabel: string;
}

export function buildAnchoredSplineGraph(_opts: AnchoredSplineGraphOpts): SplineGraphHandle {
  const element = document.createElement("div");
  return { element, rerender: () => {} };
}

export interface SplineShapeToolbarOpts {
  getShape: () => TerrainShape;
  setShape: (s: TerrainShape) => void;
  onChange: () => void;
}

export function buildSplineShapeToolbar(_opts: SplineShapeToolbarOpts): { element: HTMLElement } {
  const element = document.createElement("div");
  return { element };
}

// Re-export so debugPanel can hand defaults to the toolbar's reset.
export { DEFAULT_TERRAIN_SHAPE };

// Y-range constants live with each section's wiring in debugPanel.
export const Y_RANGE_CONTINENT: [number, number] = [-50, 110];
export const Y_RANGE_EROSION: [number, number]   = [-50, 50];
export const Y_RANGE_PV: [number, number]        = [-30, 30];

export { X_RANGE, PLOT, COLORS };
