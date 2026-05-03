# Multi-noise biome selection — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `(temp, humid) + threshold` biome picker in project 08 with a 6D box matcher driven by closest-match fitness, and add a parallel cave-biome layer that paints moss floors in Lush Caves.

**Architecture:** Two parallel pickers share one matching algorithm. The surface picker runs once per column over `SURFACE_REGISTRY`; the cave picker runs once per carved cave voxel over `CAVE_REGISTRY`. Each biome declares a 6D box on (temperature, humidity, continentalness, erosion, peaks-and-valleys, depth); the picker scores every biome's box with a weighted-squared-overshoot fitness function and returns the minimum. The Ocean / Beach / Mountains threshold short-circuits become regular boxes; `pickTempHumidBiome` and `BiomeClimateThresholds` are deleted.

**Tech stack:** TypeScript strict mode, Vite, web worker chunk generation, three.js rendering. No test framework — verification is via `tsc --noEmit`, `npm run build`, and manual in-browser inspection.

**Spec:** `docs/superpowers/specs/2026-05-03-multi-noise-biome-selection-design.md`.

---

## File structure

**Created:**
- `08-spline-terrain/src/biomeBoxes.ts` — types (`Axis`, `BiomeBox`, `BiomeBoxEntry`, `GlobalAxisWeights`, `BiomePickerParams`, `ClimatePoint`), `axisDistance`, `fitness`, `pickBiome`, `DEFAULT_AXIS_WEIGHTS`, `DEFAULT_BIOME_PICKER`, `SURFACE_REGISTRY`, `CAVE_REGISTRY`. Single source of truth for biome classification rules.

**Modified:**
- `08-spline-terrain/src/blocks.ts` — add `Block.Moss` enum entry, `TILE_IDS.Moss`, `BLOCK_DEFS[Block.Moss]`.
- `08-spline-terrain/src/textureAtlas.ts` — wire Moss into the noise-tile draw list.
- `08-spline-terrain/src/biomes.ts` — add `Biome.StonyPeaks`, `Biome.WindsweptHills`, `Biome.FrozenOcean` (no `LushCaves` in this enum) plus their `BIOME_DEFS`. Add `CaveBiome` enum and `CAVE_BIOME_DEFS`. Delete `pickTempHumidBiome`. Rewrite `classifyBiome` to delegate to `pickBiome(SURFACE_REGISTRY, ...)`. Rewrite `createBiomeDebugSampler`.
- `08-spline-terrain/src/generationParams.ts` — remove `BiomeClimateThresholds` interface, the `biomeClimate` field on `TerrainShapeParams`, and the corresponding `DEFAULT_PARAMS.shape.biomeClimate` block. Add a top-level `biomePicker: BiomePickerParams` field on `GenerationParams` with default `DEFAULT_BIOME_PICKER`.
- `08-spline-terrain/src/chunk.ts` — update the column loop's `classifyBiome` call signature, add a cave-picker call inside the cave-carve step that overwrites the cell-below with `CaveBiomeDef.floorBlock`, and extend the ice rule to fire on `Biome.FrozenOcean` columns.
- `08-spline-terrain/src/debugPanel.ts` — delete the "Biome Thresholds" section (id `biome-climate`). Add a "Biome picker" section with an editable axis-weights subsection and a read-only biome-box inspector subsection.

No other files change.

---

## Task 1 — Add `Block.Moss`

**Files:**
- Modify: `08-spline-terrain/src/blocks.ts`
- Modify: `08-spline-terrain/src/textureAtlas.ts`

- [ ] **Step 1: Add `Moss` to the `Block` enum**

In `08-spline-terrain/src/blocks.ts`, append `Moss: 35` to the `Block` const object (right after `FlowerBlue: 34`):

```ts
export const Block = {
  // … existing entries …
  FlowerBlue:   34,
  Moss:         35,
} as const;
```

- [ ] **Step 2: Add `Moss` to `TILE_IDS`**

Append `Moss: 38` to `TILE_IDS` (right after `FlowerBlue: 37`):

```ts
export const TILE_IDS = {
  // … existing entries …
  FlowerBlue:   37,
  Moss:         38,
} as const;
```

- [ ] **Step 3: Add a `BLOCK_DEFS` entry for Moss**

In `BLOCK_DEFS`, before the closing `};`, add:

```ts
  [Block.Moss]: {
    name: "Moss", color: 0x4F8B3C, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Moss, side: TILE_IDS.Moss, bottom: TILE_IDS.Moss },
  },
```

- [ ] **Step 4: Wire Moss into the texture atlas**

In `08-spline-terrain/src/textureAtlas.ts`, find the noise-tile array (currently ending around `[TILE_IDS.Glowstone, 0xFFDD44, 0.08]` near line 309). Add a row before the closing `]`:

```ts
    [TILE_IDS.Moss,         0x4F8B3C, 0.10],
```

- [ ] **Step 5: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add 08-spline-terrain/src/blocks.ts 08-spline-terrain/src/textureAtlas.ts
git commit -m "feat(08): add Moss block for Lush Caves floors"
```

---

## Task 2 — Scaffold `biomeBoxes.ts` with types and defaults

**Files:**
- Create: `08-spline-terrain/src/biomeBoxes.ts`

- [ ] **Step 1: Create the file with types and weight defaults**

Write `08-spline-terrain/src/biomeBoxes.ts`:

```ts
/**
 * 6D climate-box biome picker.
 *
 * Each biome declares an inclusive box on six axes: five climate fields
 * (temperature, humidity, continentalness, erosion, peaks & valleys) in
 * range [-1, +1], plus a normalized depth axis. The picker scores every
 * biome's box with a weighted-squared-overshoot fitness function and
 * returns the biome with the smallest score.
 *
 * Surface and cave biomes use separate registries with the same picker.
 */

export const Axis = {
  Temperature:  0,
  Humidity:     1,
  Continent:    2,
  Erosion:      3,
  PeaksValleys: 4,
  Depth:        5,
} as const;
export type AxisIdx = typeof Axis[keyof typeof Axis];

/**
 * A 6D inclusive box. The five climate axes use noise-output range
 * [-1, +1]. Depth uses *normalized* units after dividing the raw depth
 * (in blocks below surface) by depthScale, so all axes are comparable
 * before weighting.
 */
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
   *  matched against the box's depth range. */
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
  weights:    { ...DEFAULT_AXIS_WEIGHTS },
  depthScale: 64,
};
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/biomeBoxes.ts
git commit -m "feat(08): scaffold biomeBoxes types and default weights"
```

---

## Task 3 — Implement the `pickBiome` matcher

**Files:**
- Modify: `08-spline-terrain/src/biomeBoxes.ts`

- [ ] **Step 1: Append the matcher functions**

Append to `08-spline-terrain/src/biomeBoxes.ts`:

```ts
function axisDistance(value: number, range: [number, number]): number {
  if (value < range[0]) return range[0] - value;
  if (value > range[1]) return value - range[1];
  return 0;
}

/**
 * Sum of weighted-squared per-axis overshoots. A point inside the box
 * on every axis scores 0 (always wins). A point outside scores the sum
 * of squared, weighted overshoot distances.
 */
export function fitness(
  point: ClimatePoint,
  box: BiomeBox,
  w: GlobalAxisWeights,
  depthScale: number,
): number {
  const dT = axisDistance(point.temperature,             box.temperature)  * w.temperature;
  const dH = axisDistance(point.humidity,                box.humidity)     * w.humidity;
  const dC = axisDistance(point.continent,               box.continent)    * w.continent;
  const dE = axisDistance(point.erosion,                 box.erosion)      * w.erosion;
  const dP = axisDistance(point.peaksValleys,            box.peaksValleys) * w.peaksValleys;
  const dD = axisDistance(point.depthBlocks / depthScale, box.depth)       * w.depth;
  return dT*dT + dH*dH + dC*dC + dE*dE + dP*dP + dD*dD;
}

/**
 * Linear scan: returns the id of the registry entry with minimum
 * fitness. Strict `<` means earlier entries win ties, so registry
 * order is part of the design.
 */
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

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/biomeBoxes.ts
git commit -m "feat(08): implement pickBiome fitness matcher"
```

---

## Task 4 — Add new surface biomes to `Biome` enum and `BIOME_DEFS`

**Files:**
- Modify: `08-spline-terrain/src/biomes.ts`

- [ ] **Step 1: Extend the `Biome` enum**

In `08-spline-terrain/src/biomes.ts`, replace the `Biome` const (around line 103) with:

```ts
export const Biome = {
  Ocean:          0,
  Beach:          1,
  Desert:         2,
  Savanna:        3,
  Plains:         4,
  Forest:         5,
  BirchForest:    6,
  Taiga:          7,
  Tundra:         8,
  Mountains:      9,
  StonyPeaks:    10,
  WindsweptHills:11,
  FrozenOcean:   12,
} as const;
```

- [ ] **Step 2: Add `BIOME_DEFS` entries for the three new biomes**

Append to `BIOME_DEFS` (before the closing `};`):

```ts
  [Biome.StonyPeaks]: {
    name: "Stony Peaks",
    surfaceBlock: Block.Stone,
    subSurfaceBlock: Block.Stone,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
    decorationDensity: 0, decorations: [],
  },
  [Biome.WindsweptHills]: {
    name: "Windswept Hills",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.02, cactus: false,
    decorationDensity: 0.08,
    decorations: [
      { block: Block.TallGrass, weight: 0.7 },
      { block: Block.Fern,      weight: 0.3 },
    ],
  },
  [Biome.FrozenOcean]: {
    name: "Frozen Ocean",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.Sand,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
    decorationDensity: 0, decorations: [],
  },
```

- [ ] **Step 3: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/biomes.ts
git commit -m "feat(08): add StonyPeaks, WindsweptHills, FrozenOcean biome defs"
```

---

## Task 5 — Add `CaveBiome` enum and `CAVE_BIOME_DEFS`

**Files:**
- Modify: `08-spline-terrain/src/biomes.ts`

- [ ] **Step 1: Append the cave-biome types and table**

In `08-spline-terrain/src/biomes.ts`, append after the surface `BIOME_DEFS` block:

```ts
export const CaveBiome = {
  Stone:     0,
  LushCaves: 1,
} as const;
export type CaveBiomeId = (typeof CaveBiome)[keyof typeof CaveBiome];

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

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/biomes.ts
git commit -m "feat(08): add CaveBiome enum + Lush Caves cave-biome def"
```

---

## Task 6 — Define `SURFACE_REGISTRY`

**Files:**
- Modify: `08-spline-terrain/src/biomeBoxes.ts`

- [ ] **Step 1: Import `Biome` and append the surface registry**

In `08-spline-terrain/src/biomeBoxes.ts`, add at the top:

```ts
import { Biome, type BiomeId } from "./biomes";
```

Then append at the bottom:

```ts
/**
 * Surface biome registry. Order matters for tie-breaking (earlier wins).
 * Most specific first (FrozenOcean before Ocean), most general last
 * (the temperate matrix replacement).
 *
 * The five climate axes use [-1, +1]. Depth uses normalized units
 * (raw blocks ÷ depthScale=64). Surface biomes use depth band
 * [-0.1, +0.1] (≈ surface ± 6 blocks).
 */
export const SURFACE_REGISTRY: ReadonlyArray<BiomeBoxEntry<BiomeId>> = [
  { id: Biome.FrozenOcean, box: {
      temperature: [-1.0, -0.3], humidity: [-1, 1],
      continent:   [-1, -0.25],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Ocean, box: {
      temperature: [-1, 1],      humidity: [-1, 1],
      continent:   [-1, -0.25],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Beach, box: {
      temperature: [-1, 1],          humidity: [-1, 1],
      continent:   [-0.25, -0.05],   erosion:  [-1, 1], peaksValleys: [-1, 0],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.StonyPeaks, box: {
      temperature: [-1, 0.2],   humidity: [-1, 1],
      continent:   [ 0.4, 1],   erosion:  [-1, -0.5], peaksValleys: [ 0.3, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Mountains, box: {
      temperature: [-1, 1],     humidity: [-1, 1],
      continent:   [ 0.2, 1],   erosion:  [-1, -0.4], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.WindsweptHills, box: {
      temperature: [-1, 1],     humidity: [-1, 1],
      continent:   [ 0.0, 1],   erosion:  [-0.6, -0.2], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Desert, box: {
      temperature: [ 0.2, 1],   humidity: [-1, 0.15],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Savanna, box: {
      temperature: [ 0.2, 1],   humidity: [ 0.15, 1],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Forest, box: {
      temperature: [-0.15, 0.2], humidity: [ 0.2, 1],
      continent:   [-0.05, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.BirchForest, box: {
      temperature: [-0.15, 0.2], humidity: [-0.1, 0.2],
      continent:   [-0.05, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Plains, box: {
      temperature: [-0.15, 0.2], humidity: [-1, -0.1],
      continent:   [-0.05, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Taiga, box: {
      temperature: [-1, -0.15], humidity: [ 0.05, 1],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Tundra, box: {
      temperature: [-1, -0.15], humidity: [-1, 0.05],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
];
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/biomeBoxes.ts
git commit -m "feat(08): define SURFACE_REGISTRY with default 6D boxes"
```

---

## Task 7 — Define `CAVE_REGISTRY`

**Files:**
- Modify: `08-spline-terrain/src/biomeBoxes.ts`

- [ ] **Step 1: Extend the import and append the cave registry**

Update the import line at the top of `biomeBoxes.ts` to:

```ts
import { Biome, CaveBiome, type BiomeId, type CaveBiomeId } from "./biomes";
```

Append at the bottom:

```ts
/**
 * Cave biome registry. Runs once per carved cave voxel. Order matters
 * for tie-breaking; LushCaves first so warm + humid + deep voxels pick
 * it over the Stone default.
 *
 * Cave biomes use depth band [0.1, 1.0] (≈ 6 blocks below surface and
 * deeper).
 */
export const CAVE_REGISTRY: ReadonlyArray<BiomeBoxEntry<CaveBiomeId>> = [
  { id: CaveBiome.LushCaves, box: {
      temperature: [ 0.0, 1],   humidity: [ 0.2, 1],
      continent:   [-0.2, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [ 0.1, 1.0],
  }},
  { id: CaveBiome.Stone, box: {
      temperature: [-1, 1], humidity: [-1, 1],
      continent:   [-1, 1], erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [ 0.1, 1.0],
  }},
];
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/biomeBoxes.ts
git commit -m "feat(08): define CAVE_REGISTRY for Lush Caves + Stone default"
```

---

## Task 8 — Replace `BiomeClimateThresholds` with `biomePicker` in `generationParams.ts`

**Files:**
- Modify: `08-spline-terrain/src/generationParams.ts`

- [ ] **Step 1: Update imports**

In `08-spline-terrain/src/generationParams.ts`, change line 3:

```ts
import { type TerrainShape, DEFAULT_TERRAIN_SHAPE } from "./splines";
```

to:

```ts
import { type TerrainShape, DEFAULT_TERRAIN_SHAPE } from "./splines";
import { type BiomePickerParams, DEFAULT_BIOME_PICKER } from "./biomeBoxes";
```

- [ ] **Step 2: Remove `BiomeClimateThresholds` and its field on `TerrainShapeParams`**

Delete the entire `BiomeClimateThresholds` interface block (currently lines 75–86):

```ts
export interface BiomeClimateThresholds { /* … */ }
```

Then change `TerrainShapeParams` (currently lines 93–96):

```ts
export interface TerrainShapeParams {
  shape: TerrainShape;
  biomeClimate: BiomeClimateThresholds;
}
```

to:

```ts
export interface TerrainShapeParams {
  shape: TerrainShape;
}
```

- [ ] **Step 3: Add `biomePicker` to `GenerationParams`**

In the `GenerationParams` interface, add a `biomePicker` field. The interface currently looks like:

```ts
export interface GenerationParams {
  climate: ClimateParams;
  shape: TerrainShapeParams;
  extent: WorldExtentParams;
  // …
}
```

Insert `biomePicker: BiomePickerParams;` right after `shape`:

```ts
export interface GenerationParams {
  climate: ClimateParams;
  shape: TerrainShapeParams;
  biomePicker: BiomePickerParams;
  extent: WorldExtentParams;
  // …
}
```

- [ ] **Step 4: Update `DEFAULT_PARAMS`**

In `DEFAULT_PARAMS`, replace the `shape` block (currently):

```ts
  shape: {
    shape: DEFAULT_TERRAIN_SHAPE,
    biomeClimate: {
      oceanContinentalness:   -0.25,
      coastContinentalness:   -0.05,
      beachBand:               3,
      inlandContinentalness:   0.2,
      mountainErosion:        -0.4,
    },
  },
```

with:

```ts
  shape: {
    shape: DEFAULT_TERRAIN_SHAPE,
  },
  biomePicker: {
    weights:    { ...DEFAULT_BIOME_PICKER.weights },
    depthScale: DEFAULT_BIOME_PICKER.depthScale,
  },
```

(Spreading the weights ensures presets get an independent object, matching the spec's no-shared-mutable defaults convention.)

- [ ] **Step 5: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: TypeScript will flag every call site of `classifyBiome` and `createBiomeDebugSampler` that still passes `biomeClimate`. Note these errors — they will be fixed in Tasks 9 and 10.

- [ ] **Step 6: Commit (with type errors knowingly outstanding)**

The build will fail at this point. That's expected — Tasks 9 and 10 fix it. Commit anyway so the params change is one logical step:

```bash
git add 08-spline-terrain/src/generationParams.ts
git commit -m "refactor(08): replace BiomeClimateThresholds with biomePicker params"
```

---

## Task 9 — Rewrite `classifyBiome` and delete `pickTempHumidBiome`

**Files:**
- Modify: `08-spline-terrain/src/biomes.ts`

- [ ] **Step 1: Update imports**

At the top of `08-spline-terrain/src/biomes.ts`, add:

```ts
import { pickBiome, type ClimatePoint, SURFACE_REGISTRY } from "./biomeBoxes";
```

- [ ] **Step 2: Delete `pickTempHumidBiome`**

Remove the entire `pickTempHumidBiome` function (currently around lines 243–253).

- [ ] **Step 3: Rewrite `classifyBiome`**

Replace the existing `classifyBiome` function (currently around lines 255–273) with:

```ts
/**
 * Pick a surface biome from a 6D climate sample. Delegates to
 * `pickBiome` over `SURFACE_REGISTRY`. Surface columns always pass
 * `depthBlocks: 0` so the depth axis sits in the surface band.
 */
export function classifyBiome(
  continentalness: number,
  erosion: number,
  peaksValleys: number,
  temp: number,
  humid: number,
  picker: BiomePickerParams,
): BiomeId {
  const point: ClimatePoint = {
    temperature:  temp,
    humidity:     humid,
    continent:    continentalness,
    erosion,
    peaksValleys,
    depthBlocks:  0,
  };
  return pickBiome(point, SURFACE_REGISTRY, picker);
}
```

Also add `BiomePickerParams` to the imports at the top (extend the same import line):

```ts
import { pickBiome, type ClimatePoint, type BiomePickerParams, SURFACE_REGISTRY } from "./biomeBoxes";
```

- [ ] **Step 4: Update `createBiomeDebugSampler`**

Replace the existing `createBiomeDebugSampler` (currently around lines 351–373) with:

```ts
export function createBiomeDebugSampler(seed: number, params: GenerationParams, _waterLevel: number) {
  const terrainShaper = createTerrainShaper(seed, params);
  const tempHumidSampler = createBiomeSampler(seed, params.biomes);

  return function getBiomeDebug(wx: number, wz: number): BiomeDebugInfo {
    const sample = terrainShaper.sampleClimate(wx, wz);
    const height = terrainShaper.heightFromClimate(sample);
    const { temp, humid } = tempHumidSampler(wx, wz);
    const biome = classifyBiome(
      sample.continentalness, sample.erosion, sample.peaksValleys,
      temp, humid, params.biomePicker,
    );
    return {
      biome,
      temperature: temp,
      humidity: humid,
      continentalness: sample.continentalness,
      erosion: sample.erosion,
      peaksValleys: sample.peaksValleys,
      height,
    };
  };
}
```

(`waterLevel` is kept as a parameter — prefixed `_` to silence the unused warning — to preserve the existing public signature; downstream call sites still pass it.)

- [ ] **Step 5: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: errors will remain in `chunk.ts` (the column-loop call still uses the old signature) — these are fixed in Task 10. The errors in `biomes.ts` itself should be gone.

- [ ] **Step 6: Commit**

```bash
git add 08-spline-terrain/src/biomes.ts
git commit -m "refactor(08): classifyBiome now delegates to 6D box matcher"
```

---

## Task 10 — Update `chunk.ts` column loop

**Files:**
- Modify: `08-spline-terrain/src/chunk.ts`

- [ ] **Step 1: Update the column-loop biome-classification call**

In `08-spline-terrain/src/chunk.ts`, find the column loop around lines 87–95. Replace:

```ts
      const sample = terrainShaper.sampleClimate(wx, wz);
      const h = terrainShaper.heightFromClimate(sample);
      heights[idx] = h;
      const { temp, humid } = tempHumidSampler(wx, wz);
      biomes[idx] = classifyBiome(
        sample.continentalness, sample.erosion, temp, humid,
        h, waterLevel, config.params.shape.biomeClimate,
      );
```

with:

```ts
      const sample = terrainShaper.sampleClimate(wx, wz);
      const h = terrainShaper.heightFromClimate(sample);
      heights[idx] = h;
      const { temp, humid } = tempHumidSampler(wx, wz);
      biomes[idx] = classifyBiome(
        sample.continentalness, sample.erosion, sample.peaksValleys,
        temp, humid, config.params.biomePicker,
      );
```

- [ ] **Step 2: Update the second `classifyBiome` call site (around line 487)**

Find the second call (used for column-debug) around lines 484–490. Replace:

```ts
        const sample = terrainShaper.sampleClimate(wx, wz);
        // …
        biomeId = classifyBiome(
          sample.continentalness, sample.erosion, temp, humid,
          /* h */ … , waterLevel, config.params.shape.biomeClimate,
        );
```

with the equivalent new signature:

```ts
        const sample = terrainShaper.sampleClimate(wx, wz);
        // …
        biomeId = classifyBiome(
          sample.continentalness, sample.erosion, sample.peaksValleys,
          temp, humid, config.params.biomePicker,
        );
```

(Open the file to see the exact surrounding context — leave the `sample` and `temp`/`humid` declarations as-is, only change the `classifyBiome` arguments.)

- [ ] **Step 3: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors. (If `npx tsc` complains about `peaksValleys` not being on the `sample`, double-check `terrainShape.ts` — it should already provide it since project 08's spline pipeline samples it.)

- [ ] **Step 4: Smoke-check at runtime**

From `08-spline-terrain/`: `npm run dev` and open the printed URL in a browser. Confirm the world generates without console errors. Quick sanity check: existing biomes (Plains, Forest, Ocean, Mountains) should still appear in roughly the same places they did before — the matrix-replacement boxes preserve coverage.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/chunk.ts
git commit -m "refactor(08): chunk loop uses new classifyBiome signature"
```

---

## Task 11 — Add cave-biome floor painting in `chunk.ts`

**Files:**
- Modify: `08-spline-terrain/src/chunk.ts`

- [ ] **Step 1: Update imports**

At the top of `08-spline-terrain/src/chunk.ts`, extend the existing biomes import to include the cave-biome bits, and add the cave-picker import. Find the import line that says `createBiomeSampler, BIOME_DEFS, Biome, classifyBiome, …`. Update it to:

```ts
import {
  createBiomeSampler, BIOME_DEFS, Biome, classifyBiome, computeBlendedGrassColors,
  CAVE_BIOME_DEFS, type CaveBiomeId,
} from "./biomes";
import { pickBiome, type ClimatePoint, CAVE_REGISTRY } from "./biomeBoxes";
```

(Match the existing import style; don't duplicate symbols already imported.)

- [ ] **Step 2: Capture climate per column for cave-picker reuse**

The cave loop runs voxel-by-voxel after the column loop has already sampled climate per column. To avoid re-sampling, allocate a per-column climate cache. After the line `const biomes  = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);` (around line 80), add:

```ts
  const colTemp     = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colHumid    = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colContinent= new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colErosion  = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colPV       = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
```

Then inside the column loop (around lines 82–96), after computing `sample` and `temp`/`humid`, store them:

```ts
      colTemp[idx]      = temp;
      colHumid[idx]     = humid;
      colContinent[idx] = sample.continentalness;
      colErosion[idx]   = sample.erosion;
      colPV[idx]        = sample.peaksValleys;
```

- [ ] **Step 3: Paint cave floors during cave carving**

In the cave-carve block (currently around lines 247–256), the carve looks like:

```ts
          if (carve) block = Block.Air;
```

Replace that line with a block that, when carving, also classifies the cave biome and overwrites the cell-below if it's solid:

```ts
          if (carve) {
            block = Block.Air;
            // Paint cave-biome floor: when this newly-air cell sits
            // directly above a solid cell within the same chunk, classify
            // the cave biome and overwrite that solid cell with the
            // biome's floorBlock. (Cross-chunk floors at ly=0 are skipped
            // — minor cosmetic seam, acceptable for this spec.)
            if (ly > 0) {
              const belowIdx = chunkIndex(lx, ly - 1, lz);
              const below = data[belowIdx];
              if (below !== Block.Air && below !== Block.Water) {
                const point: ClimatePoint = {
                  temperature:  colTemp[colIdx],
                  humidity:     colHumid[colIdx],
                  continent:    colContinent[colIdx],
                  erosion:      colErosion[colIdx],
                  peaksValleys: colPV[colIdx],
                  depthBlocks:  surfaceH - wy,
                };
                const caveId: CaveBiomeId = pickBiome(point, CAVE_REGISTRY, config.params.biomePicker);
                data[belowIdx] = CAVE_BIOME_DEFS[caveId].floorBlock;
              }
            }
          }
```

- [ ] **Step 4: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke-check at runtime**

`npm run dev` and walk into a cave. With default boxes, only warm + humid columns produce Lush Caves; you may need to find a Forest or Savanna area and dig down. Verify:
- Most cave floors remain Stone (Stone biome wins).
- Cave floors under warm + humid surface columns become Moss.
- No errors in the browser console.

- [ ] **Step 6: Commit**

```bash
git add 08-spline-terrain/src/chunk.ts
git commit -m "feat(08): paint Lush Caves moss floors during cave carve"
```

---

## Task 12 — Extend the ice rule to `FrozenOcean`

**Files:**
- Modify: `08-spline-terrain/src/chunk.ts`

- [ ] **Step 1: Update the ice conditional**

Find the existing ice-on-water block in `chunk.ts` (around lines 219–224):

```ts
        // Ice on water in cold biomes
        if (wy === waterLevel && data[voxIdx] === Block.Water) {
          if (biome === Biome.Tundra || biome === Biome.Taiga) {
            block = Block.Ice;
          }
        }
```

Add `Biome.FrozenOcean` to the OR chain:

```ts
        // Ice on water in cold biomes
        if (wy === waterLevel && data[voxIdx] === Block.Water) {
          if (biome === Biome.Tundra || biome === Biome.Taiga || biome === Biome.FrozenOcean) {
            block = Block.Ice;
          }
        }
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-check at runtime**

`npm run dev`. Find a low-continentalness + cold area (use the existing biome-debug overlay if available, or fly around in spectator). Confirm the topmost water cell in Frozen Ocean columns is Ice rather than Water.

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/chunk.ts
git commit -m "feat(08): freeze surface water in FrozenOcean biome"
```

---

## Task 13 — Remove the old "Biome Thresholds" debug-panel section

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

- [ ] **Step 1: Delete the obsolete section entry**

In `08-spline-terrain/src/debugPanel.ts`, delete the `biome-climate` section (currently lines 139–148):

```ts
  {
    id: "biome-climate", label: "Biome Thresholds", paramsKey: "shape", subKey: "biomeClimate", expanded: false,
    sliders: [
      { key: "oceanContinentalness",  label: "Ocean Cont.",   min: -1,   max: 0,   step: 0.01, decimals: 2 },
      { key: "coastContinentalness",  label: "Coast Cont.",   min: -0.5, max: 0.3, step: 0.01, decimals: 2 },
      { key: "beachBand",             label: "Beach Band",    min: 0,    max: 10,  step: 1,    decimals: 0 },
      { key: "inlandContinentalness", label: "Inland Cont.",  min: 0,    max: 0.8, step: 0.01, decimals: 2 },
      { key: "mountainErosion",       label: "Mountain Ero.", min: -1,   max: 0,   step: 0.01, decimals: 2 },
    ],
  },
```

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "refactor(08): drop obsolete Biome Thresholds debug section"
```

---

## Task 14 — Add the editable axis-weights debug-panel section

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

- [ ] **Step 1: Append the new section to `SECTIONS`**

In `08-spline-terrain/src/debugPanel.ts`, after the deleted `biome-climate` section's location (still inside the `SECTIONS` array, just before the closing `]`), insert:

```ts
  {
    id: "biome-picker", label: "Biome Picker", paramsKey: "biomePicker", expanded: false,
    sliders: [
      { key: "depthScale", label: "Depth Scale", min: 8, max: 256, step: 1, decimals: 0 },
    ],
    subSections: [
      { id: "biome-picker-weights", label: "Axis Weights", paramsKey: "biomePicker", subKey: "weights",
        sliders: [
          { key: "temperature",  label: "Temperature",   min: 0, max: 4, step: 0.05, decimals: 2 },
          { key: "humidity",     label: "Humidity",      min: 0, max: 4, step: 0.05, decimals: 2 },
          { key: "continent",    label: "Continent",     min: 0, max: 4, step: 0.05, decimals: 2 },
          { key: "erosion",      label: "Erosion",       min: 0, max: 4, step: 0.05, decimals: 2 },
          { key: "peaksValleys", label: "Peaks/Valleys", min: 0, max: 4, step: 0.05, decimals: 2 },
          { key: "depth",        label: "Depth",         min: 0, max: 4, step: 0.05, decimals: 2 },
        ],
      },
    ],
  },
```

If the existing section type doesn't support `subSections`, fall back to two top-level sections instead — one for `depthScale`, one for `weights`:

```ts
  {
    id: "biome-picker",          label: "Biome Picker · Depth", paramsKey: "biomePicker", expanded: false,
    sliders: [
      { key: "depthScale", label: "Depth Scale", min: 8, max: 256, step: 1, decimals: 0 },
    ],
  },
  {
    id: "biome-picker-weights",  label: "Biome Picker · Weights", paramsKey: "biomePicker", subKey: "weights", expanded: false,
    sliders: [
      { key: "temperature",  label: "Temperature",   min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "humidity",     label: "Humidity",      min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "continent",    label: "Continent",     min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "erosion",      label: "Erosion",       min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "peaksValleys", label: "Peaks/Valleys", min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "depth",        label: "Depth",         min: 0, max: 4, step: 0.05, decimals: 2 },
    ],
  },
```

Choose whichever variant fits the section-type definition currently in use. (The fallback is the safe path — it matches the pattern already used by `climate-cont`, `climate-ero`, and `biome-climate`.)

- [ ] **Step 2: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-check at runtime**

`npm run dev`. Open the debug panel; confirm the new section(s) appear. Pull `continent` weight to 0 and observe biome boundaries shift dramatically (continent stops mattering); pull it back to 1.5 and they snap back.

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): editable axis weights + depth scale in debug panel"
```

---

## Task 15 — Add the read-only biome-box inspector

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

- [ ] **Step 1: Locate the panel-rendering function**

Find the function in `debugPanel.ts` that renders the panel DOM (search for where `SECTIONS` is iterated to render the existing slider rows). The inspector is a sibling block — it does not use the existing slider-section type because it has no inputs. Read enough of the surrounding code to identify the DOM-construction style (template strings vs. createElement calls) before writing the inspector.

- [ ] **Step 2: Add an import for the registries**

At the top of `debugPanel.ts`, add:

```ts
import { SURFACE_REGISTRY, CAVE_REGISTRY, type BiomeBox, type BiomeBoxEntry } from "./biomeBoxes";
import { BIOME_DEFS, CAVE_BIOME_DEFS } from "./biomes";
```

- [ ] **Step 3: Add a `renderBiomeBoxInspector` helper**

Append a helper near the other top-level functions in `debugPanel.ts`:

```ts
function renderBiomeBoxInspector(parent: HTMLElement): void {
  const container = document.createElement("details");
  container.className = "panel-section";
  const summary = document.createElement("summary");
  summary.textContent = "Biome Boxes (read-only)";
  container.appendChild(summary);

  const renderRow = (name: string, box: BiomeBox) => {
    const row = document.createElement("details");
    row.className = "biome-box-row";
    const sum = document.createElement("summary");
    sum.textContent = name;
    row.appendChild(sum);
    const list = document.createElement("ul");
    const fmt = (r: [number, number]) => `[${r[0].toFixed(2)}, ${r[1].toFixed(2)}]`;
    const axes: Array<[string, [number, number]]> = [
      ["temperature",  box.temperature],
      ["humidity",     box.humidity],
      ["continent",    box.continent],
      ["erosion",      box.erosion],
      ["peaksValleys", box.peaksValleys],
      ["depth",        box.depth],
    ];
    for (const [name, range] of axes) {
      const li = document.createElement("li");
      li.textContent = `${name.padEnd(13)} ${fmt(range)}`;
      list.appendChild(li);
    }
    row.appendChild(list);
    return row;
  };

  const surfaceHeader = document.createElement("h4");
  surfaceHeader.textContent = "Surface biomes";
  container.appendChild(surfaceHeader);
  for (const entry of SURFACE_REGISTRY) {
    container.appendChild(renderRow(BIOME_DEFS[entry.id].name, entry.box));
  }

  const caveHeader = document.createElement("h4");
  caveHeader.textContent = "Cave biomes";
  container.appendChild(caveHeader);
  for (const entry of CAVE_REGISTRY) {
    container.appendChild(renderRow(CAVE_BIOME_DEFS[entry.id].name, entry.box));
  }

  parent.appendChild(container);
}
```

- [ ] **Step 4: Mount the inspector**

In the panel-rendering function, after the loop that mounts `SECTIONS`, call:

```ts
renderBiomeBoxInspector(panelEl);   // panelEl = whatever local variable holds the panel root
```

(Use the actual panel-root variable name from the existing rendering code.)

- [ ] **Step 5: Verify build**

Run from `08-spline-terrain/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Smoke-check at runtime**

`npm run dev`. Open the debug panel; expand "Biome Boxes (read-only)". Confirm 13 surface biomes and 2 cave biomes are listed; expand one and verify all six axes display with their default ranges.

- [ ] **Step 7: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): read-only biome-box inspector in debug panel"
```

---

## Task 16 — End-to-end manual verification and tuning

**Files:**
- Modify (if tuning required): `08-spline-terrain/src/biomeBoxes.ts`

- [ ] **Step 1: Walk the four new biomes**

`npm run dev`. With the default seed, fly/walk to find each new biome and confirm it renders sensibly:

- **Frozen Ocean** — find a cold, low-continentalness area. Surface water cells should be Ice. Climate-debug overlay (if present) should report `FrozenOcean`.
- **Stony Peaks** — find a high-continentalness, low-erosion, high-peaks area (interior of a mountain range, near peaks). Surface should be Stone, no decorations.
- **Windswept Hills** — find a mid-erosion inland area. Should be a grass/dirt biome with scattered ferns and tall grass, sparser tree density than Forest.
- **Lush Caves** — dig down beneath a Forest or Savanna area. The cave floor should be Moss instead of Stone. (If you can't find Lush Caves at all, the surface temperature/humidity may need adjustment in the cave registry — see Step 3.)

- [ ] **Step 2: Confirm regression on existing biomes**

Walk through Plains, Forest, Birch Forest, Taiga, Tundra, Desert, Savanna, Mountains, Beach, Ocean. Each should appear in approximately the same places it did before this change. There should be no patches of obviously-wrong biome (e.g., desert in cold areas, tundra at low elevation in warm areas).

- [ ] **Step 3: Tune box ranges if needed**

If a new biome is too rare, too common, or bleeding into a neighbour, edit the relevant box in `08-spline-terrain/src/biomeBoxes.ts` and reload. Common adjustments:

- Frozen Ocean too rare → loosen `temperature` upper bound to `-0.2` (was `-0.3`).
- Stony Peaks never appears → loosen `peaksValleys` lower bound to `0.2` or `0.0`.
- Windswept Hills overlaps Mountains too much → tighten `erosion` to `[-0.5, -0.2]` so the bands separate.
- Lush Caves never appears → loosen surface `humidity` lower bound to `0.0`, or look in a different climate region.

Each tweak is a separate commit:

```bash
git add 08-spline-terrain/src/biomeBoxes.ts
git commit -m "tune(08): widen FrozenOcean temperature band"
```

- [ ] **Step 4: Final build check**

Run from `08-spline-terrain/`: `npm run build`
Expected: clean build with no errors.

- [ ] **Step 5: Final commit (if any uncommitted tuning)**

If anything is still uncommitted, commit it now with a descriptive message.

---

## Done checklist

After Task 16, the following should all be true:

- `pickTempHumidBiome` and `BiomeClimateThresholds` are deleted; `git grep` returns no matches.
- `Biome` enum contains 13 entries (Ocean … FrozenOcean); `CaveBiome` contains 2 (Stone, LushCaves).
- `Block.Moss` exists; cave floors in warm + humid surface areas are Moss.
- `Block.Ice` appears on the topmost water cell of FrozenOcean columns.
- The debug panel has an editable "Biome Picker" section (axis weights + depth scale) and a read-only "Biome Boxes" inspector listing 13 + 2 entries.
- `npm run build` exits cleanly.
- The world renders without console errors.

## Notes for the implementer

- This codebase has no test framework; verification is `tsc --noEmit`, `npm run build`, and in-browser inspection. Don't try to add a test framework as part of this work.
- Project 08 already samples `peaksValleys` in `terrainShape.sampleClimate` — confirm with `grep -n peaksValleys 08-spline-terrain/src/terrainShape.ts` before Task 10 if you want belt-and-braces.
- Cave-floor painting uses cell-below-in-same-chunk only. Cross-chunk seams (cave floor at chunk Y=0) are skipped on purpose; a one-block visual seam is acceptable for this spec.
- If the debug panel's section-type definition does not support `subSections` (Task 14, Step 1), use the two-top-level-sections fallback. Don't extend the section-type definition just for this — it's out of scope.
- Box numeric values are tunable; the spec freezes structure (which axes each biome cares about), not exact numbers. Tuning happens in Task 16.
