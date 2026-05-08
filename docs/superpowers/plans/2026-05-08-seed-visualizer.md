# Seed visualizer (map view) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-down 2D biome+height map of project 08's world as a debug-panel toggleable view mode, with pan, discrete zoom, hover tooltip, and click-to-teleport.

**Architecture:** A new `mapView/` directory hosts a self-contained map renderer that consumes the existing `terrainShape`, `biomes`, and `biomeBoxes` modules without modifying them. `main.ts` toggles between the existing three.js view and a hidden 2D canvas. The renderer runs in two passes (pixel pass + empty marker pass reserved for future structure markers). Auto-refreshes on parameter change.

**Tech Stack:** TypeScript strict, Vite, plain DOM/Canvas2D for the map (no three.js), existing three.js stack for 3D unchanged.

**Spec:** `docs/superpowers/specs/2026-05-08-seed-visualizer-design.md`.

---

## File structure

**Created:**
- `08-spline-terrain/src/mapView/colors.ts` — palette + height-shading. Pure functions; no DOM, no I/O.
- `08-spline-terrain/src/mapView/viewport.ts` — `Viewport` data type, `ZOOM_LEVELS`, `pixelToWorld`. Pure data + math.
- `08-spline-terrain/src/mapView/render.ts` — `renderMap` (pixel pass + empty marker pass), `MarkerLayer` interface, `MARKER_LAYERS` array.
- `08-spline-terrain/src/mapView/index.ts` — `createMapView` factory: owns viewport state, drag state, classifier closure, DOM event listeners. Public `show / hide / refresh` API.

**Modified:**
- `08-spline-terrain/index.html` — add hidden map canvas, tooltip div, coord-readout div.
- `08-spline-terrain/src/main.ts` — instantiate map view; wire view-toggle handler; pause/resume three.js render loop; extend the `onApply` callback to call `mapView.refresh()`.
- `08-spline-terrain/src/debugPanel.ts` — add a "View" radio at the top of the panel; expose an `onViewChange` callback wired through the constructor.

No other files change.

---

## Task 1 — Add map-view DOM elements to `index.html`

**Files:**
- Modify: `08-spline-terrain/index.html`

- [ ] **Step 1: Add the new DOM elements**

In `index.html`, find the line `<canvas id="canvas"></canvas>` and add three new elements right after it:

```html
  <canvas id="canvas"></canvas>
  <canvas id="map-canvas" style="display:none; position:fixed; left:0; right:0; top:80px; margin:0 auto; background:#0a0a18; cursor:grab;"></canvas>
  <div id="map-tooltip" style="display:none; position:fixed; background:rgba(0,0,0,0.85); color:#e0e0e0; padding:0.4rem 0.6rem; border-radius:4px; font-family:monospace; font-size:0.75rem; line-height:1.4; pointer-events:none; z-index:25; white-space:pre;"></div>
  <div id="map-coord-readout" style="display:none; position:fixed; bottom:1rem; right:1rem; background:rgba(0,0,0,0.7); color:#e0e0e0; padding:0.3rem 0.6rem; border-radius:4px; font-family:monospace; font-size:0.75rem; pointer-events:none; z-index:15;"></div>
```

The map canvas, tooltip, and readout all start with `display:none`. The map canvas's `position:fixed` + `left:0; right:0; margin:0 auto` centers it horizontally; `top:80px` clears the toolbar+legend (matching the existing `renderer.setSize(window.innerWidth, window.innerHeight - 80)` offset).

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors (HTML changes don't affect TS).

- [ ] **Step 3: Smoke check**

Run `npm run dev` from `08-spline-terrain/`. Open the printed URL. The 3D world should render normally; nothing visibly different (the new elements are hidden).

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/index.html
git commit -m "feat(08): scaffold map-view DOM elements (hidden by default)"
```

---

## Task 2 — Implement `mapView/colors.ts`

**Files:**
- Create: `08-spline-terrain/src/mapView/colors.ts`

- [ ] **Step 1: Write the file**

Create `08-spline-terrain/src/mapView/colors.ts`:

```ts
import { Biome, type BiomeId } from "../biomes";

/**
 * Per-biome base color at sea level. Tweak to taste; not exposed
 * to the debug panel in the current spec.
 */
const BIOME_COLOR: Record<BiomeId, number> = {
  [Biome.Ocean]:          0x1E5A8A,
  [Biome.FrozenOcean]:    0x9CC4D6,
  [Biome.Beach]:          0xE8D8A0,
  [Biome.Desert]:         0xE6C77A,
  [Biome.Savanna]:        0xB6BC4D,
  [Biome.Plains]:         0x8FBE5A,
  [Biome.Forest]:         0x3F7B3A,
  [Biome.BirchForest]:    0x6FA055,
  [Biome.Taiga]:          0x4F7A6E,
  [Biome.Tundra]:         0xCBD9D8,
  [Biome.Mountains]:      0x8B7E70,
  [Biome.StonyPeaks]:     0xB0A89E,
  [Biome.WindsweptHills]: 0x6E8C5E,
};

/** Max water depth (in blocks) that produces additional darkening. */
const WATER_MAX_DEPTH = 30;
/** Darkening range for water: shallow → 0.3, deep → 0.8. */
const WATER_DARK_MIN  = 0.3;
const WATER_DARK_MAX  = 0.8;
/** Max land elevation (above water) that produces additional brightening. */
const LAND_MAX_HEIGHT = 60;
/** Brightening range for land: sea level → 0, peak → 0.4. */
const LAND_BRIGHT_MAX = 0.4;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Lerp a packed RGB color toward black by `t` (0..1). */
function darken(c: number, t: number): number {
  const r = ((c >> 16) & 0xff) * (1 - t);
  const g = ((c >>  8) & 0xff) * (1 - t);
  const b = ( c        & 0xff) * (1 - t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Lerp a packed RGB color toward white by `t` (0..1). */
function brighten(c: number, t: number): number {
  const r = ((c >> 16) & 0xff) + (255 - ((c >> 16) & 0xff)) * t;
  const g = ((c >>  8) & 0xff) + (255 - ((c >>  8) & 0xff)) * t;
  const b = ( c        & 0xff) + (255 - ( c        & 0xff)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * Final pixel color for a (biome, height) sample.
 * - Below or at waterLevel: water — darker as it gets deeper.
 * - Above waterLevel: land — brighter as it climbs.
 */
export function mapColor(biome: BiomeId, height: number, waterLevel: number): number {
  const base = BIOME_COLOR[biome];
  if (height <= waterLevel) {
    const depth = clamp01((waterLevel - height) / WATER_MAX_DEPTH);
    return darken(base, WATER_DARK_MIN + (WATER_DARK_MAX - WATER_DARK_MIN) * depth);
  }
  const above = clamp01((height - waterLevel) / LAND_MAX_HEIGHT);
  return brighten(base, above * LAND_BRIGHT_MAX);
}
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/mapView/colors.ts
git commit -m "feat(08): map-view biome palette and height shading"
```

---

## Task 3 — Implement `mapView/viewport.ts`

**Files:**
- Create: `08-spline-terrain/src/mapView/viewport.ts`

- [ ] **Step 1: Write the file**

Create `08-spline-terrain/src/mapView/viewport.ts`:

```ts
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
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/mapView/viewport.ts
git commit -m "feat(08): map-view viewport types and helpers"
```

---

## Task 4 — Implement `mapView/render.ts`

**Files:**
- Create: `08-spline-terrain/src/mapView/render.ts`

- [ ] **Step 1: Write the file**

Create `08-spline-terrain/src/mapView/render.ts`:

```ts
import { type BiomeId } from "../biomes";
import { type Viewport, pixelToWorld } from "./viewport";
import { mapColor } from "./colors";

export interface MarkerLayer {
  draw(viewport: Viewport, ctx: CanvasRenderingContext2D): void;
}

/**
 * Reserved for future structure-marker work (pyramids, igloos, etc.).
 * Currently empty; pixel pass renders alone.
 */
export const MARKER_LAYERS: MarkerLayer[] = [];

export type ClassifyFn = (wx: number, wz: number) => { biome: BiomeId; height: number };

/**
 * Two-pass renderer: pixel pass fills ImageData; marker pass invokes
 * any registered MarkerLayer entries.
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
): void {
  const img = ctx.createImageData(viewport.width, viewport.height);
  const data = img.data;
  for (let py = 0; py < viewport.height; py++) {
    for (let px = 0; px < viewport.width; px++) {
      const { wx, wz } = pixelToWorld(viewport, px, py);
      const { biome, height } = classify(wx, wz);
      const rgb = mapColor(biome, height, waterLevel);
      const idx = (py * viewport.width + px) * 4;
      data[idx]     = (rgb >> 16) & 0xff;
      data[idx + 1] = (rgb >>  8) & 0xff;
      data[idx + 2] =  rgb        & 0xff;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const layer of MARKER_LAYERS) layer.draw(viewport, ctx);
}
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/mapView/render.ts
git commit -m "feat(08): map-view two-pass renderer with marker scaffold"
```

---

## Task 5 — Skeleton `createMapView` (show/hide/refresh, no interactions)

**Files:**
- Create: `08-spline-terrain/src/mapView/index.ts`

This task creates the public API and minimal show/hide/refresh logic. Interactions (pan, zoom, hover, click) come in later tasks.

- [ ] **Step 1: Write the file**

Create `08-spline-terrain/src/mapView/index.ts`:

```ts
import { type GenerationParams } from "../generationParams";
import { classifyBiome, createBiomeSampler } from "../biomes";
import { createTerrainShaper } from "../terrainShape";
import { type Viewport, ZOOM_LEVELS } from "./viewport";
import { renderMap, type ClassifyFn } from "./render";

export interface MapViewHandle {
  show(): void;
  hide(): void;
  refresh(): void;
  /** Recenter the map at the given world coordinate. No-op until shown. */
  setCenter(wx: number, wz: number): void;
}

export interface MapViewConfig {
  canvas:         HTMLCanvasElement;
  tooltipEl:      HTMLElement;
  coordReadoutEl: HTMLElement;
  getSeedAndParams: () => { seed: number; params: GenerationParams; waterLevel: number };
  onTeleport:     (wx: number, wz: number, surfaceY: number) => void;
}

function buildClassifier(seed: number, params: GenerationParams): ClassifyFn {
  const shaper  = createTerrainShaper(seed, params);
  const climate = createBiomeSampler(seed, params.biomes);
  return (wx, wz) => {
    const sample = shaper.sampleClimate(wx, wz);
    const height = shaper.heightFromClimate(sample);
    const { temp, humid } = climate(wx, wz);
    const biome = classifyBiome(
      sample.continentalness, sample.erosion, sample.peaksValleys,
      temp, humid, params.biomePicker,
    );
    return { biome, height };
  };
}

export function createMapView(cfg: MapViewConfig): MapViewHandle {
  const ctx = cfg.canvas.getContext("2d");
  if (!ctx) throw new Error("createMapView: 2D context not available");

  const viewport: Viewport = {
    cx: 0,
    cz: 0,
    blocksPerPixel: ZOOM_LEVELS[0],   // start at 1 block/pixel
    width:  0,
    height: 0,
  };

  let classify: ClassifyFn = buildClassifier(0, cfg.getSeedAndParams().params);
  let waterLevel = 0;
  let isShown = false;
  let dirty = true;

  function sizeCanvasToViewport(): void {
    // Map canvas fills width below the toolbar (top:80px) and goes to bottom.
    const width  = window.innerWidth;
    const height = window.innerHeight - 80;
    cfg.canvas.width  = width;
    cfg.canvas.height = height;
    viewport.width  = width;
    viewport.height = height;
  }

  function rebuildClassifier(): void {
    const { seed, params, waterLevel: wl } = cfg.getSeedAndParams();
    classify = buildClassifier(seed, params);
    waterLevel = wl;
  }

  function render(): void {
    sizeCanvasToViewport();
    renderMap(ctx!, viewport, classify, waterLevel);
    dirty = false;
  }

  function show(): void {
    isShown = true;
    cfg.canvas.style.display = "block";
    cfg.coordReadoutEl.style.display = "block";
    if (dirty) {
      rebuildClassifier();
      render();
    }
  }

  function hide(): void {
    isShown = false;
    cfg.canvas.style.display = "none";
    cfg.tooltipEl.style.display = "none";
    cfg.coordReadoutEl.style.display = "none";
  }

  function refresh(): void {
    if (!isShown) {
      dirty = true;
      return;
    }
    rebuildClassifier();
    render();
  }

  function setCenter(wx: number, wz: number): void {
    viewport.cx = wx;
    viewport.cz = wz;
    if (isShown) render();
  }

  return { show, hide, refresh, setCenter };
}
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/mapView/index.ts
git commit -m "feat(08): map-view show/hide/refresh skeleton"
```

---

## Task 6 — Wire view toggle into debug panel and main.ts

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`
- Modify: `08-spline-terrain/src/main.ts`

This is the integration task: the user can now toggle between 3D and Map view, and on toggle the map renders for the first time.

- [ ] **Step 1: Add `onViewChange` to `DebugPanel`**

In `08-spline-terrain/src/debugPanel.ts`, find the `DebugPanel` class constructor (around line 283). The current signature is:

```ts
constructor(params: GenerationParams, onApply: (params: GenerationParams, randomizeSeed: boolean) => void) {
```

Change it to:

```ts
constructor(
  params: GenerationParams,
  onApply: (params: GenerationParams, randomizeSeed: boolean) => void,
  onViewChange: (mode: "3d" | "map") => void = () => {},
) {
```

(Default value `() => {}` keeps existing call sites working.)

In the constructor body, store the callback:

```ts
this.onViewChange = onViewChange;
```

Add the field at the top of the class (next to `private onApply`):

```ts
private onViewChange: (mode: "3d" | "map") => void;
```

- [ ] **Step 2: Render the View radio at the top of the panel**

Find the method that builds the panel DOM (search for where the `SECTIONS` loop is — around line 367–380). At the very top of the panel content (before the first SECTIONS entry is mounted), inject:

```ts
const viewRow = document.createElement("div");
viewRow.style.cssText = "padding:0.4rem 0.6rem; border-bottom:1px solid #333; display:flex; gap:0.8rem; align-items:center; font-size:0.8rem;";
viewRow.innerHTML = `
  <span>View:</span>
  <label style="cursor:pointer"><input type="radio" name="map-view-mode" value="3d" checked /> 3D</label>
  <label style="cursor:pointer"><input type="radio" name="map-view-mode" value="map" /> Map</label>
`;
body.appendChild(viewRow);
viewRow.querySelectorAll<HTMLInputElement>("input[name=map-view-mode]").forEach((r) => {
  r.addEventListener("change", () => {
    if (r.checked) this.onViewChange(r.value as "3d" | "map");
  });
});
```

(Use the actual panel-body variable name from the existing code — the same one Tasks 14 + 15 of the prior plan used; `body` per recent work.)

- [ ] **Step 3: Wire the toggle in `main.ts`**

In `08-spline-terrain/src/main.ts`, find the `DebugPanel` instantiation (around line 117):

```ts
const debugPanel = new DebugPanel(currentParams, (newParams, randomizeSeed) => {
  // ... existing body ...
});
```

Above it, add the map-view setup:

```ts
import { createMapView, type MapViewHandle } from "./mapView";
```

(Adjust the import line to land near the other imports at the top of the file.)

Below all the existing initialization but before `new DebugPanel(...)`, add:

```ts
const mapCanvas       = document.getElementById("map-canvas")        as HTMLCanvasElement;
const mapTooltip      = document.getElementById("map-tooltip")!;
const mapCoordReadout = document.getElementById("map-coord-readout")!;

let isMapView = false;

const mapView: MapViewHandle = createMapView({
  canvas:         mapCanvas,
  tooltipEl:      mapTooltip,
  coordReadoutEl: mapCoordReadout,
  getSeedAndParams: () => ({
    seed:       currentSeed,
    params:     currentParams,
    waterLevel: DEFAULT_CONFIG.waterLevel,
  }),
  onTeleport: (wx, wz, surfaceY) => {
    camera.position.set(wx, surfaceY + 2, wz);
    controls.target.set(wx, surfaceY + 2, wz);
  },
});

function setView(mode: "3d" | "map"): void {
  isMapView = (mode === "map");
  if (isMapView) {
    renderer.domElement.style.display = "none";
    mapView.show();
  } else {
    renderer.domElement.style.display = "block";
    mapView.hide();
  }
}
```

Then update the `DebugPanel` instantiation to pass the third callback:

```ts
const debugPanel = new DebugPanel(
  currentParams,
  (newParams, randomizeSeed) => {
    // ... existing body unchanged ...
  },
  setView,
);
```

- [ ] **Step 4: Hook `mapView.refresh()` into the param-change path**

In the `onApply` callback body (the second argument to `new DebugPanel(...)`), add `mapView.refresh();` at the end:

```ts
const debugPanel = new DebugPanel(
  currentParams,
  (newParams, randomizeSeed) => {
    currentParams = newParams;
    if (randomizeSeed) {
      currentSeed = randomSeed();
      seedInput.value = String(currentSeed);
    }
    rebuildWorld();
    mapView.refresh();
  },
  setView,
);
```

(If the existing body already updates `currentParams` and calls `rebuildWorld`, just add `mapView.refresh();` at the very end. Read the existing body and merge cleanly — don't duplicate lines.)

- [ ] **Step 5: Pause three.js render in map view**

Find the `animate()` function in `main.ts` (around line 266). Inside it, find the `renderer.render(scene, camera);` line. Wrap it:

```ts
if (!isMapView) {
  renderer.render(scene, camera);
}
```

(Other work in `animate` like `world.update`, `dayNight` updates, etc. can keep running — they're cheap and skipping them adds complexity. Only the GPU render is gated.)

- [ ] **Step 6: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Smoke check**

`npm run dev`. Open the printed URL. Open the params panel (button or hotkey `p`). At the top of the panel you should see "View: ( ) 3D ( ) Map". Click "Map" — the 3D view disappears, replaced by a 2D top-down biome map of the world centered on (0, 0). Switch back to 3D — three.js view returns. Tweaking a slider in the panel (e.g., a biome-picker weight) while in Map view re-renders the map.

- [ ] **Step 8: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts 08-spline-terrain/src/main.ts
git commit -m "feat(08): wire map-view toggle into debug panel and main"
```

---

## Task 7 — Pan (drag)

**Files:**
- Modify: `08-spline-terrain/src/mapView/index.ts`

- [ ] **Step 1: Add drag state and handlers**

In `08-spline-terrain/src/mapView/index.ts`, inside the `createMapView` function but before the `return` statement, add the pan handlers. Place them after the existing render/show/hide/refresh definitions:

```ts
// ── Pan ─────────────────────────────────────────────────────────────
type DragState = { active: boolean; startX: number; startY: number; movedPx: number };
const drag: DragState = { active: false, startX: 0, startY: 0, movedPx: 0 };

const onMouseDown = (e: MouseEvent) => {
  drag.active = true;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.movedPx = 0;
  cfg.canvas.style.cursor = "grabbing";
};

const onMouseMoveDrag = (e: MouseEvent) => {
  if (!drag.active) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  drag.movedPx = Math.max(drag.movedPx, Math.abs(dx) + Math.abs(dy));
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  viewport.cx -= dx * viewport.blocksPerPixel;
  viewport.cz -= dy * viewport.blocksPerPixel;
  render();
};

const onMouseUp = (_e: MouseEvent) => {
  drag.active = false;
  cfg.canvas.style.cursor = "grab";
};
```

Now wire the listeners in `show()` and unwire in `hide()`. Replace the existing `show()` and `hide()` bodies with:

```ts
function show(): void {
  isShown = true;
  cfg.canvas.style.display = "block";
  cfg.coordReadoutEl.style.display = "block";
  cfg.canvas.addEventListener("mousedown",  onMouseDown);
  window.addEventListener     ("mousemove", onMouseMoveDrag);
  window.addEventListener     ("mouseup",   onMouseUp);
  if (dirty) {
    rebuildClassifier();
    render();
  } else {
    render();   // ensure canvas resized to current window
  }
}

function hide(): void {
  isShown = false;
  cfg.canvas.style.display = "none";
  cfg.tooltipEl.style.display = "none";
  cfg.coordReadoutEl.style.display = "none";
  cfg.canvas.removeEventListener("mousedown",  onMouseDown);
  window.removeEventListener    ("mousemove", onMouseMoveDrag);
  window.removeEventListener    ("mouseup",   onMouseUp);
}
```

(Listeners are bound to `window` for mousemove/mouseup so dragging continues even if the cursor leaves the canvas, and unbinds cleanly on hide. mousedown stays on the canvas.)

- [ ] **Step 2: Recenter on each toggle into map view**

The skeleton starts the viewport at (0, 0). `MapViewHandle.setCenter` is already defined; main.ts just needs to call it before `show()`.

In `08-spline-terrain/src/main.ts`, update `setView`:

```ts
function setView(mode: "3d" | "map"): void {
  isMapView = (mode === "map");
  if (isMapView) {
    renderer.domElement.style.display = "none";
    mapView.setCenter(camera.position.x, camera.position.z);
    mapView.show();
  } else {
    renderer.domElement.style.display = "block";
    mapView.hide();
  }
}
```

- [ ] **Step 3: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Smoke check**

`npm run dev`. Toggle to map view. Drag the canvas — the map should pan smoothly. Walk away in 3D first (toggle back to 3D, hit `w` for a few seconds, toggle back to map) — the map should re-center where the camera is now.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/mapView/index.ts 08-spline-terrain/src/main.ts
git commit -m "feat(08): map-view drag-to-pan + recenter on toggle"
```

---

## Task 8 — Zoom (wheel, anchored on cursor)

**Files:**
- Modify: `08-spline-terrain/src/mapView/index.ts`

- [ ] **Step 1: Update viewport import**

At the top of `08-spline-terrain/src/mapView/index.ts`, extend the import:

```ts
import { type Viewport, ZOOM_LEVELS, pixelToWorld, zoomIn, zoomOut } from "./viewport";
```

- [ ] **Step 2: Add the wheel handler**

Inside `createMapView`, add a wheel handler (next to the pan handlers):

```ts
// ── Zoom ────────────────────────────────────────────────────────────
const onWheel = (e: WheelEvent) => {
  e.preventDefault();
  const rect = cfg.canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const before = pixelToWorld(viewport, px, py);
  const next = e.deltaY < 0 ? zoomIn(viewport.blocksPerPixel) : zoomOut(viewport.blocksPerPixel);
  if (next === viewport.blocksPerPixel) return;   // already at the end
  viewport.blocksPerPixel = next;
  const after = pixelToWorld(viewport, px, py);
  viewport.cx += before.wx - after.wx;
  viewport.cz += before.wz - after.wz;
  render();
};
```

- [ ] **Step 3: Wire the listener in show/hide**

In `show()`, after the existing `addEventListener` calls:

```ts
cfg.canvas.addEventListener("wheel", onWheel, { passive: false });
```

In `hide()`, after the existing `removeEventListener` calls:

```ts
cfg.canvas.removeEventListener("wheel", onWheel);
```

(`passive: false` is needed because we call `preventDefault()` to stop the page from scrolling.)

- [ ] **Step 4: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke check**

`npm run dev` → map view. Hover over a feature, scroll wheel — the feature stays under the cursor as the map zooms. Three discrete levels: scrolling further does nothing past the ends.

- [ ] **Step 6: Commit**

```bash
git add 08-spline-terrain/src/mapView/index.ts
git commit -m "feat(08): map-view cursor-anchored discrete zoom"
```

---

## Task 9 — Hover tooltip (rAF-throttled)

**Files:**
- Modify: `08-spline-terrain/src/mapView/index.ts`

- [ ] **Step 1: Add tooltip state and handler**

In `08-spline-terrain/src/mapView/index.ts`, add a mousemove handler for the tooltip (separate from the pan-drag handler since they have different semantics — drag fires only when active, hover fires anytime).

Inside `createMapView`, add after the zoom handler:

```ts
// ── Hover tooltip ───────────────────────────────────────────────────
let hoverPx = 0;
let hoverPy = 0;
let hoverActive = false;
let hoverFrameQueued = false;

const onMouseMoveHover = (e: MouseEvent) => {
  if (drag.active) {
    cfg.tooltipEl.style.display = "none";
    return;
  }
  const rect = cfg.canvas.getBoundingClientRect();
  hoverPx = e.clientX - rect.left;
  hoverPy = e.clientY - rect.top;
  hoverActive = (hoverPx >= 0 && hoverPy >= 0 && hoverPx < viewport.width && hoverPy < viewport.height);
  if (!hoverActive) {
    cfg.tooltipEl.style.display = "none";
    return;
  }
  if (!hoverFrameQueued) {
    hoverFrameQueued = true;
    requestAnimationFrame(updateTooltip);
  }
};

const onMouseLeave = () => {
  hoverActive = false;
  cfg.tooltipEl.style.display = "none";
};

function updateTooltip(): void {
  hoverFrameQueued = false;
  if (!hoverActive || !isShown) return;
  const { wx, wz } = pixelToWorld(viewport, hoverPx, hoverPy);
  // Sample full climate for a richer readout (extra cost is one mousemove sample).
  const { seed, params } = cfg.getSeedAndParams();
  const shaper  = createTerrainShaper(seed, params);
  const climate = createBiomeSampler(seed, params.biomes);
  const sample = shaper.sampleClimate(wx, wz);
  const height = shaper.heightFromClimate(sample);
  const { temp, humid } = climate(wx, wz);
  const biome = classifyBiome(
    sample.continentalness, sample.erosion, sample.peaksValleys,
    temp, humid, params.biomePicker,
  );
  const biomeName = BIOME_NAMES[biome] ?? `#${biome}`;
  cfg.tooltipEl.textContent =
    `(wx=${wx.toFixed(0)}, wz=${wz.toFixed(0)})\n` +
    `biome:  ${biomeName}\n` +
    `height: ${height.toFixed(1)}\n` +
    `temp:   ${temp.toFixed(2)}   humid: ${humid.toFixed(2)}\n` +
    `cont:   ${sample.continentalness.toFixed(2)}   eros: ${sample.erosion.toFixed(2)}\n` +
    `pv:     ${sample.peaksValleys.toFixed(2)}`;
  cfg.tooltipEl.style.display = "block";
  cfg.tooltipEl.style.left = `${hoverPx + 16}px`;
  cfg.tooltipEl.style.top  = `${hoverPy + 80 + 16}px`;   // 80 = toolbar offset
}
```

(The recreation of `shaper` + `climate` per hover update is wasteful; for a quick hover sample it's fine, but could be optimized to reuse the cached `classify` closure later. Profile before optimizing.)

- [ ] **Step 2: Add `BIOME_NAMES` lookup**

At the top of `08-spline-terrain/src/mapView/index.ts`, after the existing imports, add:

```ts
import { Biome, classifyBiome, createBiomeSampler, BIOME_DEFS, type BiomeId } from "../biomes";
```

(Replace the existing partial import of `classifyBiome, createBiomeSampler` with this combined version.)

Then at module scope (above `createMapView`):

```ts
const BIOME_NAMES: Record<BiomeId, string> = Object.fromEntries(
  Object.entries(BIOME_DEFS).map(([id, def]) => [Number(id), def.name]),
) as Record<BiomeId, string>;
void Biome;   // kept around in case a future feature needs the value
```

- [ ] **Step 3: Wire the listeners in show/hide**

In `show()`, add:

```ts
cfg.canvas.addEventListener("mousemove",  onMouseMoveHover);
cfg.canvas.addEventListener("mouseleave", onMouseLeave);
```

In `hide()`, add:

```ts
cfg.canvas.removeEventListener("mousemove",  onMouseMoveHover);
cfg.canvas.removeEventListener("mouseleave", onMouseLeave);
```

- [ ] **Step 4: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke check**

`npm run dev` → map view. Hover over the map; a tooltip should follow the cursor showing world coords, biome, height, and the five climate values. Move out of the canvas — tooltip hides. Start dragging — tooltip hides during drag.

- [ ] **Step 6: Commit**

```bash
git add 08-spline-terrain/src/mapView/index.ts
git commit -m "feat(08): map-view hover tooltip with climate readout"
```

---

## Task 10 — Click-to-teleport (with surface-Y snap)

**Files:**
- Modify: `08-spline-terrain/src/mapView/index.ts`

- [ ] **Step 1: Add the click handler logic to `onMouseUp`**

The existing `onMouseUp` (added in Task 7) only releases the drag flag. Update it to detect a click (no movement) and call `onTeleport`:

```ts
const onMouseUp = (e: MouseEvent) => {
  const wasClick = drag.active && drag.movedPx < 5;
  drag.active = false;
  cfg.canvas.style.cursor = "grab";

  if (!wasClick) return;

  // Determine pixel under cursor relative to the map canvas.
  const rect = cfg.canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  if (px < 0 || py < 0 || px >= viewport.width || py >= viewport.height) return;

  const { wx, wz } = pixelToWorld(viewport, px, py);
  const { height } = classify(wx, wz);
  cfg.onTeleport(wx, wz, height);
};
```

(Note: `classify` is the closure built by `buildClassifier`; calling it gives `{ biome, height }`. We pass `height` as the surface-Y so `main.ts` can snap the camera to it + 2.)

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke check**

`npm run dev` → map view. Click somewhere far from your current position. Toggle back to 3D — the camera should now be at the clicked location, hovering 2 blocks above the surface. Drag-pan still works (only clicks without drag fire the teleport).

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/mapView/index.ts
git commit -m "feat(08): map-view click-to-teleport with surface snap"
```

---

## Task 11 — Coordinate readout

**Files:**
- Modify: `08-spline-terrain/src/mapView/index.ts`

- [ ] **Step 1: Update the readout on each render**

In `08-spline-terrain/src/mapView/index.ts`, find the `render()` function and add a line at the end:

```ts
function render(): void {
  sizeCanvasToViewport();
  renderMap(ctx!, viewport, classify, waterLevel);
  cfg.coordReadoutEl.textContent =
    `center: (${viewport.cx.toFixed(0)}, ${viewport.cz.toFixed(0)})  zoom: ${viewport.blocksPerPixel}b/px`;
  dirty = false;
}
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke check**

`npm run dev` → map view. Bottom-right corner shows `center: (0, 0)  zoom: 1b/px`. Pan around — the center coordinate updates. Zoom in/out — the zoom value updates.

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/mapView/index.ts
git commit -m "feat(08): map-view bottom-corner coordinate readout"
```

---

## Task 12 — End-to-end manual verification + palette tuning

**Files:**
- Modify (if tuning required): `08-spline-terrain/src/mapView/colors.ts`

- [ ] **Step 1: Run the full feature loop**

`npm run dev`. With the params panel open, toggle into Map view. Verify each:

- **Initial centering** — map opens centered on (0, 0) on first toggle, on the player's current position on subsequent toggles.
- **Pan** — drag works; cursor switches to grabbing; mouseup ends.
- **Zoom** — wheel up zooms in (1 block/pixel max); wheel down zooms out (4 blocks/pixel max); cursor anchor stays put.
- **Hover** — tooltip appears with world coords, biome, height, climate values.
- **Click-to-teleport** — clicking (no drag) sets the camera position; toggling back to 3D drops you there.
- **Auto-redraw** — drag a biome-picker weight slider; map updates within ~100 ms.
- **Coord readout** — bottom-right shows center + zoom.

- [ ] **Step 2: Regression-check the 3D view**

Toggle back to 3D. The world should still render normally — three.js render loop resumes, no console errors, no missing chunks.

- [ ] **Step 3: Tune the palette if needed**

If any biomes read poorly on the map (e.g., Stony Peaks looks too similar to Mountains, or Beach blends into Desert), edit `08-spline-terrain/src/mapView/colors.ts`. Each tweak gets its own commit:

```bash
git add 08-spline-terrain/src/mapView/colors.ts
git commit -m "tune(08): brighten Stony Peaks for clearer mountain bands"
```

If the height shading doesn't read well (oceans look too uniform, or peaks don't pop enough), tune the `WATER_*` / `LAND_*` constants at the top of `colors.ts`.

- [ ] **Step 4: Final build check**

Run from `08-spline-terrain/`: `npm run build`
Expected: clean build with no errors.

- [ ] **Step 5: Final commit**

If anything is still uncommitted, commit it now.

---

## Done checklist

After Task 12, the following should all be true:

- The debug panel has a "View: ( ) 3D ( ) Map" radio at the top.
- Toggling to Map shows a top-down 2D biome+height map; toggling back to 3D restores the voxel view with no regressions.
- Pan, zoom (3 levels), hover tooltip, click-to-teleport, and the bottom-right coord readout all work as described.
- Tweaking any debug-panel parameter (axis weights, depth scale, etc.) in Map view causes the map to re-render within the existing debounce window.
- `npm run build` exits cleanly.
- The world renders without console errors in either view.

## Notes for the implementer

- Project 08 has no test framework. Verification is `npx tsc --noEmit`, `npm run build`, and in-browser smoke checks.
- The map renderer cost at zoom 1, 1024×1024 is roughly 100–200 ms single-threaded — comfortably within the param-debounce window. If the experience is choppy during slider drag, the spec lists "snap to zoom 4 during drag" as a future-work mitigation; do not implement it as part of this plan.
- All listeners are bound on `show()` and unbound on `hide()` to avoid leaks when the user toggles back and forth.
- The `MARKER_LAYERS = []` array in `render.ts` is intentionally empty — the future structure-marker work plugs in here without modifying anything else.
- Camera height after teleport is `surfaceY + 2`, which puts the player just above ground. Adjust if walking-mode collision physics treats this as embedded (not expected from current `walkController`, but watch for it during smoke check).
- The hover handler currently rebuilds the noise samplers (`createTerrainShaper`, `createBiomeSampler`) per call. This is wasteful; the obvious optimization is to reuse the renderer's `classify` closure plus a separate one for the climate/sample fields. Leave as-is for the first cut and revisit only if hover feels sluggish.
