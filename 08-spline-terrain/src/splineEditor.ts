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

// ---------- Coordinate helpers ----------

interface ScreenRect {
  left: number; top: number; right: number; bottom: number;
}

function dataToScreen(
  x: number, y: number,
  xRange: [number, number], yRange: [number, number],
  rect: ScreenRect = PLOT,
): { sx: number; sy: number } {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  const sx = rect.left + ((x - xRange[0]) / (xRange[1] - xRange[0])) * w;
  // y axis inverted: data max is at the top
  const sy = rect.top + (1 - (y - yRange[0]) / (yRange[1] - yRange[0])) * h;
  return { sx, sy };
}

function screenToData(
  sx: number, sy: number,
  xRange: [number, number], yRange: [number, number],
  rect: ScreenRect = PLOT,
): { x: number; y: number } {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  const x = xRange[0] + ((sx - rect.left) / w) * (xRange[1] - xRange[0]);
  const y = yRange[0] + (1 - (sy - rect.top) / h) * (yRange[1] - yRange[0]);
  return { x, y };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(name: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// Returns frame + axes + gridlines + tick labels as a static <g> the caller
// inserts behind everything else. Y-gridlines: zero, plus midpoint if range
// spans more than 50 units.
function renderFrame(
  parent: SVGElement,
  xRange: [number, number], yRange: [number, number],
  xLabel?: string,
): void {
  const frame = svg("rect", {
    x: PLOT.left, y: PLOT.top,
    width: PLOT.right - PLOT.left,
    height: PLOT.bottom - PLOT.top,
    fill: COLORS.frame,
    stroke: COLORS.axis, "stroke-width": 0.5,
  });
  parent.appendChild(frame);

  // X = 0 gridline if 0 is inside xRange
  if (xRange[0] < 0 && 0 < xRange[1]) {
    const { sx } = dataToScreen(0, 0, xRange, yRange);
    parent.appendChild(svg("line", {
      x1: sx, y1: PLOT.top, x2: sx, y2: PLOT.bottom,
      stroke: COLORS.grid, "stroke-width": 0.5,
    }));
  }
  // Y = 0 gridline if 0 is inside yRange
  if (yRange[0] < 0 && 0 < yRange[1]) {
    const { sy } = dataToScreen(0, 0, xRange, yRange);
    parent.appendChild(svg("line", {
      x1: PLOT.left, y1: sy, x2: PLOT.right, y2: sy,
      stroke: COLORS.grid, "stroke-width": 0.5,
    }));
  }
  // Y midpoint gridline if range > 50
  if (yRange[1] - yRange[0] > 50) {
    const mid = (yRange[0] + yRange[1]) / 2;
    const { sy } = dataToScreen(0, mid, xRange, yRange);
    parent.appendChild(svg("line", {
      x1: PLOT.left, y1: sy, x2: PLOT.right, y2: sy,
      stroke: COLORS.grid, "stroke-width": 0.5,
    }));
  }

  // Axes
  parent.appendChild(svg("line", {
    x1: PLOT.left, y1: PLOT.bottom, x2: PLOT.right, y2: PLOT.bottom,
    stroke: COLORS.axis, "stroke-width": 0.5,
  }));
  parent.appendChild(svg("line", {
    x1: PLOT.left, y1: PLOT.top, x2: PLOT.left, y2: PLOT.bottom,
    stroke: COLORS.axis, "stroke-width": 0.5,
  }));

  // X tick labels: min, 0 (if in range), max
  const xTicks: number[] = [xRange[0]];
  if (xRange[0] < 0 && 0 < xRange[1]) xTicks.push(0);
  xTicks.push(xRange[1]);
  for (const xv of xTicks) {
    const { sx } = dataToScreen(xv, 0, xRange, yRange);
    const t = svg("text", {
      x: sx, y: PLOT.bottom + 10,
      "text-anchor": "middle",
      fill: COLORS.label,
      "font-size": 7,
      "font-family": "monospace",
    });
    t.textContent = formatTick(xv);
    parent.appendChild(t);
  }

  if (xLabel) {
    const xMid = (PLOT.left + PLOT.right) / 2;
    const t = svg("text", {
      x: xMid, y: PLOT.bottom + 22,
      "text-anchor": "middle",
      fill: COLORS.label,
      "font-size": 7,
      "font-family": "monospace",
    });
    t.textContent = xLabel;
    parent.appendChild(t);
  }

  // Y tick labels: min, 0 (if in range), midpoint (if range > 50), max
  const yTicks: number[] = [yRange[0]];
  if (yRange[0] < 0 && 0 < yRange[1]) yTicks.push(0);
  if (yRange[1] - yRange[0] > 50) yTicks.push((yRange[0] + yRange[1]) / 2);
  yTicks.push(yRange[1]);
  for (const yv of yTicks) {
    const { sy } = dataToScreen(0, yv, xRange, yRange);
    const t = svg("text", {
      x: PLOT.left - 3, y: sy + 2,
      "text-anchor": "end",
      fill: COLORS.label,
      "font-size": 7,
      "font-family": "monospace",
    });
    t.textContent = formatTick(yv);
    parent.appendChild(t);
  }
}

function formatTick(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // x ticks like -1, 0, 1, or fractions like 0.5
  return v.toFixed(2).replace(/\.?0+$/, "");
}

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
