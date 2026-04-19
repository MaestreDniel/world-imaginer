# Spline-Based Terrain Shaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace project 07's biome-driven column heights with a climate-driven, anchor-blended spline pipeline (continentalness → erosion → peaks & valleys) in a new project `08-spline-terrain/`, with runtime-editable spline tables in the debug panel.

**Architecture:** A new `terrainShape.heightAt(wx, wz)` sits between the chunk loop and the old per-biome height formula. It samples three low-frequency climate noise fields, runs a nested pair of anchor-blended spline lookups (erosion sub-splines anchored on continentalness; PV sub-splines anchored on erosion), and returns a clamped final height. Biomes lose their `heightScale` / `heightOffset` fields; the biome picker becomes climate-aware, with explicit overrides for Ocean, Beach, and Mountains driven by continentalness and erosion. World Y-extent becomes parametric (`minHeight` / `maxHeight`), and the chunk Y-range in `world.ts` derives from those params.

**Tech Stack:** TypeScript, Three.js, Vite. Project: `08-spline-terrain` (copied from `07-advanced-terrain`). No test framework — verification is `npm run build` (type-check) and `npm run dev` (visual).

**Spec:** [`docs/superpowers/specs/2026-04-19-spline-terrain-shaping-design.md`](../specs/2026-04-19-spline-terrain-shaping-design.md)

---

## File map

- **Create** directory `08-spline-terrain/` (copy of `07-advanced-terrain/`).
- **Create** `08-spline-terrain/src/splines.ts` — `SplinePoint`, `Spline`, `AnchoredSpline`, `TerrainShape` types; `evalSpline`, `evalAnchored`; default table.
- **Create** `08-spline-terrain/src/climate.ts` — three climate noise samplers (continentalness, erosion, peaks & valleys) bundled behind one factory.
- **Create** `08-spline-terrain/src/terrainShape.ts` — `createTerrainShaper(seed, params)` returning `heightAt(wx, wz)`.
- **Modify** `08-spline-terrain/src/generationParams.ts` — add `ClimateParams`, `TerrainShapeParams`, `BiomeClimateThresholds`, `WorldExtentParams`; remove `TerrainParams` (the old `terrain` group); update `DEFAULT_PARAMS`; update `cloneParams` (it already works on any plain object).
- **Modify** `08-spline-terrain/src/biomes.ts` — remove `heightScale` / `heightOffset` from `BiomeDef`; remove the old continent Voronoi from `createBiomeSampler`; expose a new `classifyBiome(continentalness, erosion, temp, humid, height, waterLevel, thresholds)`; simplify `computeBlendedBiomeParams` to blend grass colors only (drop `blendedScales` / `blendedOffsets`).
- **Modify** `08-spline-terrain/src/chunk.ts` — call `terrainShape.heightAt` for column heights, call new biome classifier with climate values, replace hardcoded `BEDROCK_BOTTOM`, remove reads of `config.params.terrain.*` and `BIOME_DEFS[...].heightScale/Offset`.
- **Modify** `08-spline-terrain/src/world.ts` — derive `minCY` / `maxCY` from `params.extent`.
- **Modify** `08-spline-terrain/src/debugPanel.ts` — drop obsolete `terrain` and `biomes` sections and their presets, add `World extent`, `Climate`, and `Splines` sections; keep preset save/load working with the new schema.
- **Modify** root `docker-compose.yml` — add `spline-terrain` service on port 5181.

All work after Task 1 happens inside `08-spline-terrain/`. Run commands from inside that directory unless stated otherwise.

---

## Task 1 — Scaffold `08-spline-terrain`

Creates the new project as a verbatim copy of 07 and wires it into Docker. After this task the 08 project runs identically to 07 (same generation output).

**Files:**
- Create: `08-spline-terrain/` (copy of `07-advanced-terrain/`)
- Modify: `08-spline-terrain/package.json`
- Modify: `08-spline-terrain/Dockerfile` (port)
- Modify: `docker-compose.yml`
- Create: `08-spline-terrain/README.md` (optional)

- [ ] **Step 1: Copy the 07 directory tree**

From repo root:

```bash
cp -r 07-advanced-terrain 08-spline-terrain
rm -rf 08-spline-terrain/node_modules 08-spline-terrain/dist
```

- [ ] **Step 2: Rename in `package.json`**

Replace the `name` field in `08-spline-terrain/package.json`:

```json
"name": "08-spline-terrain",
```

- [ ] **Step 3: Check the Vite dev port**

Open `08-spline-terrain/vite.config.ts` (or `package.json` scripts) and the `Dockerfile`. 07 runs on 5180 — make 08 run on 5181. Update any hardcoded `5180` to `5181` in:
- `08-spline-terrain/vite.config.ts` (if present)
- `08-spline-terrain/Dockerfile` (EXPOSE and/or CMD host/port)

If those files don't hardcode the port, skip. Confirm with:

```bash
grep -rn 5180 08-spline-terrain/
```

Expected: no matches (after edits), or no matches at all if 07 never hardcoded the port.

- [ ] **Step 4: Add a Docker service**

Append to `docker-compose.yml` after the `advanced-terrain` service and before the `networks:` block:

```yaml
  spline-terrain:
    build:
      context: ./08-spline-terrain
    container_name: spline_terrain
    ports:
      - "5181:5181"
    volumes:
      - ./08-spline-terrain:/app
      - spline_terrain_modules:/app/node_modules
    networks:
      - app-network
```

Add the volume to the `volumes:` list at the bottom of the file:

```yaml
  spline_terrain_modules:
```

- [ ] **Step 5: Verify the project builds and runs**

```bash
cd 08-spline-terrain
npm install
npm run build
```

Expected: `tsc` passes with 0 errors, Vite build completes.

```bash
npm run dev
```

Expected: dev server starts on the configured port and the world renders identically to project 07.

- [ ] **Step 6: Commit**

From repo root:

```bash
git add 08-spline-terrain docker-compose.yml
git commit -m "feat(08): scaffold spline-terrain project from 07"
```

---

## Task 2 — Splines module

Adds the pure spline data structures and evaluator. Self-contained: no imports from other project files. Default `TerrainShape` lives here so later tasks can reference it by name.

**Files:**
- Create: `08-spline-terrain/src/splines.ts`

- [ ] **Step 1: Create the file**

Create `08-spline-terrain/src/splines.ts`:

```ts
// Piecewise-linear splines with anchor blending for terrain shaping.

export interface SplinePoint { x: number; y: number; }

/** Control points sorted by x, length >= 2. */
export type Spline = SplinePoint[];

/** A sub-spline anchored at a 1D key value (e.g. a continentalness band). */
export interface AnchoredSpline {
  anchor: number;
  spline: Spline;
}

export interface TerrainShape {
  /** continentalness ∈ [-1,1] → base height. */
  continent: Spline;
  /** Erosion sub-splines anchored at continentalness values, sorted by anchor. */
  erosionByContinent: AnchoredSpline[];
  /** Peaks & valleys sub-splines anchored at erosion values, sorted by anchor. */
  pvByErosion: AnchoredSpline[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear evaluation. Clamps to endpoints outside [x0, xN]. */
export function evalSpline(s: Spline, x: number): number {
  const n = s.length;
  if (x <= s[0].x) return s[0].y;
  if (x >= s[n - 1].x) return s[n - 1].y;

  // Binary search for segment [i, i+1] with s[i].x <= x < s[i+1].x.
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (s[mid].x <= x) lo = mid; else hi = mid;
  }
  const a = s[lo], b = s[hi];
  const t = (x - a.x) / (b.x - a.x);
  return lerp(a.y, b.y, t);
}

/**
 * Evaluate an anchored list by blending the two sub-splines bracketing `key`.
 * Clamps to first / last anchor outside the anchored range.
 */
export function evalAnchored(list: AnchoredSpline[], key: number, innerX: number): number {
  const n = list.length;
  if (n === 0) return 0;
  if (key <= list[0].anchor) return evalSpline(list[0].spline, innerX);
  if (key >= list[n - 1].anchor) return evalSpline(list[n - 1].spline, innerX);

  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].anchor <= key) lo = mid; else hi = mid;
  }
  const a = list[lo], b = list[hi];
  const t = (key - a.anchor) / (b.anchor - a.anchor);
  return lerp(evalSpline(a.spline, innerX), evalSpline(b.spline, innerX), t);
}

/** Default shape. Intended as a starting point users can tweak at runtime. */
export const DEFAULT_TERRAIN_SHAPE: TerrainShape = {
  continent: [
    { x: -1.0, y: -40 },
    { x: -0.3, y: -15 },
    { x: -0.2, y:   5 },
    { x:  0.3, y:  40 },
    { x:  0.4, y:  90 },
    { x:  1.0, y: 100 },
  ],
  erosionByContinent: [
    { anchor: -0.2, spline: [{ x: -1, y:  2 }, { x: 0, y: 0 }, { x: 1, y:  -1 }] },
    { anchor:  0.4, spline: [{ x: -1, y: 40 }, { x: 0, y: 0 }, { x: 1, y: -10 }] },
  ],
  pvByErosion: [
    { anchor: -0.5, spline: [{ x: -1, y: -10 }, { x: 0, y: 0 }, { x: 1, y: 15 }] },
    { anchor:  0.5, spline: [{ x: -1, y:  -2 }, { x: 0, y: 0 }, { x: 1, y:  3 }] },
  ],
};
```

- [ ] **Step 2: Type-check the module**

```bash
cd 08-spline-terrain
npm run build
```

Expected: 0 TS errors. The new file compiles even though nothing imports it yet.

- [ ] **Step 3: Quick runtime sanity check**

Temporarily add this block at the bottom of `splines.ts`, run the dev server once, confirm the numbers, then delete the block.

```ts
// TEMP sanity checks — remove after verification
const _s: Spline = [{ x: 0, y: 0 }, { x: 1, y: 10 }];
console.assert(evalSpline(_s, -1) === 0,  "clamp left");
console.assert(evalSpline(_s,  2) === 10, "clamp right");
console.assert(evalSpline(_s, 0.5) === 5, "midpoint");

const _a: AnchoredSpline[] = [
  { anchor: 0,  spline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
  { anchor: 1,  spline: [{ x: 0, y: 10 }, { x: 1, y: 10 }] },
];
console.assert(evalAnchored(_a, 0.5, 0.5) === 5, "anchor midpoint");
```

Run:

```bash
npm run dev
```

Open the browser console. Expected: no assertion failures.

Remove the `TEMP sanity checks` block.

- [ ] **Step 4: Re-build**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/splines.ts
git commit -m "feat(08): add spline data structures and evaluator"
```

---

## Task 3 — Climate noise module

Adds three climate noise samplers bundled behind one factory. Self-contained; depends only on `perlin.ts` (already copied from 07).

**Files:**
- Create: `08-spline-terrain/src/climate.ts`

- [ ] **Step 1: Create the file**

Create `08-spline-terrain/src/climate.ts`:

```ts
import { createNoise } from "./perlin";

/** Per-field fBm config. */
export interface ClimateFieldParams {
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
}

export interface ClimateParams {
  continentalness: ClimateFieldParams;
  erosion: ClimateFieldParams;
  peaksValleys: ClimateFieldParams;
}

export const DEFAULT_CLIMATE: ClimateParams = {
  continentalness: { scale: 1500, octaves: 3, persistence: 0.5, lacunarity: 2.0 },
  erosion:         { scale:  600, octaves: 3, persistence: 0.5, lacunarity: 2.0 },
  peaksValleys:    { scale:  180, octaves: 4, persistence: 0.5, lacunarity: 2.0 },
};

export interface ClimateSample {
  continentalness: number;  // ~[-1, 1]
  erosion: number;          // ~[-1, 1]
  peaksValleys: number;     // ~[-1, 1]
}

export function createClimateSampler(seed: number, params: ClimateParams) {
  const contNoise = createNoise(seed + 20);
  const eroNoise  = createNoise(seed + 21);
  const pvNoise   = createNoise(seed + 22);

  return function sample(wx: number, wz: number): ClimateSample {
    const c = params.continentalness;
    const e = params.erosion;
    const p = params.peaksValleys;
    return {
      continentalness: contNoise.fbm2D(wx / c.scale, wz / c.scale, c.octaves, c.persistence, c.lacunarity),
      erosion:         eroNoise.fbm2D (wx / e.scale, wz / e.scale, e.octaves, e.persistence, e.lacunarity),
      peaksValleys:    pvNoise.fbm2D  (wx / p.scale, wz / p.scale, p.octaves, p.persistence, p.lacunarity),
    };
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/climate.ts
git commit -m "feat(08): add climate noise sampler (continentalness, erosion, pv)"
```

---

## Task 4 — Extend `generationParams.ts`

Adds the new param groups (`climate`, `shape`, `biomeClimate`, `extent`) alongside existing ones. Does *not* remove the old `terrain` group yet — that waits until Task 6 so the codebase stays compilable throughout.

**Files:**
- Modify: `08-spline-terrain/src/generationParams.ts`

- [ ] **Step 1: Add imports**

At the top of `08-spline-terrain/src/generationParams.ts`, under the existing `import`:

```ts
import { type ClimateParams, DEFAULT_CLIMATE } from "./climate";
import { type TerrainShape, DEFAULT_TERRAIN_SHAPE } from "./splines";
```

- [ ] **Step 2: Add new interfaces**

Append before `export interface GenerationParams`:

```ts
export interface BiomeClimateThresholds {
  /** continentalness below this → Ocean. */
  oceanContinentalness: number;
  /** continentalness below this (plus near water) → Beach. */
  coastContinentalness: number;
  /** Height above waterLevel within which a low-continentalness column becomes Beach. */
  beachBand: number;
  /** continentalness above this → eligible for Mountains (combined with low erosion). */
  inlandContinentalness: number;
  /** Erosion below this (on inland columns) → Mountains. */
  mountainErosion: number;
}

export interface WorldExtentParams {
  minHeight: number;
  maxHeight: number;
}

export interface TerrainShapeParams {
  shape: TerrainShape;
  biomeClimate: BiomeClimateThresholds;
}
```

- [ ] **Step 3: Extend `GenerationParams`**

Replace the existing `GenerationParams` interface with:

```ts
export interface GenerationParams {
  terrain: TerrainParams;
  climate: ClimateParams;
  shape: TerrainShapeParams;
  extent: WorldExtentParams;
  erosion: ErosionParams;
  caves: CaveParams;
  aquifers: AquiferParams;
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
  vegetation: VegetationParams;
}
```

(`terrain` and `biomes` stay for now to keep the codebase compiling; they are removed in Task 6.)

- [ ] **Step 4: Extend `DEFAULT_PARAMS`**

Inside the `DEFAULT_PARAMS` object literal, add these entries next to the existing ones:

```ts
  climate: DEFAULT_CLIMATE,
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
  extent: {
    minHeight: -48,
    maxHeight: 120,
  },
```

- [ ] **Step 5: Type-check**

```bash
npm run build
```

Expected: 0 errors. (Consumers of `GenerationParams` don't read the new fields yet, so nothing else needs to change.)

- [ ] **Step 6: Commit**

```bash
git add 08-spline-terrain/src/generationParams.ts
git commit -m "feat(08): extend GenerationParams with climate, shape, extent"
```

---

## Task 5 — Terrain shaper module

Adds `createTerrainShaper(seed, params)` that returns a `heightAt(wx, wz)` closure. Combines the climate sampler and spline evaluator with final-height clamping. Self-contained — not yet called by `chunk.ts`.

**Files:**
- Create: `08-spline-terrain/src/terrainShape.ts`

- [ ] **Step 1: Create the file**

Create `08-spline-terrain/src/terrainShape.ts`:

```ts
import { createClimateSampler, type ClimateSample } from "./climate";
import { evalSpline, evalAnchored, type TerrainShape } from "./splines";
import type { GenerationParams } from "./generationParams";

export interface TerrainShaper {
  heightAt(wx: number, wz: number): number;
  /** Exposed so the chunk loop can call the biome classifier with the same sample. */
  sampleClimate(wx: number, wz: number): ClimateSample;
}

export function createTerrainShaper(seed: number, params: GenerationParams): TerrainShaper {
  const sampleClimate = createClimateSampler(seed, params.climate);
  const shape: TerrainShape = params.shape.shape;
  const { minHeight, maxHeight } = params.extent;

  function heightAt(wx: number, wz: number): number {
    const { continentalness, erosion, peaksValleys } = sampleClimate(wx, wz);
    const base    = evalSpline(shape.continent, continentalness);
    const eroAdj  = evalAnchored(shape.erosionByContinent, continentalness, erosion);
    const pvAdj   = evalAnchored(shape.pvByErosion, erosion, peaksValleys);
    const h = base + eroAdj + pvAdj;
    return h < minHeight ? minHeight : h > maxHeight ? maxHeight : h;
  }

  return { heightAt, sampleClimate };
}
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/terrainShape.ts
git commit -m "feat(08): add terrain shaper combining climate and splines"
```

---

## Task 6 — Switchover: chunk.ts and biomes.ts use the new pipeline

The atomic cut. Changes `biomes.ts` and `chunk.ts` together so the old `BiomeDef.heightScale / heightOffset` fields, the old `createBiomeSampler` continent Voronoi, and the old `terrain`-based height formula all disappear in a single commit. Leaves `generationParams.ts` with the `terrain` group still present (removed in Task 7) so this commit stays focused.

**Files:**
- Modify: `08-spline-terrain/src/biomes.ts`
- Modify: `08-spline-terrain/src/chunk.ts`

### Part A — `biomes.ts`

- [ ] **Step 1: Remove height fields from `BiomeDef`**

In `biomes.ts`, delete these two lines inside `BiomeDef`:

```ts
  heightScale: number;
  heightOffset: number;
```

- [ ] **Step 2: Remove height fields from every `BIOME_DEFS` entry**

For each entry in `BIOME_DEFS` (`Ocean`, `Beach`, `Desert`, `Savanna`, `Plains`, `Forest`, `BirchForest`, `Taiga`, `Tundra`, `Mountains`), delete the two lines:

```ts
    heightScale: <number>,
    heightOffset: <number>,
```

- [ ] **Step 3: Replace `createBiomeSampler` and add `classifyBiome`**

Replace the existing `createBiomeSampler` function (and the `biomeFromNoise` helper inside it) with:

```ts
export function createBiomeSampler(seed: number, biomeParams: BiomeParams = DEFAULT_PARAMS.biomes) {
  const tempNoise  = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);

  return function sampleTempHumid(wx: number, wz: number): { temp: number; humid: number } {
    const s = biomeParams.tempHumidityScale;
    return {
      temp:  tempNoise.fbm2D(wx / s, wz / s, 4, 0.5, 2.0),
      humid: humidNoise.fbm2D(wx / s, wz / s, 4, 0.5, 2.0),
    };
  };
}

function pickTempHumidBiome(temp: number, humid: number): BiomeId {
  if (temp > 0.2) {
    return humid > 0.15 ? Biome.Savanna : Biome.Desert;
  } else if (temp > -0.15) {
    if (humid > 0.2) return Biome.Forest;
    if (humid > -0.1) return Biome.BirchForest;
    return Biome.Plains;
  } else {
    return humid > 0.05 ? Biome.Taiga : Biome.Tundra;
  }
}

/**
 * Pick a biome using climate noise + the resulting height. Climate-field
 * overrides for Ocean / Beach / Mountains short-circuit; otherwise the
 * existing (temp, humid) matrix applies.
 */
export function classifyBiome(
  continentalness: number,
  erosion: number,
  temp: number,
  humid: number,
  height: number,
  waterLevel: number,
  t: { oceanContinentalness: number; coastContinentalness: number; beachBand: number; inlandContinentalness: number; mountainErosion: number },
): BiomeId {
  if (continentalness < t.oceanContinentalness) return Biome.Ocean;
  if (continentalness < t.coastContinentalness && height < waterLevel + t.beachBand) return Biome.Beach;
  if (continentalness > t.inlandContinentalness && erosion < t.mountainErosion) return Biome.Mountains;
  return pickTempHumidBiome(temp, humid);
}
```

- [ ] **Step 4: Simplify `computeBlendedBiomeParams`**

Replace the whole function (and the `BLEND_RADIUS` / `BIOME_COUNT` block above it if they are only used here — keep `BLEND_RADIUS` exported, it may be referenced elsewhere; check with `grep -n BLEND_RADIUS 08-spline-terrain/src/`).

```ts
export const BLEND_RADIUS = 4;

const BIOME_COUNT = Object.keys(Biome).length;

/**
 * Blended grass colors + dominant biome per column. Height is no longer
 * biome-driven, so only grass-color blending remains.
 */
export function computeBlendedGrassColors(
  worldXOff: number,
  worldZOff: number,
  chunkSize: number,
  getTempHumid: (wx: number, wz: number) => { temp: number; humid: number },
  getDominantBiome: (lx: number, lz: number) => BiomeId,
): {
  dominantBiomes: Uint8Array;
  grassColors: Uint32Array;
} {
  const padSize = chunkSize + 2 * BLEND_RADIUS;
  const paddedTemp  = new Float32Array(padSize * padSize);
  const paddedHumid = new Float32Array(padSize * padSize);

  for (let pz = 0; pz < padSize; pz++) {
    for (let px = 0; px < padSize; px++) {
      const { temp, humid } = getTempHumid(
        worldXOff - BLEND_RADIUS + px,
        worldZOff - BLEND_RADIUS + pz,
      );
      const idx = pz * padSize + px;
      paddedTemp[idx]  = temp;
      paddedHumid[idx] = humid;
    }
  }

  const kernelSize = 2 * BLEND_RADIUS + 1;
  const kernelArea = kernelSize * kernelSize;
  const dominantBiomes = new Uint8Array(chunkSize * chunkSize);
  const grassColors    = new Uint32Array(chunkSize * chunkSize);

  for (let lz = 0; lz < chunkSize; lz++) {
    for (let lx = 0; lx < chunkSize; lx++) {
      let totalR = 0, totalG = 0, totalB = 0;
      for (let kz = 0; kz < kernelSize; kz++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const pIdx = (lz + kz) * padSize + (lx + kx);
          const gc = grassColorFromClimate(paddedTemp[pIdx], paddedHumid[pIdx]);
          totalR += (gc >> 16) & 0xFF;
          totalG += (gc >>  8) & 0xFF;
          totalB +=  gc        & 0xFF;
        }
      }
      const idx = lz * chunkSize + lx;
      const avgR = Math.round(totalR / kernelArea);
      const avgG = Math.round(totalG / kernelArea);
      const avgB = Math.round(totalB / kernelArea);
      grassColors[idx] = (avgR << 16) | (avgG << 8) | avgB;
      dominantBiomes[idx] = getDominantBiome(lx, lz);
    }
  }

  void BIOME_COUNT; // silence unused warning if applicable
  return { dominantBiomes, grassColors };
}
```

- [ ] **Step 5: Remove `BIOME_GRASS_COLORS`**

It is no longer used (grass colors are computed from the per-column (temp, humid) average now). Delete the whole `BIOME_GRASS_COLORS` `Record<number, number>` object. Confirm no other file imports it:

```bash
grep -rn BIOME_GRASS_COLORS 08-spline-terrain/src/
```

Expected: no matches (after the delete).

### Part B — `chunk.ts`

- [ ] **Step 6: Update imports**

In `08-spline-terrain/src/chunk.ts`, replace the `biomes` import with:

```ts
import {
  createBiomeSampler, BIOME_DEFS, Biome, classifyBiome, computeBlendedGrassColors,
} from "./biomes";
```

Add new imports:

```ts
import { createTerrainShaper } from "./terrainShape";
```

- [ ] **Step 7: Replace the column-height block**

Find the block from `// Biome blending: compute averaged heightScale/heightOffset...` through the end of the surface-profile loop (ends at the `heights[idx] = ...` line). Replace it with:

```ts
  // Climate + spline pipeline replaces biome-driven heights.
  const terrainShaper = createTerrainShaper(seed, config.params);
  const tempHumidSampler = createBiomeSampler(seed, config.params.biomes);

  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
  const biomes  = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const idx = lz * CHUNK_SIZE + lx;
      const h = terrainShaper.heightAt(wx, wz);
      heights[idx] = h;

      const { continentalness, erosion } = terrainShaper.sampleClimate(wx, wz);
      const { temp, humid } = tempHumidSampler(wx, wz);
      biomes[idx] = classifyBiome(
        continentalness, erosion, temp, humid,
        h, waterLevel, config.params.shape.biomeClimate,
      );
    }
  }

  const { grassColors } = computeBlendedGrassColors(
    worldXOff, worldZOff, CHUNK_SIZE,
    tempHumidSampler,
    (lx, lz) => biomes[lz * CHUNK_SIZE + lx],
  );
```

Delete the old `computeBlendedBiomeParams` call, the `dominantBiomes`/`blendedScales`/`blendedOffsets` destructuring, the `baseNoise = noise.warpedFbm2D(...)` block, and the old biome-driven height formula.

- [ ] **Step 8: Update the erosion-pass margin recompute**

Inside the `config.params.erosion.enabled` block, find the `else` branch that recomputes margin heights:

```ts
          // Recompute for margin cells
          const marginBiome = getBiome(wx, wz);
          const marginDef = BIOME_DEFS[marginBiome];
          const marginNoise = noise.warpedFbm2D(...);
          paddedMap[pz * padSize + px] = baseHeight + marginDef.heightOffset
            + marginNoise * terrain.heightMultiplier * marginDef.heightScale;
```

Replace with:

```ts
          paddedMap[pz * padSize + px] = terrainShaper.heightAt(wx, wz);
```

Also delete the `const getBiome = ...` line at the top of `generateChunk` — `biomes[]` is now populated by the new loop above, not by a separate sampler. Remove references to `getBiome` everywhere inside the function.

- [ ] **Step 9: Remove the `terrain` destructure**

Delete this line near the top of `generateChunk`:

```ts
  const { terrain } = config.params;
```

Keep `const noise = createNoise(seed);` — it is still used later for layer-variation (`noise.fbm2D(wx / 40, wz / 40, 3, 0.5, 2.0)` inside the voxel-fill loop) and ocean-floor gravel (`noise.perlin2D(wx / 8, wz / 8)`). Only the `noise.warpedFbm2D` call for the old height formula is gone.

Confirm no remaining references to `terrain.*`:

```bash
grep -n "terrain\." 08-spline-terrain/src/chunk.ts
```

Expected: no hits.

- [ ] **Step 10: Type-check**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 11: Visual sanity check**

```bash
npm run dev
```

Open the browser. Expected: world renders, but looks very different from 07 — continents, mountain bands, and oceans are now driven by the climate noise + default splines. There should be no crashes in the console, no flat white walls at chunk borders, and biomes should still paint grass / sand / snow appropriately.

If ocean floor or mountain peaks are cut off, that's Task 7 (chunk Y-range).

- [ ] **Step 12: Commit**

```bash
git add 08-spline-terrain/src/biomes.ts 08-spline-terrain/src/chunk.ts
git commit -m "feat(08): switchover to climate+spline heights and new biome picker"
```

---

## Task 7 — Parametric world Y-extent

Chunks currently load only `CY -2..+4`. With `maxHeight = 120` some peaks fall outside that range. Makes both the chunk Y-range and the bedrock floor follow `params.extent`.

**Files:**
- Modify: `08-spline-terrain/src/world.ts`
- Modify: `08-spline-terrain/src/chunk.ts`

- [ ] **Step 1: Derive `minCY` / `maxCY` from params**

In `08-spline-terrain/src/world.ts`, inside `update(...)`, replace:

```ts
    const minCY = -2;
    const maxCY = 4;
```

with:

```ts
    const { minHeight, maxHeight } = this.config.params.extent;
    const minCY = Math.floor(minHeight / CHUNK_SIZE) - 1;
    const maxCY = Math.ceil (maxHeight / CHUNK_SIZE) + 1;
```

- [ ] **Step 2: Parametric bedrock in `chunk.ts`**

Find the bedrock-floor block:

```ts
  const BEDROCK_BOTTOM = -32;
```

Replace with:

```ts
  const BEDROCK_BOTTOM = config.params.extent.minHeight;
```

- [ ] **Step 3: Type-check**

```bash
cd 08-spline-terrain
npm run build
```

Expected: 0 errors.

- [ ] **Step 4: Visual check**

```bash
npm run dev
```

Expected: deep-ocean basins render to their floor, mountain peaks render to their tops without getting clipped into empty-chunk sky. Ore/cave distribution still runs normally through the extended depth range. Frame rate may drop a little due to more chunks — note it, don't block on it.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/world.ts 08-spline-terrain/src/chunk.ts
git commit -m "feat(08): parametric world Y-extent and bedrock floor"
```

---

## Task 8 — Remove obsolete `terrain` params and dead presets

Now that nothing reads `config.params.terrain.*` in runtime code, the `terrain` group is dead. Remove it from `generationParams.ts` and drop the `Terrain Noise` section and obsolete presets from `debugPanel.ts`. Also drop the old `biomes` params group if no code still reads it (it was used by the old Voronoi continent sampler — gone after Task 6).

**Files:**
- Modify: `08-spline-terrain/src/generationParams.ts`
- Modify: `08-spline-terrain/src/debugPanel.ts`

- [ ] **Step 1: Audit remaining readers**

```bash
grep -rn "params\.terrain\|DEFAULT_PARAMS\.terrain\|params\.biomes\|DEFAULT_PARAMS\.biomes" 08-spline-terrain/src/
```

Expected hits:
- `debugPanel.ts` references — to be removed in this task.
- `generationParams.ts` own definition — to be removed in this task.
- Any hits in other files (e.g. `biomes.ts`'s `DEFAULT_PARAMS.biomes` default arg on `createBiomeSampler`): leave those — `biomes` is still used for `tempHumidityScale`. Only remove `terrain`.

If the `biomes` param group is still referenced by `createBiomeSampler`, keep it. (The old `continentScale / oceanThreshold / beachThreshold / mountainThreshold` are no longer used, but `tempHumidityScale` still is.)

- [ ] **Step 2: Slim `BiomeParams`**

In `generationParams.ts`, replace:

```ts
export interface BiomeParams {
  tempHumidityScale: number;
  continentScale: number;
  oceanThreshold: number;
  beachThreshold: number;
  mountainThreshold: number;
}
```

with:

```ts
export interface BiomeParams {
  tempHumidityScale: number;
}
```

And in `DEFAULT_PARAMS.biomes`, keep only:

```ts
  biomes: {
    tempHumidityScale: 480,
  },
```

- [ ] **Step 3: Remove the `terrain` group**

In `generationParams.ts`:

- Delete the `TerrainParams` interface.
- Remove `terrain: TerrainParams;` from `GenerationParams`.
- Delete the `terrain: { ... }` entry from `DEFAULT_PARAMS`.

- [ ] **Step 4: Remove the `Terrain Noise` section from the debug panel**

In `08-spline-terrain/src/debugPanel.ts`, delete the `{ id: "terrain", label: "Terrain Noise", ... }` entry from the `SECTIONS` array. Also slim the `biomes` entry to a single slider:

```ts
  {
    id: "biomes", label: "Biomes", paramsKey: "biomes", expanded: false,
    sliders: [
      { key: "tempHumidityScale", label: "Temp/Humidity Scale", min: 100, max: 600, step: 10, decimals: 0 },
    ],
  },
```

- [ ] **Step 5: Drop obsolete built-in presets**

In `BUILT_IN_PRESETS`, delete the `Flat Plains`, `Extreme Mountains`, and `Island Archipelago` entries — they reference the deleted `terrain` and `biomes` fields. Keep `Default` and `Cave Heavy`.

- [ ] **Step 6: Handle stale user presets**

User presets stored in `localStorage` may still carry old `terrain` / extended `biomes` fields. Extend the preset-load path (`loadPreset()` / wherever presets are spread into `DEFAULT_PARAMS`) so missing new fields fall back to `DEFAULT_PARAMS` and unknown old fields are ignored:

```ts
function mergePreset(preset: GenerationParams): GenerationParams {
  return {
    ...cloneParams(DEFAULT_PARAMS),
    ...cloneParams(preset),
    // Explicit merges for new groups in case the stored preset predates them:
    climate: { ...DEFAULT_PARAMS.climate, ...(preset as any).climate },
    shape:   { ...DEFAULT_PARAMS.shape,   ...(preset as any).shape },
    extent:  { ...DEFAULT_PARAMS.extent,  ...(preset as any).extent },
    biomes:  { ...DEFAULT_PARAMS.biomes,  ...(preset as any).biomes },
  };
}
```

Apply `mergePreset(...)` wherever a preset's `params` object flows into `this.params` (look for `this.params = ...` in the preset-load path).

- [ ] **Step 7: Type-check**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 8: Visual check**

```bash
npm run dev
```

Expected: debug panel opens without the `Terrain Noise` section, the `Biomes` section has only one slider, and loading the `Default` or `Cave Heavy` presets works.

- [ ] **Step 9: Commit**

```bash
git add 08-spline-terrain/src/generationParams.ts 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): remove obsolete terrain params and dead presets"
```

---

## Task 9 — Debug panel: World extent and Climate sections

Adds two standard slider sections. No new UI primitives needed — reuses the existing `SECTIONS` slider machinery. Spline tables are a separate custom UI added in Task 10.

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

- [ ] **Step 1: Add `World Extent` section**

In the `SECTIONS` array in `debugPanel.ts`, add near the top (before `caves`):

```ts
  {
    id: "extent", label: "World Extent", paramsKey: "extent", expanded: false,
    sliders: [
      { key: "minHeight", label: "Min Height", min: -128, max:   0, step: 1, decimals: 0 },
      { key: "maxHeight", label: "Max Height", min:    0, max: 256, step: 1, decimals: 0 },
    ],
  },
```

- [ ] **Step 2: Handle the nested `climate` shape**

The current `SECTIONS` model assumes one flat key-value group per section, but `ClimateParams` has three sub-fields (`continentalness`, `erosion`, `peaksValleys`), each with four scalars. Add three sections, each pointing to a nested sub-object via a new `subKey` property. Extend the `SectionDef` type:

```ts
interface SectionDef {
  id: string;
  label: string;
  paramsKey: keyof GenerationParams;
  subKey?: string;           // NEW — nested field inside params[paramsKey]
  expanded: boolean;
  sliders: SliderDef[];
  toggle?: { key: string; label: string };
}
```

Update the two code paths that read/write sliders so that, when `subKey` is set, they descend one level. Search for `(this.params as any)[section.paramsKey][slider.key]` (or equivalent) in `readSlidersIntoParams()` and `syncSlidersFromParams()`, and wrap:

```ts
const group = section.subKey
  ? (this.params as any)[section.paramsKey][section.subKey]
  : (this.params as any)[section.paramsKey];
```

Use `group[slider.key]` for the read/write.

- [ ] **Step 3: Add three Climate sections**

Append to `SECTIONS`, after `extent`:

```ts
  {
    id: "climate-cont", label: "Climate · Continentalness", paramsKey: "climate", subKey: "continentalness", expanded: false,
    sliders: [
      { key: "scale",       label: "Scale",       min: 200, max: 4000, step: 10,   decimals: 0 },
      { key: "octaves",     label: "Octaves",     min: 1,   max: 6,    step: 1,    decimals: 0 },
      { key: "persistence", label: "Persistence", min: 0.1, max: 0.9,  step: 0.01, decimals: 2 },
      { key: "lacunarity",  label: "Lacunarity",  min: 1.5, max: 3,    step: 0.05, decimals: 2 },
    ],
  },
  {
    id: "climate-ero", label: "Climate · Erosion", paramsKey: "climate", subKey: "erosion", expanded: false,
    sliders: [
      { key: "scale",       label: "Scale",       min: 100, max: 2000, step: 10,   decimals: 0 },
      { key: "octaves",     label: "Octaves",     min: 1,   max: 6,    step: 1,    decimals: 0 },
      { key: "persistence", label: "Persistence", min: 0.1, max: 0.9,  step: 0.01, decimals: 2 },
      { key: "lacunarity",  label: "Lacunarity",  min: 1.5, max: 3,    step: 0.05, decimals: 2 },
    ],
  },
  {
    id: "climate-pv", label: "Climate · Peaks & Valleys", paramsKey: "climate", subKey: "peaksValleys", expanded: false,
    sliders: [
      { key: "scale",       label: "Scale",       min: 40,  max: 600,  step: 5,    decimals: 0 },
      { key: "octaves",     label: "Octaves",     min: 1,   max: 6,    step: 1,    decimals: 0 },
      { key: "persistence", label: "Persistence", min: 0.1, max: 0.9,  step: 0.01, decimals: 2 },
      { key: "lacunarity",  label: "Lacunarity",  min: 1.5, max: 3,    step: 0.05, decimals: 2 },
    ],
  },
```

- [ ] **Step 4: Add a Biome-Climate thresholds section**

Also append:

```ts
  {
    id: "biome-climate", label: "Biome Thresholds", paramsKey: "shape", subKey: "biomeClimate", expanded: false,
    sliders: [
      { key: "oceanContinentalness",    label: "Ocean Cont.",    min: -1,   max: 0,  step: 0.01, decimals: 2 },
      { key: "coastContinentalness",    label: "Coast Cont.",    min: -0.5, max: 0.3, step: 0.01, decimals: 2 },
      { key: "beachBand",               label: "Beach Band",     min: 0,    max: 10,  step: 1,    decimals: 0 },
      { key: "inlandContinentalness",   label: "Inland Cont.",   min: 0,    max: 0.8, step: 0.01, decimals: 2 },
      { key: "mountainErosion",         label: "Mountain Ero.",  min: -1,   max: 0,  step: 0.01, decimals: 2 },
    ],
  },
```

- [ ] **Step 5: Type-check**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 6: Visual check**

```bash
npm run dev
```

Open the debug panel. Expected: World Extent, three Climate sections, and Biome Thresholds render with working sliders. Applying changes regenerates the world; moving `Continentalness · Scale` should noticeably change how large continents are; dragging `Mountain Ero.` toward 0 should make mountains appear everywhere.

- [ ] **Step 7: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): debug panel sections for world extent, climate, biome thresholds"
```

---

## Task 10 — Debug panel: Spline tables editor

Adds the core custom UI: three editable spline panels (`continent`, `erosionByContinent`, `pvByErosion`). No graph — numeric rows only, add/remove points and anchors at runtime.

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`

- [ ] **Step 1: Add a `buildSplineSection(title, getSpline, setSpline)` helper**

Place this near the other `build*` methods on `DebugPanel`:

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

  const table = document.createElement("div");
  body.appendChild(table);

  const addBtn = document.createElement("div");
  addBtn.textContent = "+ Add point";
  addBtn.style.cssText = "margin-top:4px;color:#0f3460;cursor:pointer;font-size:0.7rem;";
  body.appendChild(addBtn);

  let collapsed = false;
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "block";
    header.textContent = (collapsed ? "▶ " : "▼ ") + title;
  });

  const render = () => {
    table.innerHTML = "";
    const s = getSpline();
    for (let i = 0; i < s.length; i++) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;margin-bottom:2px;align-items:center;";

      const xIn = document.createElement("input");
      xIn.type = "number"; xIn.step = "0.01";
      xIn.value = String(s[i].x);
      xIn.style.cssText = "width:60px;background:#0f3460;color:#ccc;border:1px solid #555;border-radius:3px;padding:2px 4px;font-size:0.7rem;";

      const yIn = document.createElement("input");
      yIn.type = "number"; yIn.step = "1";
      yIn.value = String(s[i].y);
      yIn.style.cssText = xIn.style.cssText;

      const del = document.createElement("span");
      del.textContent = "×";
      del.style.cssText = "cursor:pointer;color:#e94560;padding:0 4px;";

      xIn.addEventListener("change", () => {
        const next = getSpline().map((p, j) => j === i ? { ...p, x: Number(xIn.value) } : p);
        next.sort((a, b) => a.x - b.x);
        setSpline(next); render();
      });
      yIn.addEventListener("change", () => {
        const next = getSpline().map((p, j) => j === i ? { ...p, y: Number(yIn.value) } : p);
        setSpline(next); render();
      });
      del.addEventListener("click", () => {
        const current = getSpline();
        if (current.length <= 2) return;
        setSpline(current.filter((_, j) => j !== i));
        render();
      });

      row.appendChild(xIn); row.appendChild(yIn); row.appendChild(del);
      table.appendChild(row);
    }
  };

  addBtn.addEventListener("click", () => {
    const s = getSpline();
    const last = s[s.length - 1];
    const next = [...s, { x: Math.min(1, last.x + 0.1), y: last.y }];
    next.sort((a, b) => a.x - b.x);
    setSpline(next); render();
  });

  render();
  return wrapper;
}
```

Also add an import at the top of `debugPanel.ts`:

```ts
import { type Spline, type AnchoredSpline } from "./splines";
```

- [ ] **Step 2: Add a `buildAnchoredSection(title, getList, setList)` helper**

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

  const list = document.createElement("div");
  body.appendChild(list);

  const addAnchor = document.createElement("div");
  addAnchor.textContent = "+ Add anchor";
  addAnchor.style.cssText = "margin-top:6px;color:#0f3460;cursor:pointer;font-size:0.7rem;";
  body.appendChild(addAnchor);

  let collapsed = false;
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "block";
    header.textContent = (collapsed ? "▶ " : "▼ ") + title;
  });

  const render = () => {
    list.innerHTML = "";
    const ls = getList();
    for (let i = 0; i < ls.length; i++) {
      const row = document.createElement("div");
      row.style.cssText = "border:1px solid #333;border-radius:3px;padding:4px;margin-bottom:4px;";

      const topBar = document.createElement("div");
      topBar.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:4px;";
      const lbl = document.createElement("span");
      lbl.textContent = "anchor:";
      lbl.style.cssText = "font-size:0.7rem;color:#aaa;";
      const anchIn = document.createElement("input");
      anchIn.type = "number"; anchIn.step = "0.01";
      anchIn.value = String(ls[i].anchor);
      anchIn.style.cssText = "width:70px;background:#0f3460;color:#ccc;border:1px solid #555;border-radius:3px;padding:2px 4px;font-size:0.7rem;";

      const del = document.createElement("span");
      del.textContent = "Delete anchor";
      del.style.cssText = "cursor:pointer;color:#e94560;font-size:0.65rem;margin-left:auto;";

      anchIn.addEventListener("change", () => {
        const next = getList().map((e, j) => j === i ? { ...e, anchor: Number(anchIn.value) } : e);
        next.sort((a, b) => a.anchor - b.anchor);
        setList(next); render();
      });
      del.addEventListener("click", () => {
        const current = getList();
        if (current.length <= 1) return;
        setList(current.filter((_, j) => j !== i));
        render();
      });

      topBar.appendChild(lbl); topBar.appendChild(anchIn); topBar.appendChild(del);
      row.appendChild(topBar);

      const sub = this.buildSplineSection(
        "spline",
        () => getList()[i].spline,
        (s) => {
          const next = getList().map((e, j) => j === i ? { ...e, spline: s } : e);
          setList(next);
        },
      );
      sub.style.marginTop = "0";
      row.appendChild(sub);
      list.appendChild(row);
    }
  };

  addAnchor.addEventListener("click", () => {
    const cur = getList();
    const newAnchor = cur.length ? cur[cur.length - 1].anchor + 0.1 : 0;
    const next: AnchoredSpline[] = [
      ...cur,
      { anchor: newAnchor, spline: [{ x: -1, y: 0 }, { x: 1, y: 0 }] },
    ];
    next.sort((a, b) => a.anchor - b.anchor);
    setList(next); render();
  });

  render();
  return wrapper;
}
```

- [ ] **Step 3: Wire the three spline panels into `build()`**

In `DebugPanel.build()`, after the `SECTIONS` loop and before the `applyRow` block, append:

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

- [ ] **Step 4: Make `syncSlidersFromParams` re-render the spline sections**

When a preset is loaded, the spline tables need to rebuild. Simplest approach: keep a flat list of `render` callbacks stashed in a `this.splineRerenders: Array<() => void>` field; the two builders register their `render` into it; `setParams` calls them all. Concretely:

1. Add a field to the class:

```ts
private splineRerenders: Array<() => void> = [];
```

2. In `buildSplineSection` and `buildAnchoredSection`, after defining `render`, push it before the initial `render()` call: `this.splineRerenders.push(render);` (you'll need to capture `this` via arrow functions or pass `splineRerenders` in as a parameter — simplest is to convert both helpers into class methods, which they already are in Step 1/2).

3. At the end of `setParams(p)`:

```ts
for (const r of this.splineRerenders) r();
```

- [ ] **Step 5: Type-check**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 6: Visual check**

```bash
npm run dev
```

Open the panel. Expected: three new spline sections visible below the existing sections. Each shows its default points/anchors. Editing a point's `y` and clicking `Apply & Regenerate` visibly changes the world. Adding a point, removing a point, adding an anchor, removing an anchor all work and persist through regeneration. Loading a preset re-populates the tables.

Acceptance checks to run manually:

1. In the `Continentalness → Height` spline, drag the `x: 0.4, y: 90` point's `y` down to `40`. Regenerate. Peaks should flatten dramatically.
2. In `Splines · Erosion (by Continentalness)`, add an anchor at `0.0`. Regenerate. No crash; world looks similar since the new anchor's spline is identity.
3. Remove all but one anchor in `pvByErosion`. Regenerate. World still renders (one anchor = single global sub-spline).

- [ ] **Step 7: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts
git commit -m "feat(08): spline-table debug panel editor"
```

---

## Task 11 — Final sweep and README

Smoke test every feature still works (caves, aquifers, rivers, vegetation, ores, structures), update the project README, and confirm the repo's root `README.md` references 08.

**Files:**
- Modify: `08-spline-terrain/README.md`
- Modify: `README.md` (repo root) — only if it enumerates projects

- [ ] **Step 1: Smoke-test the full pipeline**

```bash
cd 08-spline-terrain
npm run dev
```

Walk through each of:

- Oceans: continentalness < −0.25 produces water-filled basins.
- Coasts: Beach biome appears in a thin band at low continentalness near waterLevel.
- Mountains: low erosion on inland tiles produces tall stone peaks.
- Caves / aquifers / rivers: toggle them in the debug panel, confirm behaviour matches 07.
- Trees / decorations: appear on forest/plains columns; no floating trees or stretched canopies at chunk borders.
- Ores: present at depth in stone columns.
- Structures: pyramids / igloos / houses still spawn when a qualifying biome sits at chunk center.

Expected: no console errors; no chunks missing geometry; frame rate roughly comparable to 07 (a little lower due to wider Y-range is acceptable).

- [ ] **Step 2: Write `08-spline-terrain/README.md`**

Replace the existing file (a copy of 07's README) with:

```markdown
# 08 — Spline-based terrain shaping

Climate-driven, anchor-blended spline pipeline for column heights.

Column height is produced by three climate noise fields
(continentalness, erosion, peaks & valleys) fed into a nested pair of
anchor-blended splines:

```
continentalness  ─► continent spline           ─► baseHeight
erosion          ─► erosion spline per cont.   ─► erosionAdjust
peaksValleys     ─► pv spline per erosion      ─► pvAdjust

finalHeight = clamp(baseHeight + erosionAdjust + pvAdjust,
                    minHeight, maxHeight)
```

Biomes are picked from climate values plus the resulting height:
Ocean / Beach / Mountains come from continentalness and erosion
thresholds; Desert / Tundra / Plains / Forest / Swamp / Savanna come
from the existing (temperature, humidity) matrix.

Spline tables, climate noise knobs, and the world Y-extent are all
editable at runtime from the debug panel.

See `docs/superpowers/specs/2026-04-19-spline-terrain-shaping-design.md`
for the full design.

## Running

```bash
npm install
npm run dev
```

Or via Docker: `docker compose up spline-terrain` (port 5181).
```

- [ ] **Step 3: Update the repo root README if it lists projects**

From repo root:

```bash
grep -n "advanced-terrain" README.md
```

If the root `README.md` has a project list that mentions `07-advanced-terrain`, add a sibling line for `08-spline-terrain` with a one-liner: "Climate-driven spline-shaped terrain."

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/README.md README.md
git commit -m "docs(08): project README and spline-terrain overview"
```

---

## Self-review checklist

Run through this after implementation before declaring the plan complete.

- [ ] All spec sections have a matching task:
  - Project scaffold → Task 1
  - Splines module → Task 2
  - Climate module → Task 3
  - `generationParams` extension → Task 4
  - `terrainShape` module → Task 5
  - Biome picker + `chunk.ts` switchover → Task 6
  - Parametric Y-extent + bedrock → Task 7
  - Obsolete params / presets cleanup → Task 8
  - Debug panel: extent, climate, thresholds → Task 9
  - Debug panel: spline tables → Task 10
  - Smoke test + docs → Task 11
- [ ] No `TBD` / `TODO` / placeholder instructions.
- [ ] Type names match across tasks: `TerrainShape`, `Spline`, `AnchoredSpline`, `SplinePoint`, `ClimateParams`, `ClimateSample`, `TerrainShaper`, `BiomeClimateThresholds`, `WorldExtentParams`, `TerrainShapeParams`, `classifyBiome`, `computeBlendedGrassColors`.
- [ ] Function signatures cited consistently: `classifyBiome(continentalness, erosion, temp, humid, height, waterLevel, thresholds)` and `heightAt(wx, wz)`.
- [ ] Every task ends with a commit step.
