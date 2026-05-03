# Multi-noise biome selection (project 08)

Status: design approved, ready for implementation plan.
Date: 2026-05-03.

## Motivation

The 2026-04-19 spline-terrain spec listed this as future work:

> **Full multi-noise biome selection.** Drop the (temp, humid) picker. Every
> biome declares a 6D climate box on `(temperature, humidity, continental-
> ness, erosion, peaks & valleys, depth)`; picker returns the closest match.
> Enables dedicated Stony Peaks, Windswept Hills, Frozen Ocean, Lush Caves
> biomes driven by the same fields the splines consume.

Today's `classifyBiome` in `08-spline-terrain/src/biomes.ts` is a hybrid:
three short-circuit thresholds (Ocean by continentalness, Beach by
continentalness + height, Mountains by erosion) wrapped around a `(temp,
humid)` matrix from `pickTempHumidBiome`. The climate fields drive shape via
splines but only nudge biome assignment via three special cases. Adding new
climate-aware biomes means adding more if-else branches.

This spec replaces the hybrid with a single declarative picker. Each biome
states *where it lives* in 6D climate space as a min/max box per axis. The
picker scores every biome's box against the sample point with a weighted
squared-overshoot fitness function and picks the minimum. Threshold logic
goes away; biomes become data.

## Goals

- Drop `pickTempHumidBiome` and the `BiomeClimateThresholds` short-circuits
  from `classifyBiome`. Replace with a 6D box matcher.
- Add four biomes called out in the original future-work bullet: Stony
  Peaks, Windswept Hills, Frozen Ocean, Lush Caves.
- Add a parallel cave-biome layer: a separate registry classifies *carved
  cave voxels* using the same matcher with `depth > 0`. Cave biomes
  define a floor block and wall block; the carve step paints them.
- Frozen Ocean's surface water freezes to ice.
- Surface biome boxes are read-only-inspectable in the debug panel; the
  global axis-weight vector and depth-scale knob are editable live.

## Non-goals

- Per-biome axis weights. Weights are global.
- Per-voxel surface biomes. Surface biome stays a per-column field.
- Smooth biome blending across boundaries (still a hard-pick per
  column / per cave voxel; existing grass-color blend kernel is unchanged).
- New cave decorations (azaleas, glow lichen, dripstone tips). Cave biomes
  paint floor + wall blocks only in this spec.
- New surface biomes beyond the four listed. The temperate matrix
  (Desert, Savanna, Plains, Forest, Birch Forest, Taiga, Tundra) is
  preserved as a set; only the *picker* changes.
- Editable biome boxes in the debug panel. Boxes live in code; the panel
  shows them read-only for diagnostics.
- Visual / drag-to-edit biome editor. Future work.

## Architecture

### Two parallel pickers

Both share the same matching algorithm and the same `BiomePickerParams`
(weights + depthScale). They differ only in the registry they consult.

- **Surface picker.** Runs once per column inside the existing chunk
  column loop. Consumes `(temp, humid, continent, erosion, pv,
  depthBlocks=0)`. Output: `BiomeId`. Drives surface block, decorations,
  grass color, vegetation — same downstream chain as today.
- **Cave picker.** Runs per *carved cave voxel* inside the cave-carve
  step. Consumes the same five climate fields plus `depthBlocks =
  surfaceHeight - voxelY` (positive integer; greater = deeper). Output:
  `CaveBiomeId`. Drives the carved cell's floor / wall palette.

Splitting the registries means each picker only iterates biomes
appropriate to its layer. Lush Caves lives only in the cave registry —
it has no surface variant in this spec; "Lush Caves" refers to the cave
biome that paints moss floors under cave voxels in warm + humid columns.

### What goes away

- `pickTempHumidBiome` in `biomes.ts`.
- The three threshold short-circuits at the top of `classifyBiome`.
- `BiomeClimateThresholds` interface and its entry in `DEFAULT_PARAMS.shape`.
- The `t` parameter of `classifyBiome` (no longer needed).

The Ocean / Beach / Mountains thresholds become regular boxes in the
surface registry. Their behavior is preserved (Ocean covers low continent,
Beach covers a narrow band of mid-low continent + low pv, Mountains covers
high continent + low erosion); the difference is they're declarative now.

### File-level changes

**Added:**

- `src/biomeBoxes.ts` — types (`Axis`, `BiomeBox`, `BiomeBoxEntry`,
  `GlobalAxisWeights`, `BiomePickerParams`, `ClimatePoint`), the
  `pickBiome(point, registry, params)` matcher, the `fitness()` helper,
  and both registries (`SURFACE_REGISTRY`, `CAVE_REGISTRY`) populated
  with default box values.

**Modified:**

- `biomes.ts` — remove `pickTempHumidBiome`. Rewrite `classifyBiome` as a
  thin wrapper over `pickBiome(SURFACE_REGISTRY, ...)`. Add the four new
  surface biomes to the `Biome` enum + `BIOME_DEFS`. Add `CaveBiome` enum
  + `CAVE_BIOME_DEFS`. Update `createBiomeDebugSampler` to call the new
  `classifyBiome`.
- `blocks.ts` — add `Moss` and `Ice` block types (and any texture-atlas
  wiring that follows the existing pattern in this file).
- `chunk.ts` — column loop: drop the `t` argument and call the new
  `classifyBiome`. Cave-carve step: after a voxel is marked air, if the
  cell immediately below is solid, run the cave picker and replace that
  solid cell with the cave biome's `floorBlock` (a no-op for the Stone
  biome since `floorBlock = Stone`). Walls stay Stone for both cave
  biomes in this spec but the data path supports per-biome wall blocks
  for future work. Water-fill step: when filling the topmost water cell
  of a column whose surface biome is `FrozenOcean`, place `Block.Ice`
  instead of `Block.Water`.
- `generationParams.ts` — remove `BiomeClimateThresholds` and its
  `DEFAULT_PARAMS.shape.biomeClimate` entry. Add a new top-level
  `biomePicker: BiomePickerParams` group, defaulting to
  `DEFAULT_BIOME_PICKER` from `biomeBoxes.ts`.
- `debugPanel.ts` — new "Biome picker" collapsible section with two
  subsections (axis weights, biome boxes) detailed below.

## Data model

```ts
// biomeBoxes.ts

export const Axis = {
  Temperature:  0,
  Humidity:     1,
  Continent:    2,
  Erosion:      3,
  PeaksValleys: 4,
  Depth:        5,
} as const;
export type AxisIdx = typeof Axis[keyof typeof Axis];

/** A 6D inclusive box. The five climate axes use noise-output range
 *  [-1, +1]. Depth uses *normalized* units after the picker divides
 *  raw depth (in blocks) by depthScale, so all axes are comparable
 *  before weighting. */
export interface BiomeBox {
  temperature:  [number, number];
  humidity:     [number, number];
  continent:    [number, number];
  erosion:      [number, number];
  peaksValleys: [number, number];
  depth:        [number, number];
}

export interface BiomeBoxEntry<Id extends number> {
  id: Id;
  box: BiomeBox;
}

export interface GlobalAxisWeights {
  temperature:  number;
  humidity:     number;
  continent:    number;
  erosion:      number;
  peaksValleys: number;
  depth:        number;
}

export interface BiomePickerParams {
  weights: GlobalAxisWeights;
  /** Divide raw depth (blocks below surface) by this to get the value
   *  matched against the box's depth range. Default 64. */
  depthScale: number;
}

export interface ClimatePoint {
  temperature:  number;
  humidity:     number;
  continent:    number;
  erosion:      number;
  peaksValleys: number;
  /** Raw depth in blocks (positive = below surface). The picker
   *  normalizes internally using depthScale. */
  depthBlocks:  number;
}

export const DEFAULT_AXIS_WEIGHTS: GlobalAxisWeights = {
  temperature:  1.0,
  humidity:     1.0,
  continent:    1.5,
  erosion:      1.0,
  peaksValleys: 0.7,
  depth:        1.0,
};

export const DEFAULT_BIOME_PICKER: BiomePickerParams = {
  weights:    DEFAULT_AXIS_WEIGHTS,
  depthScale: 64,
};
```

## Picker algorithm

```ts
function axisDistance(value: number, range: [number, number]): number {
  if (value < range[0]) return range[0] - value;
  if (value > range[1]) return value - range[1];
  return 0;
}

export function fitness(
  point: ClimatePoint,
  box: BiomeBox,
  w: GlobalAxisWeights,
  depthScale: number,
): number {
  const dT = axisDistance(point.temperature,            box.temperature)  * w.temperature;
  const dH = axisDistance(point.humidity,               box.humidity)     * w.humidity;
  const dC = axisDistance(point.continent,              box.continent)    * w.continent;
  const dE = axisDistance(point.erosion,                box.erosion)      * w.erosion;
  const dP = axisDistance(point.peaksValleys,           box.peaksValleys) * w.peaksValleys;
  const dD = axisDistance(point.depthBlocks/depthScale, box.depth)        * w.depth;
  return dT*dT + dH*dH + dC*dC + dE*dE + dP*dP + dD*dD;
}

export function pickBiome<Id extends number>(
  point: ClimatePoint,
  registry: ReadonlyArray<BiomeBoxEntry<Id>>,
  params: BiomePickerParams,
): Id {
  let bestId    = registry[0].id;
  let bestScore = fitness(point, registry[0].box, params.weights, params.depthScale);
  for (let i = 1; i < registry.length; i++) {
    const score = fitness(point, registry[i].box, params.weights, params.depthScale);
    if (score < bestScore) { bestScore = score; bestId = registry[i].id; }
  }
  return bestId;
}
```

**Inside-box behavior.** A point inside biome X's box on all six axes
scores 0; X always wins (no other biome can score lower than 0). If two
biomes' boxes overlap and both contain the point, the one earlier in the
registry wins (strict `<` in the loop).

**Outside-all-boxes behavior.** Every sample resolves to *some* biome —
the one with the smallest weighted-squared-overshoot sum. No "default"
or fallback path needed.

**Tie behavior.** Equal scores → the earlier entry wins. Registry order
is therefore part of the design, documented below.

**Cost.** Surface registry: 13 biomes × 6 axes ≈ 78 ops per column.
Negligible vs the per-column climate-noise fBm samples already running.
Cave registry: 2 biomes × 6 axes per carved cave voxel; cave voxels are a
small minority of total voxels.

**No per-call allocations.** Both pickers take a pre-built `ClimatePoint`
and return an integer. Surface column loop builds one point per column;
cave loop builds one per carved cell.

## Biome content

### New blocks

- `Block.Moss` — Lush Caves floor.
- `Block.Ice` — Frozen Ocean surface water replacement.

These are the only new block types this spec introduces. Wall blocks for
both cave biomes stay Stone.

### Biome IDs

```ts
export const Biome = {
  Ocean: 0, Beach: 1, Desert: 2, Savanna: 3, Plains: 4,
  Forest: 5, BirchForest: 6, Taiga: 7, Tundra: 8, Mountains: 9,
  StonyPeaks: 10, WindsweptHills: 11, FrozenOcean: 12,
} as const;

export const CaveBiome = {
  Stone: 0, LushCaves: 1,
} as const;
```

LushCaves is a `CaveBiome` only; it has no entry in the surface `Biome`
enum. Cave biomes are looked up through a separate registry and applied
during cave carve, so they never need to share an id space with surface
biomes.

### Cave-biome definitions

```ts
export interface CaveBiomeDef {
  name: string;
  floorBlock: number;
  wallBlock:  number;
}

export const CAVE_BIOME_DEFS: Record<number, CaveBiomeDef> = {
  [CaveBiome.Stone]:     { name: "Stone",      floorBlock: Block.Stone, wallBlock: Block.Stone },
  [CaveBiome.LushCaves]: { name: "Lush Caves", floorBlock: Block.Moss,  wallBlock: Block.Stone },
};
```

### Surface registry order

Order is deliberate — earlier entries win ties and overlapping-box cases.
Most specific first, most general last:

1. `FrozenOcean` — cold + low continent
2. `Ocean` — rest of low continent
3. `Beach` — narrow band of mid-low continent + low pv
4. `StonyPeaks` — high continent + very low erosion + high pv
5. `Mountains` — rest of high continent + low erosion
6. `WindsweptHills` — mid-high continent + mid-low erosion
7. `Desert`
8. `Savanna`
9. `Forest`
10. `BirchForest`
11. `Plains`
12. `Taiga`
13. `Tundra`

The temperate seven (Desert through Tundra) are the matrix replacement.
Their boxes are *narrow* on temperature/humidity (carving up the (temp,
humid) plane the way `pickTempHumidBiome` did) and *wide* on the climate
spline axes (continent, erosion, pv). On a normal inland column with
mid-spline values, all spline-axis distances are zero for all seven, and
temp/humid distance picks the winner — same effective behavior as the
old matrix.

### Cave registry order

1. `LushCaves` — warm + humid + depth > 0
2. `Stone` — depth > 0, climate axes wide-open

Stone is the cave-side default: any cave voxel that doesn't fit Lush
Caves' climate falls into Stone.

### Default boxes

Numeric values are the starting point. Final tuning happens during
implementation while looking at the in-world result; this spec freezes
the *structure* of which axes each biome cares about.

The five climate axes use range `[-1, +1]`. Depth uses normalized units
(raw depth blocks ÷ `depthScale=64`); a band of `[-0.1, 0.1]` corresponds
to roughly the surface ±6 blocks. Surface biomes use that surface band;
cave biomes use `[0.1, 1.0]` (deeper than ~6 blocks below surface).

```
Surface registry (in order):

FrozenOcean    temp[-1.0,-0.3] humid[-1,1]  cont[-1,-0.25] eros[-1,1]  pv[-1,1]    depth[-0.1,0.1]
Ocean          temp[-1,1]      humid[-1,1]  cont[-1,-0.25] eros[-1,1]  pv[-1,1]    depth[-0.1,0.1]
Beach          temp[-1,1]      humid[-1,1]  cont[-0.25,-0.05] eros[-1,1] pv[-1,0]  depth[-0.1,0.1]
StonyPeaks     temp[-1,0.2]    humid[-1,1]  cont[ 0.4,1]   eros[-1,-0.5] pv[ 0.3,1] depth[-0.1,0.1]
Mountains      temp[-1,1]      humid[-1,1]  cont[ 0.2,1]   eros[-1,-0.4] pv[-1,1]  depth[-0.1,0.1]
WindsweptHills temp[-1,1]      humid[-1,1]  cont[ 0.0,1]   eros[-0.6,-0.2] pv[-1,1] depth[-0.1,0.1]
Desert         temp[ 0.2,1]    humid[-1,0.15] cont[-0.05,1] eros[-1,1] pv[-1,1]    depth[-0.1,0.1]
Savanna        temp[ 0.2,1]    humid[ 0.15,1] cont[-0.05,1] eros[-1,1] pv[-1,1]    depth[-0.1,0.1]
Forest         temp[-0.15,0.2] humid[ 0.2,1]  cont[-0.05,1] eros[-1,1] pv[-1,1]    depth[-0.1,0.1]
BirchForest    temp[-0.15,0.2] humid[-0.1,0.2] cont[-0.05,1] eros[-1,1] pv[-1,1]   depth[-0.1,0.1]
Plains         temp[-0.15,0.2] humid[-1,-0.1] cont[-0.05,1] eros[-1,1] pv[-1,1]    depth[-0.1,0.1]
Taiga          temp[-1,-0.15]  humid[ 0.05,1] cont[-0.05,1] eros[-1,1] pv[-1,1]    depth[-0.1,0.1]
Tundra         temp[-1,-0.15]  humid[-1,0.05] cont[-0.05,1] eros[-1,1] pv[-1,1]    depth[-0.1,0.1]

Cave registry (in order):

LushCaves      temp[ 0.0,1]    humid[ 0.2,1] cont[-0.2,1]  eros[-1,1]  pv[-1,1]    depth[ 0.1,1.0]
Stone          temp[-1,1]      humid[-1,1]   cont[-1,1]    eros[-1,1]  pv[-1,1]    depth[ 0.1,1.0]
```

**Notes on the table.** FrozenOcean precedes Ocean: a cold + low-continent
sample sits inside both boxes (Ocean's temperature range is wide-open,
FrozenOcean's is narrow but contains cold values), so both score 0 and
registry order picks FrozenOcean. A warm + low-continent sample sits
inside Ocean only — Ocean wins outright. The temperate-seven boxes
mirror the thresholds in the old `pickTempHumidBiome` (temp 0.2 / -0.15;
humid 0.15 / 0.2 / -0.1 / 0.05) so the matrix coverage carries over.

### Frozen Ocean ice rule

`chunk.ts` water-fill step: when filling the topmost water cell (the
cell at `waterLevel`) of a column whose surface biome is
`Biome.FrozenOcean`, place `Block.Ice` instead of `Block.Water`. One
conditional in the existing fill loop. No other ice formation (no thicker
ice sheets, no edge spread) — this is the minimum visual marker.

### Lush Caves floor rule

`chunk.ts` cave-carve step: after marking a voxel as air, build a
`ClimatePoint` with `depthBlocks = surfaceHeight - voxelY` and call the
cave picker. If the result is `CaveBiome.LushCaves` *and* the cell at
`voxelY - 1` is currently solid (i.e. this air voxel sits on a cave
floor), replace that solid cell with `Block.Moss`. Wall blocks stay
Stone for both cave biomes in this spec; the data path on
`CaveBiomeDef.wallBlock` is in place for future expansion.

## Debug panel

New "Biome picker" collapsible section in `debugPanel.ts`, below the
existing "Spline tables" section.

### Subsection A — Global axis weights (editable)

Six number inputs for weights + one for depth scale:

```
Axis weights
  temperature   [1.00]
  humidity      [1.00]
  continent     [1.50]
  erosion       [1.00]
  peaksValleys  [0.70]
  depth         [1.00]
  depthScale    [64]
```

Edits trigger the existing debounced `regenerateWorld()` path used by all
other knobs. Range guards: weights `>= 0`; depthScale `> 0`. Out-of-range
values clamp on commit.

### Subsection B — Biome boxes (read-only inspector)

Each surface biome and cave biome gets a collapsible row. Collapsed view
shows the biome name and a one-line summary; expanded view lists each
axis range:

```
▼ Plains
    temperature   [-0.15, 0.20]
    humidity      [-1.00, -0.10]
    continent     [-0.05, 1.00]
    erosion       [-1.00, 1.00]
    peaksValleys  [-1.00, 1.00]
    depth         [-0.10, 0.10]
```

Cave biomes appear under a separator row labelled "Cave biomes". All
values are plain text — no inputs, no buttons. Source of truth is the
registry arrays in `biomeBoxes.ts`. Diagnostic-only.

### Existing biome-debug overlay

`createBiomeDebugSampler` keeps its public shape (it returns the picked
`BiomeId` plus the climate sample). Its body changes to call the new
`classifyBiome`. The overlay UI is unchanged.

## Implementation checklist

For the implementation plan to expand:

1. Add `Block.Moss` and `Block.Ice` to `blocks.ts` (with texture-atlas
   wiring matching existing block additions in this file).
2. Create `src/biomeBoxes.ts` with types, `fitness`, `pickBiome`,
   `DEFAULT_AXIS_WEIGHTS`, `DEFAULT_BIOME_PICKER`, `SURFACE_REGISTRY`,
   `CAVE_REGISTRY`.
3. In `biomes.ts`: add the four new `Biome` enum entries + their
   `BIOME_DEFS` (surface palette / decorations / trees). Add `CaveBiome`
   enum + `CAVE_BIOME_DEFS`. Remove `pickTempHumidBiome`. Rewrite
   `classifyBiome` to delegate to `pickBiome(SURFACE_REGISTRY, ...)`.
   Update `createBiomeDebugSampler` accordingly.
4. In `generationParams.ts`: remove `BiomeClimateThresholds` interface
   and its entry; remove `biomeClimate` from `TerrainShapeParams`. Add
   top-level `biomePicker: BiomePickerParams` defaulting to
   `DEFAULT_BIOME_PICKER`.
5. In `chunk.ts`: drop the `t` argument from the column-loop
   `classifyBiome` call. Inside the cave-carve step, when a newly-air
   voxel sits on a solid cell, run the cave picker and overwrite that
   solid cell with `CaveBiomeDef.floorBlock`. Add `Block.Ice`
   substitution at the topmost water cell of FrozenOcean columns in
   the water-fill step.
6. In `debugPanel.ts`: add the "Biome picker" section with axis-weights
   editor + read-only box inspector.
7. Tune the default box numbers in-world: walk Frozen Ocean / Stony
   Peaks / Windswept Hills surface regions and Lush Caves cave regions;
   confirm they appear where the design intends. Adjust ranges if a
   biome is too rare or bleeds into neighbours. (Tuning happens in
   `biomeBoxes.ts`; the spec freezes structure, not exact numbers.)

## Future work

- **Editable biome boxes in the debug panel.** Promote the read-only
  inspector to a numeric-list editor matching the spline-tables section,
  so boxes can be tuned live without rebuilds.
- **Cave decorations.** Scattered moss carpet + glow lichen for Lush
  Caves; dripstone tips for a future Dripstone Caves biome. Requires a
  new pass after cave carving and a small set of new blocks.
- **More cave biomes.** Dripstone Caves, Deep Dark — both fit the same
  registry pattern.
- **Per-biome cave wall blocks.** The `CaveBiomeDef.wallBlock` field is
  already in the data path; populate it once a biome wants non-Stone
  walls.
- **Visual biome editor.** Drag rectangles in 2D climate-axis projections
  to author biome boxes graphically.
