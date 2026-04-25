# Visual spline editor — design

Replace the numeric tables in the debug panel's three spline sections with
draggable SVG graphs, plus add a focused export/import for the terrain
shape (the three splines together).

Project: `08-spline-terrain`. Touches `src/debugPanel.ts` and adds a new
`src/splineEditor.ts` module.

## Background

`splines.ts` defines `Spline` (a sorted list of `{x, y}` control points)
and `AnchoredSpline[]` (a list of sub-splines anchored at scalar key
values). `DEFAULT_TERRAIN_SHAPE` holds three of these inside
`params.shape.shape`:

- `continent` — continentalness `[-1, 1]` → base height
- `erosionByContinent` — erosion sub-splines anchored at continentalness values
- `pvByErosion` — peaks-and-valleys sub-splines anchored at erosion values

`debugPanel.ts` currently renders these with `buildSplineSection` and
`buildAnchoredSection`: rows of `<input type="number">` for each control
point, an "+ Add point" affordance, and (for anchored sections) an
accordion of per-anchor sub-tables. The original spec for this feature
(`2026-04-19-spline-terrain-shaping-design.md`) flagged a visual editor as
future work.

## Goals

1. Edit splines visually — drag points, click to add, right-click to delete,
   hover for `(x, y)` tooltip.
2. For anchored sections, see all sub-splines on one graph (overlay), with
   a single "active" curve at a time being editable.
3. Export and import the full terrain shape (all three splines) as a
   self-contained JSON file, separate from the existing per-preset export.
4. Keep the rest of the debug panel's behavior unchanged — re-runs, the
   `splineRerenders` refresh hook, preset save/load all still work.

## Non-goals

- No persistence beyond the new shape export/import (no localStorage for
  splines specifically — the existing preset system already covers that).
- No undo/redo.
- No UI for adjusting the Y-axis range (constants in code; revisit if a
  section starts hitting the ceiling routinely).
- No change to how splines are evaluated at runtime.

## Architecture

A new module `src/splineEditor.ts` exports three factories:

```ts
buildSplineGraph(opts):       { element: HTMLElement; rerender(): void }
buildAnchoredSplineGraph(opts):{ element: HTMLElement; rerender(): void }
buildSplineShapeToolbar(opts): { element: HTMLElement }
```

`debugPanel.ts` keeps `buildSplineSection` and `buildAnchoredSection` as
thin wrappers that own the collapsible header and host the new graph
elements in their bodies. The existing `splineRerenders: Array<() => void>`
hook stays — each graph registers its `rerender` so worker re-runs trigger
a redraw. The three call sites at `debugPanel.ts:308–321` keep their
current shape; only the section bodies change.

Why a separate module: SVG drag math + hit testing is sizable on its own,
and `debugPanel.ts` is already 985 lines.

## `buildSplineGraph` — single spline

```ts
buildSplineGraph({
  getSpline: () => Spline,
  setSpline: (s: Spline) => void,
  xRange: [number, number],   // always [-1, 1] for these splines
  yRange: [number, number],   // fixed per section, see "Y-ranges" below
  xLabel?: string,            // axis caption, e.g. "continentalness"
  yLabel?: string,            // optional; not rendered in v1
}): { element: HTMLElement; rerender(): void }
```

### Layout

- 228 × 130 plot area, 22 px left gutter for Y labels, 12 px bottom gutter
  for X labels. SVG `viewBox` 260 × 150.
- Frame fill `#0a1226`, axes `#34406a`, gridlines `#1f2848` at x = 0 and
  y = 0 (plus midpoints if the range spans more than ~50 units).
- Axis labels at min, 0, and max on each axis; `monospace` 7 px;
  color `#7a8aa8`.
- Curve: `#7ab8ff`, 1.4 px polyline through the control points
  (piecewise-linear, matching `evalSpline`).
- Control points: `#e94560` filled circles, radius 3, white 1 px stroke.
- Hovered point: radius 4, fill `#ffd166`.
- Tooltip on hover: small `#16213e` box near the point with
  `x=NN.NN  y=NN` (two decimals on x, integer on y).

### Interactions

- **Drag a point.** Pointer-down on a circle starts dragging; pointer-up
  ends it. Position maps continuously from screen space back to data
  space (no snap). On move, `(x, y)` are updated and `setSpline(next)` is
  called every frame, then `rerender`.
  - X is clamped to `(prev.x + ε, next.x − ε)` so the spline stays sorted
    without resorting. ε = 1 × 10⁻⁴.
  - Y is clamped to `yRange`.
  - The first and last points have their X locked to `xRange[0]` /
    `xRange[1]` (only Y is draggable). Splines clamp at endpoints anyway,
    so a free X there does nothing useful and risks duplicate-x edge cases.
- **Click on the plot.** Insert a new point at the clicked `(x, y)`,
  sorted into place. Y clamped to `yRange`. Applies whether the click
  lands on the curve or empty space — clicking the curve is the natural
  way to add a point on it. Clicks on an existing control point fall
  through to drag, not insert.
- **Right-click on a point.** Delete it. No-op if length would drop below 2.
- **Hover.**
  - Within ~5 px of a point: highlight the point + show its tooltip
    (`x=NN.NN  y=NN`).
  - Anywhere else over the plot: show a tooltip with the interpolated y
    at the cursor x (read-only).
- All modifications call `setSpline(next)` then this graph's `rerender`.
  `setSpline` only mutates `params.shape.shape.*`; world regeneration
  happens later when the user clicks "Apply & Regenerate" (existing
  flow). No need to throttle drag updates against the worker.

### Implementation notes

- Inline SVG; no canvas. One `<svg>` per graph with delegated pointer
  handlers on the root, plus per-circle `pointerdown` for drag start.
- Two helpers: `dataToScreen(x, y)` / `screenToData(px, py)` use the
  graph's plot rect and `xRange` / `yRange` to convert.
- Hit-testing for the curve: linear scan over segments, since splines
  here have at most ~10 points.
- Pointer events use `setPointerCapture` so dragging works even if the
  cursor leaves the SVG.
- The drag / click-to-add / right-click-delete / hover-tooltip logic
  lives in a private `installSplinePointerHandlers(svg, opts)` helper.
  Both `buildSplineGraph` and `buildAnchoredSplineGraph` use it —
  `buildAnchoredSplineGraph` reroutes the getter/setter to point at
  whichever anchor is currently active.

## `buildAnchoredSplineGraph` — overlaid

```ts
buildAnchoredSplineGraph({
  getList: () => AnchoredSpline[],
  setList: (l: AnchoredSpline[]) => void,
  xRange: [number, number],   // [-1, 1]
  yRange: [number, number],   // fixed, see "Y-ranges" below
  xLabel: string,             // e.g. "erosion"
  anchorLabel: string,        // legend prefix, e.g. "cont"
}): { element: HTMLElement; rerender(): void }
```

### Layout

- One SVG plot, same 260 × 150 viewport / styling as the single graph.
- **Above** the plot: a legend strip — one chip per anchor, in anchor
  order. Each chip shows a color swatch, a numeric input for the anchor
  value, and an `×` delete affordance. The active chip has a brighter
  border and filled background.
- **Below** the plot: `+ Add anchor` affordance, same style as the
  existing `+ Add point`.

### Color cycle

Anchors get colors from a fixed palette in order, cycling if needed
(rare in practice, defaults have ≤ 2 anchors per list):

```
#7ab8ff  #f7a072  #b5e48c  #c77dff  #ffd166
```

### Active anchor model

Exactly one anchor is active at a time. Default: index 0.

- The active anchor's curve is drawn at full opacity with its control
  points as solid circles, draggable per the rules in
  `buildSplineGraph`.
- Non-active curves are drawn at 35 % opacity with no points (purely
  visual context, not interactive).
- Click a legend chip to make that anchor active.
- Click on a non-active curve in the plot (within ~4 px) also activates it.
- The dimmed background curves are drawn into the same SVG behind the
  active layer. The active layer (curve + control points) and the
  pointer handlers operate against the active anchor's spline, via the
  shared `installSplinePointerHandlers` helper described above.

### Active-anchor identity

Track the active anchor by reference identity, not list index. After a
re-sort triggered by an anchor-value edit, the active anchor stays
active even if its index changes.

### Anchor value editing

Numeric input in the legend chip. On `change`, re-sort the list by anchor
ascending and re-render. No drag for anchor values in v1.

### Add anchor

Appends a new anchor at `lastAnchor + 0.1`, clamped to `xRange`, with a
flat default spline `[{x: -1, y: 0}, {x: 1, y: 0}]` (matches the
existing code path). The new anchor becomes active.

### Delete anchor

Refuses if length would drop below 1. If the active anchor is deleted,
activate the previous one (or index 0 if it was first).

## Y-axis ranges

Fixed per section, declared as constants in `splineEditor.ts`:

| Section | Y range | Default data | Headroom |
|---|---|---|---|
| Continentalness → Height | `[-50, 110]` | `-40 … 100` | small margin both ends |
| Erosion (by Continentalness) | `[-50, 50]` | `-10 … 40` | symmetric |
| Peaks & Valleys (by Erosion) | `[-30, 30]` | `-10 … 15` | symmetric |

X range is `[-1, 1]` for all three (the noise output domain).

Values dragged or typed outside the Y range clamp on commit; X is bounded
by neighbors per the rules above.

## Spline shape export / import

`buildSplineShapeToolbar` renders a small toolbar inserted at the top of
the splines area in `debugPanel.ts`, just before the three section calls
at lines 308–321. Three controls, styled like the existing preset row at
the top of the panel:

```
[ ↓ Export shape ]   [ ↑ Import shape ]   [ Reset to defaults ]
```

```ts
buildSplineShapeToolbar({
  getShape: () => TerrainShape,
  setShape: (s: TerrainShape) => void,
  onChange: () => void,   // fires splineRerenders so all three graphs redraw
}): { element: HTMLElement }
```

`onChange` does **not** trigger a world regeneration — that stays
behind the existing "Apply & Regenerate" button. Importing a shape or
resetting to defaults updates `params.shape.shape` and refreshes the
graph visuals; the user then clicks Apply to actually rebuild the
world. This matches how existing preset loads behave.

### Export

Writes a JSON file `terrain-shape.json` with shape:

```json
{
  "worldImaginerSplineShape": true,
  "shape": {
    "continent": [...],
    "erosionByContinent": [...],
    "pvByErosion": [...]
  }
}
```

Uses the same `Blob` + `<a download>` pattern as `exportPreset`
(`debugPanel.ts:915`). The `worldImaginerSplineShape: true` discriminator
distinguishes shape files from preset files.

### Import

Opens a file picker (mirroring `importPreset`, `debugPanel.ts:935`). On
load:

1. Validate `data.worldImaginerSplineShape === true`.
2. Validate `data.shape` has all three keys (`continent`,
   `erosionByContinent`, `pvByErosion`).
3. Validate each spline has length ≥ 2; sort by `x` if not already
   sorted.
4. Validate each anchored list has length ≥ 1; sort by `anchor` if not
   already sorted.
5. On any validation failure, `alert("Not a valid spline shape file.")`
   and abort.
6. On success, call `setShape(loaded)`, then `onChange()` so all three
   graphs redraw and the world re-runs.

### Reset to defaults

Calls `setShape(deepCloneDefault())` where `deepCloneDefault` returns a
fresh deep clone of `DEFAULT_TERRAIN_SHAPE`. Then `onChange()`.

## `debugPanel.ts` integration

- Add `import { buildSplineGraph, buildAnchoredSplineGraph,
  buildSplineShapeToolbar } from "./splineEditor";`
- Insert the toolbar element into the splines body before the three
  existing `body.appendChild(...)` calls at lines 308–321.
- Rewrite `buildSplineSection`:
  - Keep collapsible header + body.
  - Body hosts `buildSplineGraph(...).element` instead of the numeric
    table.
  - Push the returned `rerender` to `splineRerenders`.
  - Drop the `xIn` / `yIn` / `del` row construction (lines ~530–565) and
    the "+ Add point" handler (~569–574).
- Rewrite `buildAnchoredSection`:
  - Keep collapsible header + body.
  - Body hosts `buildAnchoredSplineGraph(...).element`.
  - Push `rerender` to `splineRerenders`.
  - Drop the per-anchor accordion construction (lines ~617–660) and the
    "+ Add anchor" handler (~664–672).

The three call sites stay unchanged.

## Data flow

```
user gesture ──► splineEditor builds next array
              └─► setSpline / setList / setShape
                    └─► debugPanel writes params.shape.shape.*
              └─► graph rerender (and splineRerenders for shape import / reset)

later, user clicks "Apply & Regenerate"
              └─► onApply(cloneParams(params)) ──► world rebuild
```

Every mutation produces a new array (`map` / `filter` / spread), matching
the immutable update style used by the existing handlers. World
regeneration is decoupled from edits and only happens on Apply, exactly
like every other knob in the panel — no per-frame worker pressure during
drag.

## Validation

No automated tests in this repo; manual verification in the browser:

- Continentalness graph: drag a midpoint, click Apply, see height map
  regenerate.
- Click empty area to add a point; right-click to delete.
- Hover a point — tooltip shows correct values; hover the curve — tooltip
  follows.
- Erosion section: switch active anchor by clicking the legend chip and
  by clicking the dimmed curve. Edit the active spline; dimmed curves
  unchanged.
- Add an anchor; edit its value; the list resorts and the new anchor
  stays active.
- Delete the active anchor; the previous one becomes active.
- Export shape → import the same file → identical state.
- Reset to defaults → matches `DEFAULT_TERRAIN_SHAPE` exactly.
- Existing preset save/load still includes spline data (already does;
  re-verify).

## Out of scope / future work

- Y-range UI (currently code constants).
- Snap-to-grid mode toggle.
- Anchor value drag (slider above the plot).
- localStorage persistence for the current shape (only the existing
  preset system persists).
- Importing a preset file via the shape importer (different magic key on
  purpose; we'd add it explicitly if useful).
