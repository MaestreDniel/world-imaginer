# Spline-based terrain shaping (project 08)

Status: design approved, ready for implementation plan.
Date: 2026-04-19.

## Motivation

Project 07 computes column height as:

```
height = baseHeight + biome.heightOffset + warpedFbm() * biome.heightScale * heightMultiplier
```

The biome owns the shape. This makes it hard to author terrain intentionally —
you tune a scalar per biome and hope the noise drapes the world over it in a
pleasant way. Oceans appear wherever the noise dips, coasts are accidents of
the (temp, humid) biome map, and "mountains" only happen because the Mountains
biome multiplies the same noise by a bigger number.

Minecraft 1.18 flipped this around: several low-frequency climate noise fields
(continentalness, erosion, peaks & valleys) feed piecewise splines that
directly produce the target height, and biomes become a *classification* of
the climate plus the resulting height. The result is authorable terrain — you
can edit a few spline control points and predictably change "how much ocean",
"how sharp the coasts", "how tall the mountains".

Project 08 implements that model in isolation so it can be compared against
07. This spec covers the first pass; the long-term goals (visual spline
editor, full multi-noise biome selection) are listed under Future work.

## Goals

- Replace biome-driven heights with a climate-driven spline pipeline.
- Three climate fields: continentalness, erosion, peaks & valleys.
- Splines are authored as `{x, y}` point lists, evaluated piecewise-linearly.
- Nested structure: erosion sub-splines are anchored on continentalness
  values; PV sub-splines are anchored on erosion values. Blended evaluation
  so there are no seams at band transitions.
- Biome picker takes continentalness + erosion in addition to (temp, humid),
  with climate-field overrides for Ocean, Beach, Mountains.
- World Y-extent becomes parametric (default −48 to +120).
- Splines and thresholds are editable at runtime via a numeric-list debug
  panel. No hardcoded constants baked into the generation code.

## Non-goals

- Visual / drag-to-edit spline editor (future work).
- Full MC 1.18 multi-noise 6D biome selection (future work).
- New biomes. The existing biome set stays; only the selection rule changes.
- Changing caves, aquifers, rivers, vegetation, ores, structures. This spec
  only touches the column-height step.

## Architecture

### Project scaffold

New project `08-spline-terrain/`, copied from `07-advanced-terrain/` as the
starting point. Same stack (Vite+TS, web worker chunk generation, three.js
rendering). New entry in `docker-compose.yml` at the next free port (5181).

### Height pipeline

The single line in `chunk.ts` that assigned `heights[idx]` is replaced by
`terrainShape.heightAt(wx, wz)`. Everything downstream (voxel fill, caves,
aquifers, rivers, vegetation, structures) is unchanged — they all read
`heights[idx]` and don't care how it was produced.

```
continentalness(x,z)  ─► splineContinent          ─► baseHeight
                         ▲
erosion(x,z) ───────────►│  blended erosion spline ─► erosionAdjust
                         │  (anchored on continentalness)
peaksValleys(x,z) ──────►│  blended PV spline      ─► pvAdjust
                         │  (anchored on erosion)

finalHeight = clamp(baseHeight + erosionAdjust + pvAdjust,
                    minHeight, maxHeight)
```

### New files

- `src/splines.ts` — `SplinePoint`, `Spline`, `AnchoredSpline`, `TerrainShape`
  types. `evalSpline()` (piecewise-linear with binary search) and
  `evalAnchored(list, key, innerX)` (anchor-blended). Default tables.
- `src/climate.ts` — three `createNoise(seed + k)` samplers bundled, one fBm
  helper per field, output roughly `[-1, +1]`.
- `src/terrainShape.ts` — `heightAt(wx, wz)` runs the three-stage nested
  evaluation. Uses `splines.ts` + `climate.ts`.

### Modified files

- `chunk.ts` — column loop calls `terrainShape.heightAt(...)` instead of
  computing height inline from biome params.
- `biomes.ts` — biome picker takes `(temp, humid, continentalness, erosion,
  height, waterLevel)`. `heightScale` / `heightOffset` fields removed from
  `BiomeDef`. `computeBlendedBiomeParams` collapses to grass-color blending
  only (dominant biome for block selection is still the center sample).
- `generationParams.ts` — new `shape: TerrainShapeParams` section
  (climate scales + spline tables + biome-climate thresholds). New
  `extent: WorldExtentParams` section. The `terrain` section from 07 is
  removed entirely — its fBm+warp config is superseded by the per-field
  climate noise config (each of continentalness, erosion, PV carries its
  own scale/octaves/persistence/lacunarity/warpStrength).
- `debugPanel.ts` — new sections: World extent, Climate noise, Spline tables.
- `world.ts` — `minCY` / `maxCY` derived from `params.extent.minHeight /
  maxHeight` instead of hardcoded.

## Spline data and evaluation

```ts
export interface SplinePoint { x: number; y: number; }
export type Spline = SplinePoint[];            // sorted by x, length >= 2

export interface AnchoredSpline { anchor: number; spline: Spline; }

export interface TerrainShape {
  continent: Spline;
  erosionByContinent: AnchoredSpline[];
  pvByErosion: AnchoredSpline[];
}
```

`evalSpline(s, x)` — clamp to endpoints, binary-search for the segment,
linear-interpolate.

`evalAnchored(list, key, innerX)`:

```
if key <= list[0].anchor:       return evalSpline(list[0].spline,  innerX)
if key >= list[N-1].anchor:     return evalSpline(list[N-1].spline, innerX)
find i with list[i].anchor <= key < list[i+1].anchor
t = (key - list[i].anchor) / (list[i+1].anchor - list[i].anchor)
return lerp(
  evalSpline(list[i].spline,   innerX),
  evalSpline(list[i+1].spline, innerX),
  t,
)
```

Cost per column: 1 `continent` eval + 2 erosion-spline evals + 2 PV-spline
evals = 5 binary-searched lerps. Negligible next to the fBm samples.

Anchor lists can have as few as 1 entry (collapses to a single global
sub-spline). Adding an anchor inserts a 2-point identity spline
`[(-1, 0), (+1, 0)]` so the addition alone doesn't change the world.

### Default tables

```ts
continent: [
  { x: -1.0, y: -40 },
  { x: -0.3, y: -15 },
  { x: -0.2, y:   5 },
  { x:  0.3, y:  40 },
  { x:  0.4, y:  90 },
  { x:  1.0, y: 100 },
]

erosionByContinent: [
  { anchor: -0.2, spline: [{x:-1,y:+2},  {x:0,y:0}, {x:1,y:-1}] },
  { anchor:  0.4, spline: [{x:-1,y:+40}, {x:0,y:0}, {x:1,y:-10}] },
]

pvByErosion: [
  { anchor: -0.5, spline: [{x:-1,y:-10}, {x:0,y:0}, {x:1,y:+15}] },
  { anchor:  0.5, spline: [{x:-1, y:-2}, {x:0,y:0}, {x:1, y:+3}] },
]
```

These are the initial values users can tweak in the debug panel.

## Biome assignment

`BiomeDef` loses `heightScale` and `heightOffset`. The picker becomes:

```ts
function pickBiome(temp, humid, continentalness, erosion, height, waterLevel): Biome {
  if (continentalness < t.oceanContinentalness) return Biome.Ocean;
  if (height < waterLevel + t.beachBand
      && continentalness < t.coastContinentalness) return Biome.Beach;
  if (erosion < t.mountainErosion
      && continentalness > t.inlandContinentalness) return Biome.Mountains;
  return pickTempHumidBiome(temp, humid);   // existing logic
}
```

Thresholds live in `generationParams.ts` next to the spline tables:

```ts
export interface BiomeClimateThresholds {
  oceanContinentalness: number;    // default -0.25
  coastContinentalness: number;    // default -0.05
  beachBand: number;               // default 3
  inlandContinentalness: number;   // default  0.2
  mountainErosion: number;         // default -0.4
}
```

Why:

- **Ocean** by continentalness gives real continental shelves instead of
  "wherever noise dipped below zero".
- **Beach** as a climate+height rule gives consistent coastline widths.
- **Mountains** by low erosion on continental land makes mountains appear
  in bands instead of wherever height noise peaks.
- Desert / Tundra / Plains / Forest / Swamp / Savanna stay keyed off the
  existing (temp, humid) matrix.

## World extent

```ts
export interface WorldExtentParams {
  minHeight: number;   // default -48
  maxHeight: number;   // default 120
}
```

Used to clamp `finalHeight` and to derive chunk Y-range in `world.ts`:

```ts
const minCY = Math.floor(params.extent.minHeight / CHUNK_SIZE) - 1;
const maxCY = Math.ceil (params.extent.maxHeight / CHUNK_SIZE) + 1;
```

Defaults give `minCY = -4, maxCY = 8` → 13 Y-layers vs 07's 7. Worker pool
handles the extra load; call out as a perf consideration during testing.

`BEDROCK_BOTTOM` in `chunk.ts` (hardcoded `-32` in 07) becomes
`params.extent.minHeight` so bedrock tracks the world floor.

## Debug panel

Three new collapsible sections.

### World extent

Two number inputs: `minHeight`, `maxHeight`. Edits regenerate chunks and
refresh `minCY` / `maxCY` in `world.update()`.

### Climate noise

One subsection per field (continentalness, erosion, peaks & valleys):

- `scale` (noise frequency; larger = broader features)
- `octaves`, `persistence`, `lacunarity`
- `warpStrength` (optional domain warp per field)

Defaults:

- continentalness: scale 1500, octaves 3
- erosion:         scale  600, octaves 3
- peaks & valleys: scale  180, octaves 4

### Spline tables

Three sub-panels:

- `continent` — single table, columns `[x, y, delete]`, "Add point" button.
- `erosionByContinent`, `pvByErosion` — list of anchored sub-tables:

```
▼ anchor: [-0.20]                              [Delete anchor]
   x      y      ×
   [-1]  [+2]    ×
   [ 0]  [ 0]    ×
   [+1]  [-1]    ×
   [Add point]
▼ anchor: [ 0.40]                              [Delete anchor]
   ...
[Add anchor]
```

Edits trigger `regenerateWorld()` through the same debounced path existing
knobs use.

Validation is minimal: anchor lists keep >= 1 entry, splines >= 2 entries,
`x` values auto-sort after every edit.

## What changes vs project 07

Summary for implementation checklist:

1. Copy `07-advanced-terrain/` → `08-spline-terrain/`, add Docker entry.
2. Add `splines.ts`, `climate.ts`, `terrainShape.ts`.
3. Extend `generationParams.ts` with `shape` and `extent` groups.
4. Rewrite column-height loop in `chunk.ts` to call `terrainShape.heightAt`.
5. Remove `heightScale` / `heightOffset` from `BiomeDef` in `biomes.ts`.
6. Rewrite biome picker to take climate fields + climate thresholds.
7. Simplify `computeBlendedBiomeParams` to grass-color blending only.
8. Derive chunk Y-range in `world.ts` from `params.extent`.
9. Replace `BEDROCK_BOTTOM` constant with `params.extent.minHeight`.
10. Add debug panel sections: World extent, Climate noise, Spline tables.

## Future work

Documented here so they aren't lost; not part of this spec.

- **Full multi-noise biome selection.** Drop the (temp, humid) picker. Every
  biome declares a 6D climate box on `(temperature, humidity, continental-
  ness, erosion, peaks & valleys, depth)`; picker returns the closest match.
  Enables dedicated Stony Peaks, Windswept Hills, Frozen Ocean, Lush Caves
  biomes driven by the same fields the splines consume.
- **Climate-noise smoothing.** If visible seams remain at sharp climate
  gradients despite anchor blending, add a small Gaussian smoothing pass
  on the climate noise before spline evaluation.
