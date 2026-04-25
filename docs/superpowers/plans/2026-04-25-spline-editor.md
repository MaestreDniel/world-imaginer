# Visual Spline Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the numeric tables in the `08-spline-terrain` debug panel's three spline sections with draggable SVG graphs and add a focused export/import for the `TerrainShape` (all three splines together).

**Architecture:** New module `src/splineEditor.ts` exports three factories (`buildSplineGraph`, `buildAnchoredSplineGraph`, `buildSplineShapeToolbar`) plus a private shared pointer-handler helper. `src/debugPanel.ts` rewrites `buildSplineSection` / `buildAnchoredSection` as thin wrappers around the new factories and hosts the toolbar above the three spline sections. World regeneration stays decoupled from edits — it only fires on the existing "Apply & Regenerate" button.

**Tech Stack:** TypeScript (strict mode, ES2020, bundler resolution), Vite, no runtime dependencies, inline SVG for graph rendering. The repo has no test runner — every task ends with `npm run build` (typecheck + bundle) plus a manual smoke check in the dev server.

**Spec:** `docs/superpowers/specs/2026-04-25-spline-editor-design.md`

**Working directory for all commands:** `08-spline-terrain/`

---

## File map

- **Create** `08-spline-terrain/src/splineEditor.ts` — all new factories, the shared pointer-handler helper, and the per-section Y-range / palette constants. ~400 lines when finished.
- **Modify** `08-spline-terrain/src/debugPanel.ts` — replace the bodies of `buildSplineSection` and `buildAnchoredSection` with calls into `splineEditor.ts`; insert the new toolbar in `buildPanel` before the three spline-section appends at lines 308–321.

The plan grows `splineEditor.ts` incrementally so the build stays green after every task. `debugPanel.ts` is touched only after the underlying factory is fully working.

---

## Task 1: Scaffold `splineEditor.ts` with constants and stub exports

**Files:**
- Create: `08-spline-terrain/src/splineEditor.ts`

This task creates the file with all the public exports as stubs, plus the constants the rest of the plan will reference. The build must compile after this step; nothing in the UI changes yet because nothing imports it.

- [ ] **Step 1: Create `splineEditor.ts` with constants and empty factories**

Write the full file:

```ts
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
```

- [ ] **Step 2: Verify the project still builds**

Run: `cd 08-spline-terrain && npm run build`
Expected: build succeeds with no TypeScript errors. Bundle output appears in `dist/`.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): scaffold splineEditor module with constants and stub factories"
```

---

## Task 2: Coordinate helpers + axis/grid rendering

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Add the screen↔data coordinate helpers and a function that builds the static frame/axes/gridlines/labels for any plot. Still no UI change visible; nothing renders yet.

- [ ] **Step 1: Add `dataToScreen` / `screenToData` and `renderFrame` helpers**

Append to `splineEditor.ts` (after the constants, before the public factory stubs — keep the order: constants → private helpers → public factories):

```ts
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
```

- [ ] **Step 2: Verify the project still builds**

Run: `cd 08-spline-terrain && npm run build`
Expected: success, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): coordinate helpers and frame/axis renderer for splineEditor"
```

---

## Task 3: Implement `buildSplineGraph` (rendering only, no interactions)

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Replace the `buildSplineGraph` stub with a real renderer that draws the curve and control points using the getter, plus a `rerender` that re-reads. No interactivity yet; the result is read-only.

- [ ] **Step 1: Replace the `buildSplineGraph` stub**

Find the stub block:

```ts
export function buildSplineGraph(_opts: SplineGraphOpts): SplineGraphHandle {
  const element = document.createElement("div");
  return { element, rerender: () => {} };
}
```

Replace with:

```ts
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

  rerender();
  return { element, rerender };
}
```

- [ ] **Step 2: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): render-only buildSplineGraph"
```

---

## Task 4: Implement `installSplinePointerHandlers` (drag, click-add, right-click-delete, hover tooltip)

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Add a private helper that wires every interaction onto an existing `<svg>`. `buildSplineGraph` will call it next; `buildAnchoredSplineGraph` will reuse it later.

- [ ] **Step 1: Add the helper above the public factories**

Insert this block just above `export function buildSplineGraph(...)`:

```ts
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
```

- [ ] **Step 2: Wire the helper into `buildSplineGraph`**

In `buildSplineGraph`, just before the closing `return { element, rerender };`, add:

```ts
  installSplinePointerHandlers({
    svgEl,
    overlayLayer,
    getSpline,
    setSpline: opts.setSpline,
    rerender,
    xRange,
    yRange,
  });
```

- [ ] **Step 3: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): pointer handlers for spline graph (drag/add/delete/hover)"
```

---

## Task 5: Wire `buildSplineGraph` into the continentalness section in `debugPanel.ts`

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

Replace the body of `buildSplineSection` so the continentalness graph renders visually. The two anchored sections still use the old `buildAnchoredSection` for now — they get rewritten in later tasks.

- [ ] **Step 1: Add the import**

Find the existing imports near the top of `debugPanel.ts`:

```ts
import type { Spline, AnchoredSpline } from "./splines";
```

After it, add:

```ts
import { buildSplineGraph, Y_RANGE_CONTINENT, X_RANGE } from "./splineEditor";
```

- [ ] **Step 2: Replace `buildSplineSection` body**

Find the current implementation (`debugPanel.ts:495–580`):

```ts
  private buildSplineSection(
    title: string,
    getSpline: () => Spline,
    setSpline: (s: Spline) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    /* ...current numeric-table implementation... */
    this.splineRerenders.push(render);
    render();
    return wrapper;
  }
```

Replace the entire method with:

```ts
  private buildSplineSection(
    title: string,
    getSpline: () => Spline,
    setSpline: (s: Spline) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border-bottom:1px solid #2a2a4a;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 12px;background:#16213e;font-weight:bold;color:#e94560;cursor:pointer;";
    header.textContent = "▼ " + title;
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "padding:6px 12px;";
    wrapper.appendChild(body);

    let collapsed = false;
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      header.textContent = (collapsed ? "▶ " : "▼ ") + title;
    });

    const graph = buildSplineGraph({
      getSpline,
      setSpline,
      xRange: X_RANGE,
      yRange: Y_RANGE_CONTINENT,
      xLabel: "continentalness",
    });
    body.appendChild(graph.element);

    this.splineRerenders.push(graph.rerender);
    return wrapper;
  }
```

Note: this section is currently used only for the continentalness spline (`debugPanel.ts:308–312`), so wiring `Y_RANGE_CONTINENT` directly here is correct for now. The two anchored sections still call `buildAnchoredSection` (untouched yet).

- [ ] **Step 3: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 4: Manual smoke check in the browser**

Run: `cd 08-spline-terrain && npm run dev`

Open the debug panel and expand "Splines · Continentalness → Height". Verify:

- A graph renders in place of the old numeric rows, showing the default continentalness curve (rises from −40 at x=−1 toward 100 at x=1, with the visible "shore" jump near x≈−0.2).
- Drag a control point — the curve updates as you drag, the tooltip shows live values, and the point stays inside the graph.
- Click empty area inside the plot — a new point appears at the click position.
- Right-click a point — it disappears (won't drop below 2 points).
- Hover near a point and away from any point — tooltip values look right.
- The two anchored sections below it still render with the old numeric-table UI (those get rewritten next).
- Click "Apply & Regenerate" — terrain re-runs with the edited spline.

Stop the dev server (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): swap continentalness numeric table for SVG graph"
```

---

## Task 6: Render-only `buildAnchoredSplineGraph` (overlay + legend, no anchor activation logic yet)

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Replace the `buildAnchoredSplineGraph` stub with one that renders the dimmed background curves, the active curve + points, and the legend chips. Activation/edit logic comes in the next two tasks. The function is exported but not yet called from `debugPanel.ts`.

- [ ] **Step 1: Replace the stub**

Find:

```ts
export function buildAnchoredSplineGraph(_opts: AnchoredSplineGraphOpts): SplineGraphHandle {
  const element = document.createElement("div");
  return { element, rerender: () => {} };
}
```

Replace with:

```ts
export function buildAnchoredSplineGraph(opts: AnchoredSplineGraphOpts): SplineGraphHandle {
  const { getList, setList, xRange, yRange, xLabel, anchorLabel } = opts;

  const element = document.createElement("div");
  element.style.cssText = "padding:4px 0;";

  // Legend strip
  const legend = document.createElement("div");
  legend.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;";
  element.appendChild(legend);

  // SVG plot
  const svgEl = svg("svg", {
    viewBox: `0 0 ${PLOT.vbW} ${PLOT.vbH}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
  }) as SVGSVGElement;
  svgEl.style.display = "block";
  svgEl.style.touchAction = "none";
  element.appendChild(svgEl);

  // Add-anchor row
  const addRow = document.createElement("div");
  addRow.textContent = "+ Add anchor";
  addRow.style.cssText = "margin-top:6px;color:#0f3460;cursor:pointer;font-size:0.7rem;";
  element.appendChild(addRow);

  const frameLayer    = svg("g") as SVGGElement;
  const dimmedLayer   = svg("g") as SVGGElement;
  const activeCurve   = svg("g") as SVGGElement;
  const activePoints  = svg("g") as SVGGElement;
  const overlayLayer  = svg("g") as SVGGElement;
  svgEl.appendChild(frameLayer);
  svgEl.appendChild(dimmedLayer);
  svgEl.appendChild(activeCurve);
  svgEl.appendChild(activePoints);
  svgEl.appendChild(overlayLayer);

  renderFrame(frameLayer, xRange, yRange, xLabel);

  // Active anchor tracked by reference identity, not index.
  let activeRef: AnchoredSpline | null = null;

  const colorFor = (i: number): string => ANCHOR_PALETTE[i % ANCHOR_PALETTE.length];

  const ensureActive = (list: AnchoredSpline[]): AnchoredSpline | null => {
    if (list.length === 0) { activeRef = null; return null; }
    if (activeRef && list.includes(activeRef)) return activeRef;
    activeRef = list[0];
    return activeRef;
  };

  const renderLegend = (list: AnchoredSpline[]) => {
    legend.innerHTML = "";
    list.forEach((entry, i) => {
      const isActive = entry === activeRef;
      const chip = document.createElement("div");
      chip.style.cssText = `
        display:flex;align-items:center;gap:4px;
        padding:2px 6px;border-radius:3px;font-size:0.66rem;
        background:${isActive ? "#1a2748" : "transparent"};
        border:1px solid ${isActive ? colorFor(i) : "#333"};
        cursor:pointer;
      `;
      const swatch = document.createElement("span");
      swatch.style.cssText = `width:8px;height:8px;border-radius:50%;background:${colorFor(i)};display:inline-block;`;
      const label = document.createElement("span");
      label.textContent = `${anchorLabel}=`;
      label.style.cssText = "color:#aaa;";
      const input = document.createElement("input");
      input.type = "number"; input.step = "0.01";
      input.value = String(entry.anchor);
      input.style.cssText = "width:50px;background:#0f3460;color:#cfe;border:1px solid #555;border-radius:3px;padding:1px 4px;font-size:0.66rem;font-family:monospace;";
      const del = document.createElement("span");
      del.textContent = "×";
      del.style.cssText = "color:#e94560;cursor:pointer;padding:0 2px;";

      chip.appendChild(swatch);
      chip.appendChild(label);
      chip.appendChild(input);
      chip.appendChild(del);
      legend.appendChild(chip);

      // Activation by clicking the chip (filled in by Task 7)
      chip.addEventListener("click", () => { /* filled in by Task 7 */ });
      input.addEventListener("change", () => { /* filled in by Task 8 */ });
      del.addEventListener("click", () => { /* filled in by Task 8 */ });
    });
  };

  const drawCurves = (list: AnchoredSpline[]) => {
    while (dimmedLayer.firstChild)  dimmedLayer.removeChild(dimmedLayer.firstChild);
    while (activeCurve.firstChild)  activeCurve.removeChild(activeCurve.firstChild);
    while (activePoints.firstChild) activePoints.removeChild(activePoints.firstChild);

    list.forEach((entry, i) => {
      const color = colorFor(i);
      const ptsAttr = entry.spline.map(p => {
        const { sx, sy } = dataToScreen(p.x, p.y, xRange, yRange);
        return `${sx.toFixed(2)},${sy.toFixed(2)}`;
      }).join(" ");
      const isActive = entry === activeRef;
      if (!isActive) {
        dimmedLayer.appendChild(svg("polyline", {
          points: ptsAttr, fill: "none",
          stroke: color, "stroke-width": 1.4,
          opacity: 0.35,
        }));
      } else {
        activeCurve.appendChild(svg("polyline", {
          points: ptsAttr, fill: "none",
          stroke: color, "stroke-width": 1.4,
        }));
        for (let j = 0; j < entry.spline.length; j++) {
          const p = entry.spline[j];
          const { sx, sy } = dataToScreen(p.x, p.y, xRange, yRange);
          activePoints.appendChild(svg("circle", {
            cx: sx, cy: sy, r: 3,
            fill: COLORS.point, stroke: "#ffffff", "stroke-width": 1,
          }));
        }
      }
    });
  };

  const rerender = () => {
    const list = getList();
    ensureActive(list);
    renderLegend(list);
    drawCurves(list);
  };

  // + Add anchor button (filled in by Task 8)
  addRow.addEventListener("click", () => { /* filled in by Task 8 */ });

  // Pointer handlers wired in Task 7 (activation) and Task 8 wraps them so the
  // active spline is what gets edited. For now: nothing reacts on the SVG.

  rerender();
  return { element, rerender };
}
```

- [ ] **Step 2: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): render-only buildAnchoredSplineGraph (overlay + legend chips)"
```

---

## Task 7: Activate anchor by chip click and dimmed-curve click; wire pointer handlers to active spline

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Add chip-click activation, dimmed-curve-click activation, and pointer handlers that edit whichever anchor is active.

- [ ] **Step 1: Replace the placeholder chip click handler**

In `renderLegend`, find:

```ts
      chip.addEventListener("click", () => { /* filled in by Task 7 */ });
```

Replace with:

```ts
      chip.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        // Don't activate when clicking the value input or × button.
        if (target === input || target === del) return;
        if (activeRef !== entry) {
          activeRef = entry;
          rerender();
        }
      });
```

- [ ] **Step 2: Add dimmed-curve hit-test for activation**

In `buildAnchoredSplineGraph`, just before the final `rerender();` call, install pointer handlers on the SVG. Add this block:

```ts
  // Pointer behavior: clicking a dimmed curve activates that anchor.
  // Otherwise delegate to installSplinePointerHandlers acting on the active spline.
  const segHitsCurve = (sx: number, sy: number, sp: Spline, tolerance = 4): boolean => {
    for (let i = 0; i < sp.length - 1; i++) {
      const a = dataToScreen(sp[i].x, sp[i].y, xRange, yRange);
      const b = dataToScreen(sp[i + 1].x, sp[i + 1].y, xRange, yRange);
      // Distance from point (sx,sy) to segment (a)-(b)
      const dx = b.sx - a.sx, dy = b.sy - a.sy;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((sx - a.sx) * dx + (sy - a.sy) * dy) / len2;
      t = clamp(t, 0, 1);
      const px = a.sx + t * dx, py = a.sy + t * dy;
      const ex = sx - px, ey = sy - py;
      if (ex * ex + ey * ey <= tolerance * tolerance) return true;
    }
    return false;
  };

  svgEl.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const { x: sx, y: sy } = clientToSvg(svgEl, ev.clientX, ev.clientY);
    const list = getList();
    if (!activeRef) return;
    // If the click is on a non-active curve and not on the active one, activate it.
    const onActive = segHitsCurve(sx, sy, activeRef.spline);
    const onActivePoint = pointHitIndex(activeRef.spline, sx, sy, xRange, yRange) >= 0;
    if (!onActive && !onActivePoint) {
      for (const entry of list) {
        if (entry === activeRef) continue;
        if (segHitsCurve(sx, sy, entry.spline)) {
          activeRef = entry;
          rerender();
          ev.stopImmediatePropagation();
          return;
        }
      }
    }
  }, true); // capture phase so we can pre-empt the editing handler

  installSplinePointerHandlers({
    svgEl,
    overlayLayer,
    getSpline: () => activeRef ? activeRef.spline : [],
    setSpline: (s) => {
      if (!activeRef) return;
      const list = getList();
      const next = list.map(e => e === activeRef ? { ...e, spline: s } : e);
      // The mapped entry is a new object; find it by the freshly-set spline ref
      // so activeRef stays aligned with the list we just produced.
      const updated = next.find(e => e.spline === s);
      if (updated) activeRef = updated;
      setList(next);
    },
    rerender,
    xRange,
    yRange,
  });
```

- [ ] **Step 3: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): anchor activation via chip and dimmed-curve click; route edits to active spline"
```

---

## Task 8: Anchor value editing, add anchor, delete anchor

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Wire up the three remaining placeholder handlers in `buildAnchoredSplineGraph`.

- [ ] **Step 1: Replace the anchor-value `change` handler**

Find:

```ts
      input.addEventListener("change", () => { /* filled in by Task 8 */ });
```

Replace with:

```ts
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) { input.value = String(entry.anchor); return; }
        const clamped = clamp(v, xRange[0], xRange[1]);
        const list = getList();
        const next = list
          .map(e => e === entry ? { ...e, anchor: clamped } : e)
          .sort((a, b) => a.anchor - b.anchor);
        // Keep activeRef pointing at the same anchor by identity.
        const updated = next.find(e => e.spline === entry.spline);
        if (updated) activeRef = updated;
        setList(next);
        rerender();
      });
```

- [ ] **Step 2: Replace the delete-anchor handler**

Find:

```ts
      del.addEventListener("click", () => { /* filled in by Task 8 */ });
```

Replace with:

```ts
      del.addEventListener("click", (ev) => {
        ev.stopPropagation(); // don't trigger chip-click activation
        const list = getList();
        if (list.length <= 1) return;
        const removeIdx = list.indexOf(entry);
        const next = list.filter((_, j) => j !== removeIdx);
        if (activeRef === entry) {
          activeRef = next[Math.max(0, removeIdx - 1)] ?? next[0] ?? null;
        }
        setList(next);
        rerender();
      });
```

- [ ] **Step 3: Replace the add-anchor handler**

Find:

```ts
  addRow.addEventListener("click", () => { /* filled in by Task 8 */ });
```

Replace with:

```ts
  addRow.addEventListener("click", () => {
    const list = getList();
    const lastAnchor = list.length ? list[list.length - 1].anchor : 0;
    const newAnchor = clamp(lastAnchor + 0.1, xRange[0], xRange[1]);
    const newEntry: AnchoredSpline = {
      anchor: newAnchor,
      spline: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
    };
    const next = [...list, newEntry].sort((a, b) => a.anchor - b.anchor);
    activeRef = next.find(e => e.spline === newEntry.spline) ?? newEntry;
    setList(next);
    rerender();
  });
```

- [ ] **Step 4: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): anchor value editing, add and delete anchor"
```

---

## Task 9: Wire `buildAnchoredSplineGraph` into the two anchored sections in `debugPanel.ts`

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

Replace `buildAnchoredSection` so the erosion and P&V sections use the overlay graph. Both call sites (`debugPanel.ts:313–321`) keep their current shape — only the section internals change.

- [ ] **Step 1: Extend the import**

Replace:

```ts
import { buildSplineGraph, Y_RANGE_CONTINENT, X_RANGE } from "./splineEditor";
```

with:

```ts
import {
  buildSplineGraph,
  buildAnchoredSplineGraph,
  Y_RANGE_CONTINENT,
  Y_RANGE_EROSION,
  Y_RANGE_PV,
  X_RANGE,
} from "./splineEditor";
```

- [ ] **Step 2: Replace `buildAnchoredSection`**

Find the current method (`debugPanel.ts:582–678`) — it's the long one with the per-anchor accordion that inlines `buildSplineSection`. Replace the entire method with:

```ts
  private buildAnchoredSection(
    title: string,
    getList: () => AnchoredSpline[],
    setList: (l: AnchoredSpline[]) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border-bottom:1px solid #2a2a4a;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 12px;background:#16213e;font-weight:bold;color:#e94560;cursor:pointer;";
    header.textContent = "▼ " + title;
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "padding:6px 12px;";
    wrapper.appendChild(body);

    let collapsed = false;
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      header.textContent = (collapsed ? "▶ " : "▼ ") + title;
    });

    // Pick Y-range and labels based on which list this is.
    const isErosion = title.toLowerCase().includes("erosion (by");
    const yRange = isErosion ? Y_RANGE_EROSION : Y_RANGE_PV;
    const xLabel = isErosion ? "erosion" : "peaks & valleys";
    const anchorLabel = isErosion ? "cont" : "ero";

    const graph = buildAnchoredSplineGraph({
      getList,
      setList,
      xRange: X_RANGE,
      yRange,
      xLabel,
      anchorLabel,
    });
    body.appendChild(graph.element);

    this.splineRerenders.push(graph.rerender);
    return wrapper;
  }
```

- [ ] **Step 3: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 4: Manual smoke check**

Run: `cd 08-spline-terrain && npm run dev`

Expand "Splines · Erosion (by Continentalness)" and "Splines · Peaks & Valleys (by Erosion)". Verify:

- Each section shows an overlaid graph with a legend strip above it.
- Default erosion section has 2 chips (`cont=-0.20`, `cont=0.40`) in different colors. P&V has 2 chips (`ero=-0.5`, `ero=0.5`).
- The first anchor's curve renders bright with control points; the other curves are dimmed (~35% opacity) with no points.
- Click a non-active legend chip — that anchor becomes active (border + background highlight), its curve becomes bright, and its points become draggable.
- Click on a dimmed curve in the plot — same effect.
- Drag a point on the active curve — only that curve updates.
- Edit an anchor value in a chip — the chip list resorts; the same anchor stays active.
- Click "+ Add anchor" — a new chip appears with a flat default spline; it becomes active.
- Click `×` on a non-required chip — the anchor is removed; if it was active, the previous chip becomes active.
- Click "Apply & Regenerate" — terrain re-runs reflecting the edits.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): swap erosion and P&V numeric tables for overlay SVG graphs"
```

---

## Task 10: Implement `buildSplineShapeToolbar` (export, import, reset)

**Files:**
- Modify: `08-spline-terrain/src/splineEditor.ts`

Replace the `buildSplineShapeToolbar` stub with a real toolbar.

- [ ] **Step 1: Replace the stub**

Find:

```ts
export function buildSplineShapeToolbar(_opts: SplineShapeToolbarOpts): { element: HTMLElement } {
  const element = document.createElement("div");
  return { element };
}
```

Replace with:

```ts
function deepCloneShape(s: TerrainShape): TerrainShape {
  return JSON.parse(JSON.stringify(s)) as TerrainShape;
}

function isSpline(value: unknown): value is Spline {
  return Array.isArray(value)
    && value.length >= 2
    && value.every(p => p && typeof (p as { x: unknown }).x === "number"
                          && typeof (p as { y: unknown }).y === "number");
}

function isAnchoredList(value: unknown): value is AnchoredSpline[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.every(e => e && typeof (e as { anchor: unknown }).anchor === "number"
                          && isSpline((e as { spline: unknown }).spline));
}

function validateAndNormalize(raw: unknown): TerrainShape | null {
  if (!raw || typeof raw !== "object") return null;
  const shape = (raw as { shape?: unknown }).shape;
  if (!shape || typeof shape !== "object") return null;
  const s = shape as Record<string, unknown>;
  if (!isSpline(s.continent)) return null;
  if (!isAnchoredList(s.erosionByContinent)) return null;
  if (!isAnchoredList(s.pvByErosion)) return null;
  const continent = [...s.continent].sort((a, b) => a.x - b.x);
  const erosionByContinent = s.erosionByContinent
    .map(e => ({ anchor: e.anchor, spline: [...e.spline].sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.anchor - b.anchor);
  const pvByErosion = s.pvByErosion
    .map(e => ({ anchor: e.anchor, spline: [...e.spline].sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.anchor - b.anchor);
  return { continent, erosionByContinent, pvByErosion };
}

export function buildSplineShapeToolbar(opts: SplineShapeToolbarOpts): { element: HTMLElement } {
  const { getShape, setShape, onChange } = opts;

  const element = document.createElement("div");
  element.style.cssText = "padding:6px 12px;border-bottom:1px solid #2a2a4a;display:flex;gap:6px;align-items:center;";

  const btnStyle =
    "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;color:#ccc;";

  const exportBtn = document.createElement("span");
  exportBtn.textContent = "↓ Export shape";
  exportBtn.title = "Export terrain shape as JSON";
  exportBtn.style.cssText = btnStyle;
  exportBtn.addEventListener("click", () => {
    const data = JSON.stringify(
      { worldImaginerSplineShape: true, shape: getShape() },
      null, 2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "terrain-shape.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  const importBtn = document.createElement("span");
  importBtn.textContent = "↑ Import shape";
  importBtn.title = "Import terrain shape from JSON";
  importBtn.style.cssText = btnStyle;
  importBtn.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => alert("Failed to read shape file.");
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as { worldImaginerSplineShape?: unknown };
          if (data.worldImaginerSplineShape !== true) {
            alert("Not a valid spline shape file.");
            return;
          }
          const normalized = validateAndNormalize(data);
          if (!normalized) {
            alert("Not a valid spline shape file.");
            return;
          }
          setShape(normalized);
          onChange();
        } catch {
          alert("Not a valid spline shape file.");
        }
      };
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });

  const resetBtn = document.createElement("span");
  resetBtn.textContent = "Reset to defaults";
  resetBtn.title = "Restore the default terrain shape";
  resetBtn.style.cssText = btnStyle;
  resetBtn.addEventListener("click", () => {
    setShape(deepCloneShape(DEFAULT_TERRAIN_SHAPE));
    onChange();
  });

  element.appendChild(exportBtn);
  element.appendChild(importBtn);
  element.appendChild(resetBtn);
  return { element };
}
```

- [ ] **Step 2: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/splineEditor.ts
git commit -m "feat(08): spline shape toolbar (export, import, reset)"
```

---

## Task 11: Wire the shape toolbar into `debugPanel.ts`

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

Insert the toolbar element into the panel body just above the three spline-section appends.

- [ ] **Step 1: Extend the import**

Replace:

```ts
import {
  buildSplineGraph,
  buildAnchoredSplineGraph,
  Y_RANGE_CONTINENT,
  Y_RANGE_EROSION,
  Y_RANGE_PV,
  X_RANGE,
} from "./splineEditor";
```

with:

```ts
import {
  buildSplineGraph,
  buildAnchoredSplineGraph,
  buildSplineShapeToolbar,
  Y_RANGE_CONTINENT,
  Y_RANGE_EROSION,
  Y_RANGE_PV,
  X_RANGE,
} from "./splineEditor";
```

- [ ] **Step 2: Insert the toolbar before the three spline sections**

Find the block at `debugPanel.ts:308–322`:

```ts
    body.appendChild(this.buildSplineSection(
      "Splines · Continentalness → Height",
      () => this.params.shape.shape.continent,
      (s) => { this.params.shape.shape.continent = s; },
    ));
    body.appendChild(this.buildAnchoredSection(
      "Splines · Erosion (by Continentalness)",
      () => this.params.shape.shape.erosionByContinent,
      (l) => { this.params.shape.shape.erosionByContinent = l; },
    ));
    body.appendChild(this.buildAnchoredSection(
      "Splines · Peaks & Valleys (by Erosion)",
      () => this.params.shape.shape.pvByErosion,
      (l) => { this.params.shape.shape.pvByErosion = l; },
    ));
```

Insert this immediately before it:

```ts
    const splineToolbar = buildSplineShapeToolbar({
      getShape: () => this.params.shape.shape,
      setShape: (s) => { this.params.shape.shape = s; },
      onChange: () => { for (const r of this.splineRerenders) r(); },
    });
    body.appendChild(splineToolbar.element);
```

- [ ] **Step 3: Verify build**

Run: `cd 08-spline-terrain && npm run build`
Expected: success.

- [ ] **Step 4: Manual smoke check**

Run: `cd 08-spline-terrain && npm run dev`

Verify:

- A toolbar `[ ↓ Export shape ] [ ↑ Import shape ] [ Reset to defaults ]` appears just above the three spline sections.
- Edit a couple of points in the continentalness graph. Click "↓ Export shape" — a `terrain-shape.json` file downloads.
- Click "Reset to defaults" — all three graphs redraw with the default curves; the edits are gone.
- Click "↑ Import shape", pick the JSON you just downloaded — all three graphs redraw with the previously-edited shape.
- Try importing a random text file — alert: "Not a valid spline shape file." No state change.
- Try importing a *preset* file (export one via the existing preset row, then import here) — alert: "Not a valid spline shape file." (The preset uses a different magic key.)
- Click "Apply & Regenerate" — terrain re-runs with the imported shape.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): mount spline shape toolbar in debug panel"
```

---

## Task 12: End-to-end manual verification

**Files:** none (verification only).

Run the full validation list from the spec to confirm nothing regressed.

- [ ] **Step 1: Start the dev server**

Run: `cd 08-spline-terrain && npm run dev`

- [ ] **Step 2: Walk the validation checklist**

Confirm each of these works in the browser:

- Continentalness graph: drag a midpoint, click Apply, terrain regenerates with the new height map.
- Click empty area of any single graph → point added. Right-click → point removed (refuses below length 2).
- Hover a point: tooltip shows that point's `(x, y)`. Hover the curve elsewhere: tooltip follows with the interpolated y.
- Erosion section: clicking the legend chip switches active anchor. Clicking the dimmed curve also switches. Editing the active spline doesn't mutate the dimmed one.
- Add an anchor; type a new value into the new chip's input; the chip strip resorts and the new anchor stays active.
- Delete the active anchor; the previous one becomes active (or index 0 if it was first). Refuses if length would drop below 1.
- P&V section: same behaviors as the erosion section.
- Shape toolbar: export → reset → import → state matches the export.
- Existing preset Save / Load round-trips spline data unchanged (the preset includes `params.shape.shape`, so this is just regression cover).
- Apply & Regenerate triggers a world rebuild reflecting the edited splines (no auto-rebuild during drag).

If anything fails, fix it before the final commit.

- [ ] **Step 3: Stop the dev server and confirm the working tree is clean**

Run: `git status`
Expected: clean working tree (all earlier tasks committed).

- [ ] **Step 4 (optional): Update the original spec to drop the future-work entry**

Edit `docs/superpowers/specs/2026-04-19-spline-terrain-shaping-design.md`:

Find:

```md
- **Visual spline editor.** Replace the numeric rows with per-spline SVG
  graphs. Draggable control points, click-to-add, right-click-to-delete,
  hover tooltips with `(x, y)`. Matches the reference images that motivated
  this feature.
```

Remove that bullet (the feature is now built; leave the other future-work bullets).

Run: `cd 08-spline-terrain && npm run build` (confirms nothing was depending on that doc — it shouldn't be, but cheap to verify).

- [ ] **Step 5: Final commit**

```bash
git add docs/superpowers/specs/2026-04-19-spline-terrain-shaping-design.md
git commit -m "docs(08): drop visual-spline-editor future-work bullet (now built)"
```

---

## Notes for the implementer

- All paths are relative to the repo root unless prefixed with `08-spline-terrain/`. The `npm` commands run inside `08-spline-terrain/`.
- This project has no test runner; the verification is `npm run build` (typecheck) plus the per-task manual browser check.
- World regeneration only happens on "Apply & Regenerate" — `setSpline`, `setList`, and `setShape` only update `this.params.shape.shape`. Don't add a worker call during drag; it's intentional.
- The active-anchor reference identity must be preserved across `setList` calls. Every place that calls `setList` then re-reads must update `activeRef` to point at the new array's matching entry (the templates above all do this; preserve that pattern if you change them).
- If a step shows code, write that code verbatim. If a step shows a command, run that command. Don't optimize away "obvious" steps.
