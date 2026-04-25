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

// ---------- Shared pointer-handler helper ----------

interface PointerHandlerOpts {
  svgEl: SVGSVGElement;
  overlayLayer: SVGGElement;
  getSpline: () => Spline;
  setSpline: (s: Spline) => void;
  rerender: () => void;
  xRange: [number, number];
  yRange: [number, number];
}

const EPS = 1e-4;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clientToSvg(svgEl: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svgEl.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function pointHitIndex(s: Spline, sx: number, sy: number,
                      xRange: [number, number], yRange: [number, number],
                      tolerance = 5): number {
  for (let i = 0; i < s.length; i++) {
    const sp = dataToScreen(s[i].x, s[i].y, xRange, yRange);
    const dx = sp.sx - sx;
    const dy = sp.sy - sy;
    if (dx * dx + dy * dy <= tolerance * tolerance) return i;
  }
  return -1;
}

function interpY(s: Spline, x: number): number {
  if (x <= s[0].x) return s[0].y;
  if (x >= s[s.length - 1].x) return s[s.length - 1].y;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (a.x <= x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return s[s.length - 1].y;
}

function inPlot(sx: number, sy: number): boolean {
  return sx >= PLOT.left && sx <= PLOT.right && sy >= PLOT.top && sy <= PLOT.bottom;
}

function showTooltip(layer: SVGGElement, sx: number, sy: number, text: string): void {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
  const padX = 4, padY = 9;
  const w = Math.max(38, text.length * 4 + 8);
  const h = 12;
  // Position above-right of the point; flip if near edges.
  let bx = sx + 6;
  let by = sy - h - 4;
  if (bx + w > PLOT.right) bx = sx - w - 6;
  if (by < PLOT.top) by = sy + 6;
  const rect = svg("rect", {
    x: bx, y: by, width: w, height: h, rx: 2,
    fill: COLORS.tip, stroke: COLORS.point, "stroke-width": 0.5,
  });
  layer.appendChild(rect);
  const t = svg("text", {
    x: bx + padX, y: by + padY,
    fill: COLORS.tipText, "font-size": 7, "font-family": "monospace",
  });
  t.textContent = text;
  layer.appendChild(t);
}

function hideTooltip(layer: SVGGElement): void {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
}

function fmtTip(x: number, y: number): string {
  return `x=${x.toFixed(2)}  y=${Math.round(y)}`;
}

function installSplinePointerHandlers(opts: PointerHandlerOpts): void {
  const { svgEl, overlayLayer, getSpline, setSpline, rerender, xRange, yRange } = opts;

  let dragIdx = -1;
  let activePointerId = -1;

  const onDown = (ev: PointerEvent) => {
    const cur0 = getSpline();
    if (cur0.length === 0) return; // no active spline (e.g. empty anchored list)
    if (ev.button === 2) {
      // Right-click: delete a point if hit.
      const { x: sx, y: sy } = clientToSvg(svgEl, ev.clientX, ev.clientY);
      const idx = pointHitIndex(cur0, sx, sy, xRange, yRange);
      if (idx >= 0) {
        if (cur0.length > 2) {
          setSpline(cur0.filter((_, i) => i !== idx));
          rerender();
          hideTooltip(overlayLayer);
        }
        ev.preventDefault();
      }
      return;
    }
    if (ev.button !== 0) return;
    const { x: sx, y: sy } = clientToSvg(svgEl, ev.clientX, ev.clientY);
    if (!inPlot(sx, sy)) return;
    const idx = pointHitIndex(cur0, sx, sy, xRange, yRange);
    if (idx >= 0) {
      dragIdx = idx;
      activePointerId = ev.pointerId;
      svgEl.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else {
      // Click-to-add at this (x, y).
      const { x, y } = screenToData(sx, sy, xRange, yRange);
      const newPt = { x, y: clamp(y, yRange[0], yRange[1]) };
      const next = [...cur0, newPt].sort((a, b) => a.x - b.x);
      setSpline(next);
      rerender();
      ev.preventDefault();
    }
  };

  const onMove = (ev: PointerEvent) => {
    const { x: sx, y: sy } = clientToSvg(svgEl, ev.clientX, ev.clientY);
    if (dragIdx >= 0 && ev.pointerId === activePointerId) {
      const cur = getSpline();
      const isFirst = dragIdx === 0;
      const isLast = dragIdx === cur.length - 1;
      const { x: rawX, y: rawY } = screenToData(sx, sy, xRange, yRange);
      let nx: number;
      if (isFirst) nx = xRange[0];
      else if (isLast) nx = xRange[1];
      else {
        const lo = cur[dragIdx - 1].x + EPS;
        const hi = cur[dragIdx + 1].x - EPS;
        nx = clamp(rawX, lo, hi);
      }
      const ny = clamp(rawY, yRange[0], yRange[1]);
      const next = cur.map((p, i) => i === dragIdx ? { x: nx, y: ny } : p);
      setSpline(next);
      rerender();
      showTooltip(overlayLayer, dataToScreen(nx, ny, xRange, yRange).sx,
                  dataToScreen(nx, ny, xRange, yRange).sy, fmtTip(nx, ny));
      ev.preventDefault();
      return;
    }
    // Hover: tooltip near a point or interpolated curve value.
    if (!inPlot(sx, sy)) { hideTooltip(overlayLayer); return; }
    const cur = getSpline();
    if (cur.length === 0) { hideTooltip(overlayLayer); return; }
    const idx = pointHitIndex(cur, sx, sy, xRange, yRange);
    if (idx >= 0) {
      const p = cur[idx];
      const sp = dataToScreen(p.x, p.y, xRange, yRange);
      showTooltip(overlayLayer, sp.sx, sp.sy, fmtTip(p.x, p.y));
    } else {
      const { x: dx } = screenToData(sx, sy, xRange, yRange);
      const dy = interpY(cur, dx);
      const sp = dataToScreen(dx, dy, xRange, yRange);
      showTooltip(overlayLayer, sp.sx, sp.sy, fmtTip(dx, dy));
    }
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId === activePointerId) {
      dragIdx = -1;
      activePointerId = -1;
      try { svgEl.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    }
  };

  const onLeave = () => { hideTooltip(overlayLayer); };

  const onContextMenu = (ev: MouseEvent) => { ev.preventDefault(); };

  svgEl.addEventListener("pointerdown", onDown);
  svgEl.addEventListener("pointermove", onMove);
  svgEl.addEventListener("pointerup", onUp);
  svgEl.addEventListener("pointercancel", onUp);
  svgEl.addEventListener("pointerleave", onLeave);
  svgEl.addEventListener("contextmenu", onContextMenu);
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

export function buildSplineGraph(opts: SplineGraphOpts): SplineGraphHandle {
  const { getSpline, xRange, yRange, xLabel } = opts;

  const element = document.createElement("div");
  element.style.cssText = "padding:4px 0;";

  const svgEl = svg("svg", {
    viewBox: `0 0 ${PLOT.vbW} ${PLOT.vbH}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
  }) as SVGSVGElement;
  svgEl.style.display = "block";
  svgEl.style.touchAction = "none";
  element.appendChild(svgEl);

  const frameLayer = svg("g") as SVGGElement;
  const curveLayer = svg("g") as SVGGElement;
  const pointLayer = svg("g") as SVGGElement;
  const overlayLayer = svg("g") as SVGGElement; // tooltip + hover halo
  svgEl.appendChild(frameLayer);
  svgEl.appendChild(curveLayer);
  svgEl.appendChild(pointLayer);
  svgEl.appendChild(overlayLayer);

  renderFrame(frameLayer, xRange, yRange, xLabel);

  const rerender = () => {
    while (curveLayer.firstChild) curveLayer.removeChild(curveLayer.firstChild);
    while (pointLayer.firstChild) pointLayer.removeChild(pointLayer.firstChild);

    const s = getSpline();
    const pointsAttr = s.map(p => {
      const { sx, sy } = dataToScreen(p.x, p.y, xRange, yRange);
      return `${sx.toFixed(2)},${sy.toFixed(2)}`;
    }).join(" ");

    curveLayer.appendChild(svg("polyline", {
      points: pointsAttr,
      fill: "none",
      stroke: COLORS.curve,
      "stroke-width": 1.4,
    }));

    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      const { sx, sy } = dataToScreen(p.x, p.y, xRange, yRange);
      const c = svg("circle", {
        cx: sx, cy: sy, r: 3,
        fill: COLORS.point,
        stroke: "#ffffff", "stroke-width": 1,
      });
      (c as SVGElement).setAttribute("data-idx", String(i));
      pointLayer.appendChild(c);
    }
  };

  installSplinePointerHandlers({
    svgEl,
    overlayLayer,
    getSpline,
    setSpline: opts.setSpline,
    rerender,
    xRange,
    yRange,
  });

  rerender();
  return { element, rerender };
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
