# Seed visualizer (project 08, map view)

Status: design approved, ready for implementation plan.
Date: 2026-05-08.

## Motivation

Project 08 just shipped a 6D climate-box biome picker. Tuning the boxes
in 3D is slow: you generate chunks, walk around, hope you find a Lush
Caves region or a Frozen Ocean coastline, then go back to the debug
panel and adjust. A 2D top-down map of the world — like Chunkbase for
Minecraft — closes that loop. One pixel = one (zoom-scaled) world block,
colored by biome and shaded by height. You can see at a glance whether
Stony Peaks is too rare, whether Beach is bleeding into Tundra, whether
mountain bands look right.

The map view is a tuning tool first; an exploration tool second. It
lives inside project 08's existing UI as a toggleable view mode — not a
new project, not a separate page.

## Goals

- Add a "Map" view mode to project 08, toggled from the debug panel.
- Render a top-down map of the world by sampling per pixel:
  surface biome (color from a per-biome palette), height (brightness/
  darkness modulation), water vs. land split (water always blue-ish
  regardless of biome).
- Pan + discrete zoom (1, 2, 4 blocks per pixel).
- Auto-redraw whenever debug-panel parameters change.
- Hover tooltip showing the climate sample at the cursor pixel.
- Click-to-teleport: clicking a pixel updates the 3D camera's position
  so when the user toggles back to 3D view, they're standing where they
  clicked.
- Reserve a marker-layer pass in the renderer (initially a no-op) so
  the future structure-marker work plugs in without refactoring.

## Non-goals

- Structure markers (icons for pyramids, igloos, houses). Future work;
  the marker-layer scaffold is in scope, the layers themselves are not.
- Live-editable biome boxes (still a future-work item from the prior
  spec — the map view inspects, the debug panel still only edits the
  axis weights and depth scale).
- Snapshot / export-as-PNG.
- Worker-thread renderer. The main-thread cost target is ≤150 ms at
  zoom 1, 1024×1024; if reality differs, mitigations are listed under
  Future work.
- Continuous (non-discrete) zoom levels.
- Click-to-teleport that *also* switches back to 3D automatically.
  Click sets the camera position; the user toggles the view when they
  want.
- Mini-map / side-by-side view. The view is a mode toggle, not an
  always-on overlay.

## Architecture

### View toggle

The existing debug panel gets a "View" radio at the top:

```
View: ( ) 3D    (•) Map
```

`main.ts` owns the toggle handler:

- Map → 3D: hide the map canvas, unhide the three.js canvas, resume
  three.js render loop, call `mapView.hide()`.
- 3D → Map: hide the three.js canvas, pause three.js render loop, call
  `mapView.show()` (which renders once immediately).

Default view is 3D. Toggle state is *not* persisted across reloads.

### Two-pass renderer

The map renderer runs two passes per render:

1. **Pixel pass** — fill an `ImageData` buffer one pixel at a time. Per
   pixel: convert (px, py) to world (wx, wz); sample climate; classify
   biome; compute color via `mapColor(biome, height, waterLevel)`;
   write RGBA. `ctx.putImageData` once at the end of the pass.
2. **Marker pass** — `for (const layer of MARKER_LAYERS) layer.draw(...)`.
   `MARKER_LAYERS` is initialized to `[]`. Future structure-marker work
   adds entries; nothing else changes.

### Render triggers

The map subscribes to the existing param-change debounce. Each time
the panel mutates a parameter, `main.ts` calls `mapView.refresh()`
unconditionally. The mapView decides internally what to do: if shown,
it renders immediately; if hidden, it only sets a `dirty` flag (the
next `show()` will render before unhiding). This means main.ts
doesn't have to know which view is currently active — it just calls
refresh on every change.

The map also re-renders on internal viewport changes (pan, zoom). These
do *not* go through the param-debounce — they're direct calls into
`renderMap` from inside the mapView module. The classifier closure
(which wraps the seed + param-keyed samplers) is rebuilt on param
change and reused across viewport changes.

### Decoupling from 3D pipeline

The map view uses the existing public APIs of `terrainShape`,
`biomes`, and `biomeBoxes` — no new exports, no internal-state sharing
with the chunk pipeline. The single bidirectional wire is the
click-to-teleport callback writing to the three.js camera position;
that's one function call into existing camera state.

If the `mapView/` directory were deleted (and the small `main.ts` /
`debugPanel.ts` hooks reverted), project 08 would still work
identically in 3D.

## File layout

### Created

`src/mapView/colors.ts` (~80 lines)
- `BIOME_COLOR: Record<BiomeId, number>` — base color per surface
  biome at sea level.
- Height-shading constants (depth-tint range, brightness-modulation
  range, max useful height delta).
- `mapColor(biome, height, waterLevel): number`.
- `darken(c, t)`, `brighten(c, t)` — module-private color helpers.
- Imports only `type BiomeId` (no runtime imports from `biomes.ts`).

`src/mapView/viewport.ts` (~60 lines)
- `ZOOM_LEVELS = [1, 2, 4] as const`, `ZoomLevel` type.
- `Viewport` interface: `{ cx, cz, blocksPerPixel, width, height }`.
- `pixelToWorld(v, px, py)` — pure function.
- No DOM, no internal mutation.

`src/mapView/render.ts` (~60 lines)
- `MarkerLayer` interface with `draw(viewport, ctx)`.
- `MARKER_LAYERS: MarkerLayer[] = []`.
- `renderMap(ctx, viewport, classify, waterLevel)` — pixel pass +
  marker pass.

`src/mapView/index.ts` (~150 lines)
- `MapViewConfig`, `MapViewHandle` interfaces.
- `createMapView(cfg)` — owns viewport state, drag state, DOM event
  listeners, the classifier closure, and the public `show / hide /
  refresh` API.

### Modified

`src/main.ts` (~30 lines added)
- Adds a hidden map canvas, tooltip div, and coord-readout div to the
  DOM, next to the existing three.js canvas.
- Instantiates `createMapView({...})`, providing `getSeedAndParams`
  and `onTeleport` callbacks.
- Adds a view-toggle handler that pauses/resumes three.js and
  shows/hides the map canvas.
- Extends the param-change hook to always call `mapView.refresh()`
  (the mapView module handles the shown/hidden distinction internally
  via its dirty flag).

`src/debugPanel.ts` (~10 lines added)
- "View" radio at the top of the panel.
- `onViewChange(mode: "3d" | "map")` callback wired to `main.ts`.

No other files change.

## Viewport and interaction

```ts
// mapView/viewport.ts

export const ZOOM_LEVELS = [1, 2, 4] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export interface Viewport {
  /** World coordinate at the canvas center. */
  cx: number;
  cz: number;
  blocksPerPixel: ZoomLevel;
  /** Canvas dimensions in pixels. */
  width:  number;
  height: number;
}

export function pixelToWorld(v: Viewport, px: number, py: number) {
  const wx = v.cx + (px - v.width  / 2) * v.blocksPerPixel;
  const wz = v.cz + (py - v.height / 2) * v.blocksPerPixel;
  return { wx, wz };
}
```

### Pan

Mouse-down on the canvas captures the cursor. Mouse-move updates
`viewport.cx` and `viewport.cz` proportional to the cursor delta times
`blocksPerPixel`. Mouse-up releases. No inertia, no momentum.

### Zoom

Wheel events cycle through `ZOOM_LEVELS`. `event.deltaY < 0` (wheel
up / scroll up) → smaller `blocksPerPixel` (zoom in); `deltaY > 0` →
larger. Anchored on the cursor
position so the world point under the cursor stays under the cursor:

```
beforeWorld = pixelToWorld(v, mousePx, mousePy)
v.blocksPerPixel = nextLevel
afterWorld  = pixelToWorld(v, mousePx, mousePy)
v.cx += beforeWorld.wx - afterWorld.wx
v.cz += beforeWorld.wz - afterWorld.wz
```

Wheel events at the ends of the discrete-level range are no-ops.

### Hover tooltip

On `mousemove` (when not panning), compute `(wx, wz)` for the cursor
pixel, sample climate + height + biome, render a small floating div:

```
(wx=512, wz=-128)
biome: Forest
height: 64
temp: -0.05  humid: 0.32
cont: 0.18   eros: -0.21
pv: 0.09
```

The tooltip is a single absolutely-positioned div in the DOM,
`display: none` when the cursor leaves the canvas or starts a drag.
Mousemove handler is throttled via `requestAnimationFrame`: the
latest event coordinates are stored and the actual sample + DOM
update runs once per animation frame.

### Click-to-teleport

`mouseup` without movement (drag distance <5 px) calls
`onTeleport(wx, wz)`. The callback in `main.ts` updates the three.js
camera's `position.x` and `position.z`, and snaps `position.y` to the
surface height at that column plus 2 blocks (so the player lands on
the ground, not floating or buried). Surface height is sampled via
the same `terrainShape.heightAt` the renderer already uses. The view
does *not* switch back to 3D automatically.

### Coordinate readout

A small fixed corner overlay shows the canvas-center world coordinate
`(cx, cz)` and the current zoom level. Updates on pan/zoom.

### Initial viewport

When the map view is first opened: `cx = camera.x`, `cz = camera.z`,
`blocksPerPixel = 1`. Centered on wherever the player currently is
in 3D.

## Pixel pass and color palette

```ts
// mapView/render.ts

export function renderMap(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: (wx: number, wz: number) => { biome: BiomeId; height: number },
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

The `classify` closure is built once per render in `mapView/index.ts`:

```ts
function buildClassifier(seed: number, params: GenerationParams) {
  const shaper  = createTerrainShaper(seed, params);
  const climate = createBiomeSampler(seed, params.biomes);
  return (wx: number, wz: number) => {
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
```

### Color palette

Initial values (RGB hex):

```
Ocean          0x1E5A8A
FrozenOcean    0x9CC4D6   pale icy blue
Beach          0xE8D8A0
Desert         0xE6C77A
Savanna        0xB6BC4D
Plains         0x8FBE5A
Forest         0x3F7B3A
BirchForest    0x6FA055
Taiga          0x4F7A6E
Tundra         0xCBD9D8
Mountains      0x8B7E70
StonyPeaks     0xB0A89E
WindsweptHills 0x6E8C5E
```

Tunable in `colors.ts`. Not exposed to the debug panel in this spec.

### Height shading

```
if (height <= waterLevel) {
  // Water: scale base ocean/frozen-ocean color by depth (0..1).
  const depth = min(1, (waterLevel - height) / 30);
  return darken(BIOME_COLOR[biome], 0.3 + 0.5 * depth);  // 0.3..0.8
}
// Land: brighten by height above waterLevel, capped.
const above = min(1, (height - waterLevel) / 60);
return brighten(BIOME_COLOR[biome], above * 0.4);  // 0..0.4
```

Numbers (`30`, `60`, `0.3..0.8`, `0..0.4`) are tunable defaults that
sit as constants at the top of `colors.ts`.

### Why this gives the chunkbase look

- **Water/land contrast** — water pixels never use a green/brown biome
  color; land pixels never use blue. The split happens at the
  `height ≤ waterLevel` check, not in the palette.
- **Coastlines** — biome blending isn't needed; the per-pixel classify
  call combined with the picker's natural geographic banding produces
  clean coastlines automatically.
- **Depth + elevation feel** — dark-deep / bright-high shading makes
  mountain ranges and ocean trenches pop without separately rendering
  height as a layer.

## Public API

```ts
// mapView/index.ts

export interface MapViewHandle {
  /** Show map view: unhide canvas, attach listeners, render once. */
  show(): void;
  /** Hide map view: detach listeners, hide canvas. */
  hide(): void;
  /** Force a re-render (called by main.ts on param change). */
  refresh(): void;
}

export interface MapViewConfig {
  canvas:         HTMLCanvasElement;
  tooltipEl:      HTMLElement;
  coordReadoutEl: HTMLElement;
  getSeedAndParams: () => { seed: number; params: GenerationParams; waterLevel: number };
  onTeleport:     (wx: number, wz: number) => void;
}

export function createMapView(cfg: MapViewConfig): MapViewHandle;
```

`createMapView` owns: viewport state, drag state, the classifier
closure (rebuilt on each `refresh()`), DOM event listeners (attached
on `show`, detached on `hide`).

The handle never throws. Calling `refresh()` while hidden does not
draw anything immediately, but sets a `dirty` flag; the next `show()`
checks the flag and renders before unhiding the canvas. This is what
makes "tweak params in 3D, then toggle to map" work: the map shows
the latest params, not the params at the last time it was visible.

## Performance

### Cost target

At 1024×1024, zoom 1: ~1M iterations per render. Each iteration:
- 5 climate fBm calls (3 fields × 3-4 octaves each) — dominant cost.
- 1 spline eval for height.
- 13-entry registry scan for biome (~78 ops).

In modern V8, this lands around 100–200 ms single-threaded. At zoom 2
that's ~30–60 ms. At zoom 4 that's ~10–20 ms.

The existing param-debounce window is 100 ms; map renders at zoom 1
will sit at the edge of it. Acceptable for a tuning tool.

### Mitigations (only if needed)

- **Snap-to-zoom-4-during-drag.** While the user drags a slider,
  render at zoom 4; on commit, render at the current zoom. One
  conditional in the refresh path.
- **Render off the main thread.** Move the pixel pass to a worker
  with `OffscreenCanvas`. Larger change; reserved if the snap-to-4
  mitigation isn't enough.

Neither mitigation is in scope for this spec.

## Out of scope (future work)

- **Structure markers.** Icons for pyramids, igloos, houses (and
  whatever else gets placed via `placePyramid` etc.). Plug into
  `MARKER_LAYERS` as a `StructureMarkerLayer`.
- **Per-biome color customization** in the debug panel.
- **Snapshot / export as PNG.** `canvas.toDataURL` plus a download
  link.
- **Snap-to-coarser-zoom-during-drag** perf mitigation.
- **Worker-thread renderer** with `OffscreenCanvas`.
- **Persistent view-mode preference** (localStorage).
- **Promote to its own project** (`09-seed-visualizer/`) once the
  feature set grows past what fits comfortably in project 08's UI.

## Implementation checklist

For the implementation plan to expand:

1. Create `src/mapView/colors.ts` (palette, mapColor, darken/brighten
   helpers, height-shading constants).
2. Create `src/mapView/viewport.ts` (ZOOM_LEVELS, Viewport,
   pixelToWorld).
3. Create `src/mapView/render.ts` (MarkerLayer interface,
   MARKER_LAYERS, renderMap with empty marker pass).
4. Create `src/mapView/index.ts` (createMapView with show / hide /
   refresh API; viewport state; drag state; pan / zoom / hover /
   click handlers; classifier closure builder; coord readout
   updater).
5. Modify `src/main.ts`: add map canvas, tooltip div, coord readout
   div to the DOM; instantiate mapView; wire view-toggle handler;
   extend param-change hook.
6. Modify `src/debugPanel.ts`: add the "View" radio at the top, wire
   `onViewChange` callback.
7. Tune palette + shading constants in-world: open the map, walk
   through climates, adjust biome colors that read poorly. Each
   adjustment is its own commit.
