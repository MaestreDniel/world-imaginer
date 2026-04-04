# Debug Parameter Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating, draggable debug panel to project 07-advanced-terrain that exposes all world generation parameters (terrain noise, erosion, caves, rivers, biomes, ores) as adjustable sliders with presets and per-section reset.

**Architecture:** A new `GenerationParams` interface carries all 33 tunable parameters through `WorldConfig` → worker → `generateChunk`. A new `debugPanel.ts` module builds the panel DOM programmatically, reading/writing `GenerationParams`. The panel communicates back to `main.ts` via an `onApply` callback that triggers world regeneration. Presets are stored in localStorage alongside panel position.

**Tech Stack:** TypeScript, vanilla DOM (no UI libraries), localStorage for persistence.

**Spec:** `docs/superpowers/specs/2026-04-04-debug-parameter-panel-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `07-advanced-terrain/src/generationParams.ts` | **Create** | `GenerationParams` interface, `DEFAULT_PARAMS`, built-in presets, section grouping metadata |
| `07-advanced-terrain/src/chunk.ts` | **Modify** | Replace hardcoded constants with `config.params.*`, update `WorldConfig` |
| `07-advanced-terrain/src/biomes.ts` | **Modify** | `createBiomeSampler` and `createBiomeDebugSampler` accept biome params instead of hardcoded scales/thresholds |
| `07-advanced-terrain/src/worker.ts` | **Modify** | No structural changes — `WorldConfig` already flows through, just carries more data now |
| `07-advanced-terrain/src/world.ts` | **Modify** | Minimal — `WorldConfig` import updated automatically |
| `07-advanced-terrain/src/debugPanel.ts` | **Create** | Full panel UI: draggable overlay, accordion sections, sliders, presets, reset, Apply button |
| `07-advanced-terrain/src/main.ts` | **Modify** | Import panel, wire `onApply` to regeneration, remove old erosion/droplet toolbar controls, add `P` shortcut |
| `07-advanced-terrain/index.html` | **Modify** | Remove erosion/droplet toolbar controls, add panel toggle button |

---

### Task 1: Define GenerationParams and defaults

**Files:**
- Create: `07-advanced-terrain/src/generationParams.ts`

This is the data backbone — every other task depends on it.

- [ ] **Step 1: Create the GenerationParams interface and defaults**

```ts
// 07-advanced-terrain/src/generationParams.ts

import { type ErosionConfig, DEFAULT_EROSION } from "./erosion";

// ── Terrain noise ──────────────────────────────────────────────────
export interface TerrainParams {
  scale: number;           // noise sample divisor (worldX / scale)
  octaves: number;
  persistence: number;
  lacunarity: number;
  warpStrength: number;
  warpIterations: number;
  heightMultiplier: number; // baseNoise * multiplier * blendedScale
}

// ── Caves ──────────────────────────────────────────────────────────
export interface CaveParams {
  scale: number;
  octaves: number;
  threshold: number;
  surfaceErosionScale: number;
  surfaceErosionThreshold: number;
  surfaceErosionDepth: number;
}

// ── Rivers ─────────────────────────────────────────────────────────
export interface RiverParams {
  voronoiScale: number;
  edgeThreshold: number;
  maxCarveDepth: number;
}

// ── Biomes ─────────────────────────────────────────────────────────
export interface BiomeParams {
  tempHumidityScale: number;
  continentScale: number;
  oceanThreshold: number;
  beachThreshold: number;
  mountainThreshold: number;
}

// ── Ores ───────────────────────────────────────────────────────────
export interface OreParams {
  scale: number;
  ironThreshold: number;
  ironMinDepth: number;
  coalThreshold: number;
}

// ── Erosion (re-export the subset we expose) ───────────────────────
export interface ErosionParams {
  enabled: boolean;
  droplets: number;
  erosionRate: number;
  depositionRate: number;
  inertia: number;
  maxLifetime: number;
  evaporationRate: number;
  gravity: number;
}

// ── Combined ───────────────────────────────────────────────────────
export interface GenerationParams {
  terrain: TerrainParams;
  erosion: ErosionParams;
  caves: CaveParams;
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
}

export const DEFAULT_PARAMS: GenerationParams = {
  terrain: {
    scale: 80,
    octaves: 5,
    persistence: 0.5,
    lacunarity: 2.0,
    warpStrength: 3.0,
    warpIterations: 1,
    heightMultiplier: 20,
  },
  erosion: {
    enabled: true,
    droplets: 250,
    erosionRate: 0.3,
    depositionRate: 0.3,
    inertia: 0.3,
    maxLifetime: 48,
    evaporationRate: 0.02,
    gravity: 10,
  },
  caves: {
    scale: 30,
    octaves: 3,
    threshold: 0.45,
    surfaceErosionScale: 16,
    surfaceErosionThreshold: 0.38,
    surfaceErosionDepth: 8,
  },
  rivers: {
    voronoiScale: 200,
    edgeThreshold: 0.08,
    maxCarveDepth: 6,
  },
  biomes: {
    tempHumidityScale: 300,
    continentScale: 500,
    oceanThreshold: -0.3,
    beachThreshold: -0.15,
    mountainThreshold: 0.45,
  },
  ores: {
    scale: 6,
    ironThreshold: 0.55,
    ironMinDepth: 15,
    coalThreshold: 0.50,
  },
};

/** Convert ErosionParams to the full ErosionConfig expected by erode(). */
export function toErosionConfig(ep: ErosionParams): ErosionConfig {
  return {
    droplets: ep.droplets,
    maxLifetime: ep.maxLifetime,
    inertia: ep.inertia,
    erosionRate: ep.erosionRate,
    depositionRate: ep.depositionRate,
    evaporationRate: ep.evaporationRate,
    gravity: ep.gravity,
    minSlope: DEFAULT_EROSION.minSlope,       // hardcoded
    erosionRadius: DEFAULT_EROSION.erosionRadius, // hardcoded
  };
}

/** Deep-clone params (all plain objects, no methods). */
export function cloneParams(p: GenerationParams): GenerationParams {
  return JSON.parse(JSON.stringify(p));
}
```

- [ ] **Step 2: Verify the file compiles**

Run from `07-advanced-terrain/`:
```bash
npx tsc --noEmit src/generationParams.ts
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 07-advanced-terrain/src/generationParams.ts
git commit -m "feat: add GenerationParams interface and defaults"
```

---

### Task 2: Update WorldConfig and chunk generation to use GenerationParams

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

Replace all hardcoded noise/erosion/cave/river/ore constants with values read from `config.params`.

- [ ] **Step 1: Update WorldConfig and DEFAULT_CONFIG**

In `chunk.ts`, replace the existing `WorldConfig` interface and `DEFAULT_CONFIG`:

```ts
// OLD imports at top of chunk.ts — add generationParams import
import { Block } from "./blocks";
import { createNoise } from "./perlin";
import { createBiomeSampler, BIOME_DEFS, Biome, computeBlendedBiomeParams } from "./biomes";
import { placeOakTree, placeSpruceTree, placeBirchTree, placeCactus, placePyramid, placeIgloo, placeHouse } from "./structures";
import { erode, DEFAULT_EROSION } from "./erosion";
import { type GenerationParams, DEFAULT_PARAMS, toErosionConfig } from "./generationParams";
```

Replace the `WorldConfig` interface:

```ts
export interface WorldConfig {
  seed: number;
  waterLevel: number;
  baseHeight: number;
  params: GenerationParams;
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 42,
  waterLevel: 0,
  baseHeight: 0,
  params: DEFAULT_PARAMS,
};
```

- [ ] **Step 2: Update generateChunk — terrain noise pass**

Replace the hardcoded `warpedFbm2D` call (around line 78-85) with parameterized values:

```ts
      const { terrain } = config.params;
      const baseNoise = noise.warpedFbm2D(
        wx / terrain.scale, wz / terrain.scale,
        terrain.octaves, terrain.persistence, terrain.lacunarity,
        terrain.warpStrength,
        terrain.warpIterations,
      );
      heights[idx] = baseHeight + blendedOffsets[idx] + baseNoise * terrain.heightMultiplier * blendedScales[idx];
```

- [ ] **Step 3: Update generateChunk — river channel pass**

Replace the hardcoded river constants (around line 100-115):

```ts
  const { rivers } = config.params;
  const riverNoise = createNoise(seed + 7);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const idx = lz * CHUNK_SIZE + lx;

      const v = riverNoise.voronoi2D(wx / rivers.voronoiScale, wz / rivers.voronoiScale);
      const edgeDist = v.f2 - v.f1;

      if (edgeDist < rivers.edgeThreshold) {
        const carveStrength = (1 - edgeDist / rivers.edgeThreshold);
        const currentHeight = heights[idx];
        if (currentHeight > waterLevel - 2) {
          const maxCarve = rivers.maxCarveDepth * carveStrength * carveStrength;
          heights[idx] = Math.max(waterLevel - 2, currentHeight - maxCarve);
        }
      }
    }
  }
```

- [ ] **Step 4: Update generateChunk — erosion pass**

Replace the erosion section (around line 117-161). Change the condition and the `erode()` call:

```ts
  if (config.params.erosion.enabled) {
    // ... (padding logic stays the same, but update the margin recompute
    // to also use terrain params for consistency)
    
    // Inside the margin recompute block, update the warpedFbm2D call:
    //   const marginNoise = noise.warpedFbm2D(
    //     wx / terrain.scale, wz / terrain.scale,
    //     terrain.octaves, terrain.persistence, terrain.lacunarity,
    //     terrain.warpStrength, terrain.warpIterations,
    //   );
    //   paddedMap[pz * padSize + px] = baseHeight + marginDef.heightOffset
    //     + marginNoise * terrain.heightMultiplier * marginDef.heightScale;

    // Update the erode() call:
    erode(paddedMap, padSize, toErosionConfig(config.params.erosion),
      seed + chunkX * 73856093 + chunkZ * 19349663);
    
    // Copy-back logic stays the same
  }
```

The full erosion block after changes:

```ts
  if (config.params.erosion.enabled) {
    const ERODE_PAD = 8;
    const padSize = CHUNK_SIZE + 2 * ERODE_PAD;
    const paddedMap = new Float64Array(padSize * padSize);

    for (let pz = 0; pz < padSize; pz++) {
      for (let px = 0; px < padSize; px++) {
        const wx = worldXOff - ERODE_PAD + px;
        const wz = worldZOff - ERODE_PAD + pz;
        const lx = px - ERODE_PAD;
        const lz = pz - ERODE_PAD;
        if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
          paddedMap[pz * padSize + px] = heights[lz * CHUNK_SIZE + lx];
        } else {
          const marginBiome = getBiome(wx, wz);
          const marginDef = BIOME_DEFS[marginBiome];
          const marginNoise = noise.warpedFbm2D(
            wx / terrain.scale, wz / terrain.scale,
            terrain.octaves, terrain.persistence, terrain.lacunarity,
            terrain.warpStrength, terrain.warpIterations,
          );
          paddedMap[pz * padSize + px] = baseHeight + marginDef.heightOffset
            + marginNoise * terrain.heightMultiplier * marginDef.heightScale;
        }
      }
    }

    erode(paddedMap, padSize, toErosionConfig(config.params.erosion),
      seed + chunkX * 73856093 + chunkZ * 19349663);

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        heights[lz * CHUNK_SIZE + lx] = paddedMap[(lz + ERODE_PAD) * padSize + (lx + ERODE_PAD)];
      }
    }
  }
```

- [ ] **Step 5: Update generateChunk — cave pass**

Replace hardcoded cave constants in the voxel fill loop (around line 216-220):

```ts
        const { caves } = config.params;
        if (depth > 1) {
          const caveVal = caveNoise.fbm3D(wx / caves.scale, wy / caves.scale, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const threshold = depth < 8 ? caves.threshold - 0.03 + (depth - 2) * 0.005 : caves.threshold;
          if (caveVal > threshold) {
            block = wy <= waterLevel ? Block.Water : Block.Air;
          }
        }
```

Note: extract `const { caves } = config.params;` once outside the triple loop (near the top of the voxel fill section) to avoid repeated property access.

- [ ] **Step 6: Update generateChunk — ore pass**

Replace hardcoded ore constants (around line 224-230):

```ts
        const { ores } = config.params;
        if (block === Block.Stone || block === Block.DeepStone) {
          const oreVal = oreNoise.fbm3D(wx / ores.scale, wy / ores.scale, wz / ores.scale, 2, 0.5, 2.0);
          if (oreVal > ores.ironThreshold && depth > ores.ironMinDepth) {
            block = Block.Iron;
          } else if (oreVal > ores.coalThreshold && depth > 8) {
            block = Block.Coal;
          }
        }
```

Same as caves — extract `const { ores } = config.params;` once outside the triple loop.

- [ ] **Step 7: Update generateChunk — surface cave erosion pass**

Replace hardcoded constants in the surface erosion loop (around line 241-261):

```ts
  const { caves } = config.params; // already extracted if placed above
  const erosionNoise = createNoise(seed + 5);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const surfaceH = heights[lz * CHUNK_SIZE + lx];
      const surfaceLocal = Math.floor(surfaceH) - worldYOff;

      for (let dy = 0; dy <= caves.surfaceErosionDepth; dy++) {
        const ly = surfaceLocal - dy;
        if (ly < 0 || ly >= CHUNK_SIZE) continue;
        const wy = worldYOff + ly;
        if (wy <= waterLevel) continue;

        const erosion = erosionNoise.fbm3D(
          wx / caves.surfaceErosionScale, wy / caves.surfaceErosionScale, wz / caves.surfaceErosionScale,
          3, 0.5, 2.0,
        );
        const threshold = caves.surfaceErosionThreshold + dy * 0.02;
        if (erosion > threshold) {
          data[chunkIndex(lx, ly, lz)] = Block.Air;
        }
      }
    }
  }
```

- [ ] **Step 8: Verify compilation**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat: parameterize chunk generation with GenerationParams"
```

---

### Task 3: Update biomes.ts to accept BiomeParams

**Files:**
- Modify: `07-advanced-terrain/src/biomes.ts`

- [ ] **Step 1: Update createBiomeSampler to accept BiomeParams**

Add import at top:
```ts
import { type BiomeParams, DEFAULT_PARAMS } from "./generationParams";
```

Change the signature and body of `createBiomeSampler`:

```ts
export function createBiomeSampler(seed: number, biomeParams: BiomeParams = DEFAULT_PARAMS.biomes) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  function sampleNoise(wx: number, wz: number) {
    const v = continentNoise.voronoi2D(wx / biomeParams.continentScale, wz / biomeParams.continentScale);
    const edgeDist = v.f2 - v.f1;
    const perturbation = continentNoise.fbm2D(wx / 200, wz / 200, 3, 0.5, 2.0) * 0.15;
    const continent = (edgeDist - 0.25) * 2.0 + perturbation;
    const temp = tempNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);
    const humid = humidNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);
    return { continent, temp, humid };
  }

  function biomeFromNoise(continent: number, temp: number, humid: number): BiomeId {
    if (continent < biomeParams.oceanThreshold) return Biome.Ocean;
    if (continent < biomeParams.beachThreshold) return Biome.Beach;
    if (continent > biomeParams.mountainThreshold) return Biome.Mountains;

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

  return function getBiome(wx: number, wz: number): BiomeId {
    const { continent, temp, humid } = sampleNoise(wx, wz);
    return biomeFromNoise(continent, temp, humid);
  };
}
```

- [ ] **Step 2: Update createBiomeDebugSampler similarly**

```ts
export function createBiomeDebugSampler(seed: number, biomeParams: BiomeParams = DEFAULT_PARAMS.biomes) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  return function getBiomeDebug(wx: number, wz: number): BiomeDebugInfo {
    const v = continentNoise.voronoi2D(wx / biomeParams.continentScale, wz / biomeParams.continentScale);
    const edgeDist = v.f2 - v.f1;
    const perturbation = continentNoise.fbm2D(wx / 200, wz / 200, 3, 0.5, 2.0) * 0.15;
    const continent = (edgeDist - 0.25) * 2.0 + perturbation;
    const temperature = tempNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);
    const humidity = humidNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);

    let biome: BiomeId;
    if (continent < biomeParams.oceanThreshold) biome = Biome.Ocean;
    else if (continent < biomeParams.beachThreshold) biome = Biome.Beach;
    else if (continent > biomeParams.mountainThreshold) biome = Biome.Mountains;
    else if (temperature > 0.2) biome = humidity > 0.15 ? Biome.Savanna : Biome.Desert;
    else if (temperature > -0.15) {
      if (humidity > 0.2) biome = Biome.Forest;
      else if (humidity > -0.1) biome = Biome.BirchForest;
      else biome = Biome.Plains;
    } else {
      biome = humidity > 0.05 ? Biome.Taiga : Biome.Tundra;
    }

    return { biome, temperature, humidity, continent };
  };
}
```

- [ ] **Step 3: Update the call site in chunk.ts**

In `generateChunk`, update the `createBiomeSampler` call:

```ts
  const getBiome = createBiomeSampler(seed, config.params.biomes);
```

- [ ] **Step 4: Verify compilation**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/biomes.ts 07-advanced-terrain/src/chunk.ts
git commit -m "feat: parameterize biome sampler with BiomeParams"
```

---

### Task 4: Update main.ts to use GenerationParams (keep existing UI working)

**Files:**
- Modify: `07-advanced-terrain/src/main.ts`

Before building the debug panel, make the existing app work with the new `WorldConfig` shape so we can verify nothing is broken.

- [ ] **Step 1: Update imports and World construction**

Add import:
```ts
import { DEFAULT_PARAMS, cloneParams, type GenerationParams } from "./generationParams";
```

Replace the existing `world` construction (around line 99-103):

```ts
let currentParams = cloneParams(DEFAULT_PARAMS);

let world = new World(scene, {
  seed: currentSeed,
  params: currentParams,
});
let biomeSampler      = createBiomeSampler(currentSeed, currentParams.biomes);
let biomeDebugSampler = createBiomeDebugSampler(currentSeed, currentParams.biomes);
```

- [ ] **Step 2: Update the regenerate function**

Replace the existing `regenerate()` (around line 164-182):

```ts
function regenerate() {
  const inputVal = Number(seedInput.value);
  if (inputVal !== currentSeed) {
    currentSeed = inputVal || randomSeed();
  } else {
    currentSeed = randomSeed();
  }
  seedInput.value = String(currentSeed);

  world.dispose();
  world = new World(scene, {
    seed: currentSeed,
    params: currentParams,
  });
  biomeSampler      = createBiomeSampler(currentSeed, currentParams.biomes);
  biomeDebugSampler = createBiomeDebugSampler(currentSeed, currentParams.biomes);
  walkController.setWorld(world);
}
```

- [ ] **Step 3: Update debug overlay to read from currentParams**

Update the debug overlay HTML (around line 277):

```ts
      `Erosion: ${currentParams.erosion.enabled ? 'ON' : 'OFF'} (${currentParams.erosion.droplets} drops)<br><br>` +
```

- [ ] **Step 4: Remove old erosion/droplet toolbar JS**

Remove these lines (no longer needed — they'll be in the panel):
- The `erosionToggle` and `dropletsSlider` variable declarations (lines ~80-82)
- The `dropletsSlider` input event listener (lines ~191-193)
- Remove the erosion/droplet references from the `World` construction (already done in step 1)

Keep `dropletsVal` removal for now — it's referenced in HTML which we update in Task 7.

- [ ] **Step 5: Verify the app runs**

```bash
cd 07-advanced-terrain && npm run dev
```
Open in browser, verify terrain generates correctly with default params. The erosion/droplet toolbar controls will be broken (removed from JS but still in HTML) — that's expected and fixed in Task 7.

- [ ] **Step 6: Commit**

```bash
git add 07-advanced-terrain/src/main.ts
git commit -m "feat: wire main.ts to GenerationParams"
```

---

### Task 5: Build the debug panel UI

**Files:**
- Create: `07-advanced-terrain/src/debugPanel.ts`

This is the largest task. The panel creates all DOM elements programmatically.

- [ ] **Step 1: Create debugPanel.ts with panel structure and dragging**

```ts
// 07-advanced-terrain/src/debugPanel.ts

import {
  type GenerationParams,
  DEFAULT_PARAMS,
  cloneParams,
} from "./generationParams";

// ── Slider definition metadata ─────────────────────────────────────
interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Decimal places to show in the value label */
  decimals: number;
}

interface SectionDef {
  id: string;
  label: string;
  paramsKey: keyof GenerationParams;
  expanded: boolean;
  sliders: SliderDef[];
  /** Optional toggle (for erosion enabled) */
  toggle?: { key: string; label: string };
}

const SECTIONS: SectionDef[] = [
  {
    id: "terrain", label: "Terrain Noise", paramsKey: "terrain", expanded: true,
    sliders: [
      { key: "scale",            label: "Scale",            min: 10,   max: 500, step: 5,    decimals: 0 },
      { key: "octaves",          label: "Octaves",          min: 1,    max: 8,   step: 1,    decimals: 0 },
      { key: "persistence",      label: "Persistence",      min: 0.01, max: 1,   step: 0.01, decimals: 2 },
      { key: "lacunarity",       label: "Lacunarity",       min: 1,    max: 4,   step: 0.1,  decimals: 1 },
      { key: "warpStrength",     label: "Warp Strength",    min: 0,    max: 10,  step: 0.1,  decimals: 1 },
      { key: "warpIterations",   label: "Warp Iterations",  min: 0,    max: 4,   step: 1,    decimals: 0 },
      { key: "heightMultiplier", label: "Height Multiplier", min: 1,   max: 60,  step: 1,    decimals: 0 },
    ],
  },
  {
    id: "erosion", label: "Erosion", paramsKey: "erosion", expanded: true,
    toggle: { key: "enabled", label: "Enabled" },
    sliders: [
      { key: "droplets",        label: "Droplets",         min: 0,    max: 5000, step: 50,    decimals: 0 },
      { key: "erosionRate",     label: "Erosion Rate",     min: 0,    max: 1,    step: 0.01,  decimals: 2 },
      { key: "depositionRate",  label: "Deposition Rate",  min: 0,    max: 1,    step: 0.01,  decimals: 2 },
      { key: "inertia",         label: "Inertia",          min: 0,    max: 1,    step: 0.01,  decimals: 2 },
      { key: "maxLifetime",     label: "Max Lifetime",     min: 10,   max: 200,  step: 1,     decimals: 0 },
      { key: "evaporationRate", label: "Evaporation Rate", min: 0,    max: 0.1,  step: 0.005, decimals: 3 },
      { key: "gravity",         label: "Gravity",          min: 1,    max: 30,   step: 1,     decimals: 0 },
    ],
  },
  {
    id: "caves", label: "Caves", paramsKey: "caves", expanded: false,
    sliders: [
      { key: "scale",                   label: "Scale",                    min: 5,   max: 100, step: 1,    decimals: 0 },
      { key: "octaves",                 label: "Octaves",                  min: 1,   max: 6,   step: 1,    decimals: 0 },
      { key: "threshold",               label: "Threshold",                min: 0.2, max: 0.7, step: 0.01, decimals: 2 },
      { key: "surfaceErosionScale",     label: "Surface Erosion Scale",    min: 5,   max: 50,  step: 1,    decimals: 0 },
      { key: "surfaceErosionThreshold", label: "Surface Erosion Threshold", min: 0.2, max: 0.6, step: 0.01, decimals: 2 },
      { key: "surfaceErosionDepth",     label: "Surface Erosion Depth",    min: 2,   max: 16,  step: 1,    decimals: 0 },
    ],
  },
  {
    id: "rivers", label: "Rivers", paramsKey: "rivers", expanded: false,
    sliders: [
      { key: "voronoiScale",  label: "Voronoi Scale",   min: 50,   max: 500, step: 10,   decimals: 0 },
      { key: "edgeThreshold", label: "Edge Threshold",   min: 0.01, max: 0.2, step: 0.01, decimals: 2 },
      { key: "maxCarveDepth", label: "Max Carve Depth",  min: 1,    max: 15,  step: 1,    decimals: 0 },
    ],
  },
  {
    id: "biomes", label: "Biomes", paramsKey: "biomes", expanded: false,
    sliders: [
      { key: "tempHumidityScale", label: "Temp/Humidity Scale", min: 100,  max: 600,  step: 10,   decimals: 0 },
      { key: "continentScale",    label: "Continent Scale",     min: 200,  max: 1000, step: 10,   decimals: 0 },
      { key: "oceanThreshold",    label: "Ocean Threshold",     min: -0.6, max: 0,    step: 0.01, decimals: 2 },
      { key: "beachThreshold",    label: "Beach Threshold",     min: -0.4, max: 0.1,  step: 0.01, decimals: 2 },
      { key: "mountainThreshold", label: "Mountain Threshold",  min: 0.2,  max: 0.8,  step: 0.01, decimals: 2 },
    ],
  },
  {
    id: "ores", label: "Ores", paramsKey: "ores", expanded: false,
    sliders: [
      { key: "scale",          label: "Scale",           min: 2,   max: 20,  step: 1,    decimals: 0 },
      { key: "ironThreshold",  label: "Iron Threshold",  min: 0.3, max: 0.8, step: 0.01, decimals: 2 },
      { key: "ironMinDepth",   label: "Iron Min Depth",  min: 5,   max: 30,  step: 1,    decimals: 0 },
      { key: "coalThreshold",  label: "Coal Threshold",  min: 0.3, max: 0.7, step: 0.01, decimals: 2 },
    ],
  },
];

// ── Preset system ──────────────────────────────────────────────────
interface Preset {
  name: string;
  params: GenerationParams;
  builtIn: boolean;
}

const BUILT_IN_PRESETS: Preset[] = [
  { name: "Default", params: cloneParams(DEFAULT_PARAMS), builtIn: true },
  {
    name: "Flat Plains", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      terrain: { scale: 120, octaves: 2, persistence: 0.3, lacunarity: 2.0, warpStrength: 0, warpIterations: 0, heightMultiplier: 6 },
      erosion: { ...DEFAULT_PARAMS.erosion, enabled: false },
    },
  },
  {
    name: "Extreme Mountains", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      terrain: { scale: 60, octaves: 7, persistence: 0.6, lacunarity: 2.2, warpStrength: 5.0, warpIterations: 2, heightMultiplier: 50 },
    },
  },
  {
    name: "Island Archipelago", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      biomes: { tempHumidityScale: 300, continentScale: 250, oceanThreshold: -0.15, beachThreshold: -0.05, mountainThreshold: 0.5 },
    },
  },
  {
    name: "Cave Heavy", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      caves: { scale: 25, octaves: 4, threshold: 0.35, surfaceErosionScale: 12, surfaceErosionThreshold: 0.30, surfaceErosionDepth: 14 },
    },
  },
];

const STORAGE_KEY_PRESETS = "world-imaginer-user-presets";
const STORAGE_KEY_POSITION = "world-imaginer-panel-pos";

function loadUserPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
    if (!raw) return [];
    return JSON.parse(raw).map((p: { name: string; params: GenerationParams }) => ({
      ...p, builtIn: false,
    }));
  } catch { return []; }
}

function saveUserPresets(presets: Preset[]): void {
  localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(
    presets.filter(p => !p.builtIn).map(p => ({ name: p.name, params: p.params })),
  ));
}

// ── Panel class ────────────────────────────────────────────────────
export class DebugPanel {
  private container: HTMLDivElement;
  private params: GenerationParams;
  private onApply: (params: GenerationParams) => void;
  private sliderInputs = new Map<string, HTMLInputElement>();
  private sliderValues = new Map<string, HTMLSpanElement>();
  private toggleInputs = new Map<string, HTMLInputElement>();
  private sectionBodies = new Map<string, HTMLDivElement>();
  private sectionHeaders = new Map<string, HTMLDivElement>();
  private presetSelect!: HTMLSelectElement;
  private presets: Preset[];
  private visible = false;
  private minimized = false;

  constructor(params: GenerationParams, onApply: (params: GenerationParams) => void) {
    this.params = cloneParams(params);
    this.onApply = onApply;
    this.presets = [...BUILT_IN_PRESETS, ...loadUserPresets()];
    this.container = this.build();
    document.body.appendChild(this.container);
    this.restorePosition();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
  }

  isVisible(): boolean { return this.visible; }

  /** Update the panel sliders from external params (e.g. after regenerate). */
  setParams(p: GenerationParams): void {
    this.params = cloneParams(p);
    this.syncSlidersFromParams();
  }

  private build(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.id = "debug-panel";
    panel.style.cssText = `
      display:none; position:fixed; top:90px; right:12px; width:300px;
      background:#1a1a3e; border:1px solid #444; border-radius:6px;
      font-family:system-ui,sans-serif; font-size:0.75rem; color:#ccc;
      box-shadow:0 4px 20px rgba(0,0,0,0.5); z-index:100;
      max-height:calc(100vh - 100px); overflow-y:auto;
      user-select:none;
    `;

    // Title bar
    const titleBar = document.createElement("div");
    titleBar.style.cssText = `
      display:flex; justify-content:space-between; align-items:center;
      padding:8px 12px; background:#16213e; border-radius:6px 6px 0 0;
      border-bottom:1px solid #333; cursor:move;
    `;
    const title = document.createElement("span");
    title.textContent = "World Parameters";
    title.style.cssText = "font-weight:bold;color:#e94560;font-size:0.85rem;";

    const titleButtons = document.createElement("div");
    titleButtons.style.cssText = "display:flex;gap:6px;align-items:center;";

    const resetAllBtn = document.createElement("span");
    resetAllBtn.textContent = "Reset All";
    resetAllBtn.style.cssText = "font-size:0.65rem;color:#888;background:#222;padding:2px 6px;border-radius:3px;cursor:pointer;";
    resetAllBtn.addEventListener("click", () => this.resetAll());

    const minimizeBtn = document.createElement("span");
    minimizeBtn.textContent = "\u2212";
    minimizeBtn.style.cssText = "cursor:pointer;color:#888;font-size:1.2rem;line-height:1;";
    minimizeBtn.addEventListener("click", () => this.toggleMinimize());

    titleButtons.appendChild(resetAllBtn);
    titleButtons.appendChild(minimizeBtn);
    titleBar.appendChild(title);
    titleBar.appendChild(titleButtons);
    panel.appendChild(titleBar);

    // Dragging
    this.setupDrag(panel, titleBar);

    // Body (everything below title bar — hidden when minimized)
    const body = document.createElement("div");
    body.id = "debug-panel-body";

    // Presets
    body.appendChild(this.buildPresetRow());

    // Sections
    for (const section of SECTIONS) {
      body.appendChild(this.buildSection(section));
    }

    // Apply button
    const applyRow = document.createElement("div");
    applyRow.style.cssText = "padding:10px 12px;";
    const applyBtn = document.createElement("div");
    applyBtn.textContent = "Apply & Regenerate";
    applyBtn.style.cssText = `
      background:#e94560; color:white; text-align:center; padding:8px;
      border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.8rem;
    `;
    applyBtn.addEventListener("click", () => {
      this.readSlidersIntoParams();
      this.onApply(cloneParams(this.params));
    });
    applyBtn.addEventListener("mouseenter", () => { applyBtn.style.background = "#c73e54"; });
    applyBtn.addEventListener("mouseleave", () => { applyBtn.style.background = "#e94560"; });
    applyRow.appendChild(applyBtn);
    body.appendChild(applyRow);

    panel.appendChild(body);
    return panel;
  }

  private buildPresetRow(): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 12px;border-bottom:1px solid #2a2a4a;display:flex;gap:6px;align-items:center;";

    this.presetSelect = document.createElement("select");
    this.presetSelect.style.cssText = "flex:1;background:#0f3460;color:#ccc;border:1px solid #555;border-radius:3px;padding:3px 4px;font-size:0.7rem;";
    this.refreshPresetOptions();
    this.presetSelect.addEventListener("change", () => this.loadPreset());

    const saveBtn = document.createElement("span");
    saveBtn.textContent = "Save";
    saveBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
    saveBtn.addEventListener("click", () => this.savePreset());

    const delBtn = document.createElement("span");
    delBtn.textContent = "Del";
    delBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
    delBtn.addEventListener("click", () => this.deletePreset());

    row.appendChild(this.presetSelect);
    row.appendChild(saveBtn);
    row.appendChild(delBtn);
    return row;
  }

  private buildSection(section: SectionDef): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border-bottom:1px solid #2a2a4a;";

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display:flex; justify-content:space-between; align-items:center;
      padding:6px 12px; cursor:pointer; background:#16213e;
    `;
    const arrow = section.expanded ? "\u25BC" : "\u25B6";
    const label = document.createElement("span");
    label.style.cssText = `color:${section.expanded ? "#e94560" : "#888"};font-weight:bold;`;
    label.textContent = `${arrow} ${section.label}`;

    const resetBtn = document.createElement("span");
    resetBtn.textContent = "\u21BA reset";
    resetBtn.style.cssText = "font-size:0.6rem;color:#666;cursor:pointer;";
    resetBtn.addEventListener("click", (e) => { e.stopPropagation(); this.resetSection(section); });

    header.appendChild(label);
    header.appendChild(resetBtn);
    this.sectionHeaders.set(section.id, header);

    // Body
    const body = document.createElement("div");
    body.style.cssText = `padding:6px 12px 10px;display:${section.expanded ? "block" : "none"};`;

    // Toggle (if present)
    if (section.toggle) {
      const toggleRow = document.createElement("div");
      toggleRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = (this.params[section.paramsKey] as Record<string, unknown>)[section.toggle.key] as boolean;
      this.toggleInputs.set(`${section.paramsKey}.${section.toggle.key}`, checkbox);
      const toggleLabel = document.createElement("label");
      toggleLabel.style.cssText = "cursor:pointer;color:#aaa;";
      toggleLabel.textContent = section.toggle.label;
      toggleLabel.prepend(checkbox);
      toggleRow.appendChild(toggleLabel);
      body.appendChild(toggleRow);
    }

    // Sliders
    for (const slider of section.sliders) {
      body.appendChild(this.buildSliderRow(section.paramsKey, slider));
    }

    this.sectionBodies.set(section.id, body);

    // Toggle expand/collapse
    header.addEventListener("click", () => {
      const isOpen = body.style.display !== "none";
      body.style.display = isOpen ? "none" : "block";
      label.textContent = `${isOpen ? "\u25B6" : "\u25BC"} ${section.label}`;
      label.style.color = isOpen ? "#888" : "#e94560";
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  private buildSliderRow(paramsKey: string, def: SliderDef): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;";

    const label = document.createElement("span");
    label.style.color = "#aaa";
    label.textContent = def.label;

    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:4px;";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    const currentVal = (this.params[paramsKey as keyof GenerationParams] as Record<string, number>)[def.key];
    input.value = String(currentVal);
    input.style.cssText = "width:90px;";

    const valueSpan = document.createElement("span");
    valueSpan.style.cssText = "color:#e94560;width:36px;text-align:right;font-size:0.7rem;font-family:monospace;";
    valueSpan.textContent = currentVal.toFixed(def.decimals);

    input.addEventListener("input", () => {
      valueSpan.textContent = Number(input.value).toFixed(def.decimals);
    });

    const fullKey = `${paramsKey}.${def.key}`;
    this.sliderInputs.set(fullKey, input);
    this.sliderValues.set(fullKey, valueSpan);

    right.appendChild(input);
    right.appendChild(valueSpan);
    row.appendChild(label);
    row.appendChild(right);
    return row;
  }

  // ── Drag logic ───────────────────────────────────────────────────
  private setupDrag(panel: HTMLDivElement, handle: HTMLDivElement): void {
    let dragging = false;
    let offsetX = 0, offsetY = 0;

    handle.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).style.cursor === "pointer") return; // don't drag on buttons
      dragging = true;
      offsetX = e.clientX - panel.offsetLeft;
      offsetY = e.clientY - panel.offsetTop;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - offsetX) + "px";
      panel.style.top = (e.clientY - offsetY) + "px";
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        this.savePosition();
      }
    });
  }

  private savePosition(): void {
    localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify({
      left: this.container.style.left,
      top: this.container.style.top,
    }));
  }

  private restorePosition(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_POSITION);
      if (!raw) return;
      const { left, top } = JSON.parse(raw);
      this.container.style.left = left;
      this.container.style.top = top;
      this.container.style.right = "auto";
    } catch { /* ignore */ }
  }

  // ── Minimize ─────────────────────────────────────────────────────
  private toggleMinimize(): void {
    this.minimized = !this.minimized;
    const body = this.container.querySelector("#debug-panel-body") as HTMLDivElement;
    body.style.display = this.minimized ? "none" : "block";
  }

  // ── Read/write sliders ↔ params ──────────────────────────────────
  private readSlidersIntoParams(): void {
    for (const section of SECTIONS) {
      const group = this.params[section.paramsKey] as Record<string, unknown>;
      if (section.toggle) {
        const checkbox = this.toggleInputs.get(`${section.paramsKey}.${section.toggle.key}`)!;
        group[section.toggle.key] = checkbox.checked;
      }
      for (const slider of section.sliders) {
        const input = this.sliderInputs.get(`${section.paramsKey}.${slider.key}`)!;
        group[slider.key] = Number(input.value);
      }
    }
  }

  private syncSlidersFromParams(): void {
    for (const section of SECTIONS) {
      const group = this.params[section.paramsKey] as Record<string, unknown>;
      if (section.toggle) {
        const checkbox = this.toggleInputs.get(`${section.paramsKey}.${section.toggle.key}`)!;
        checkbox.checked = group[section.toggle.key] as boolean;
      }
      for (const slider of section.sliders) {
        const fullKey = `${section.paramsKey}.${slider.key}`;
        const input = this.sliderInputs.get(fullKey)!;
        const valueSpan = this.sliderValues.get(fullKey)!;
        const val = group[slider.key] as number;
        input.value = String(val);
        valueSpan.textContent = val.toFixed(slider.decimals);
      }
    }
  }

  // ── Reset ────────────────────────────────────────────────────────
  private resetSection(section: SectionDef): void {
    const defaults = DEFAULT_PARAMS[section.paramsKey];
    (this.params as Record<string, unknown>)[section.paramsKey] = JSON.parse(JSON.stringify(defaults));
    this.syncSlidersFromParams();
  }

  private resetAll(): void {
    this.params = cloneParams(DEFAULT_PARAMS);
    this.syncSlidersFromParams();
  }

  // ── Presets ──────────────────────────────────────────────────────
  private refreshPresetOptions(): void {
    this.presetSelect.innerHTML = "";
    for (const preset of this.presets) {
      const opt = document.createElement("option");
      opt.textContent = preset.builtIn ? preset.name : `\u2605 ${preset.name}`;
      opt.value = preset.name;
      this.presetSelect.appendChild(opt);
    }
  }

  private loadPreset(): void {
    const name = this.presetSelect.value;
    const preset = this.presets.find(p => p.name === name);
    if (!preset) return;
    this.params = cloneParams(preset.params);
    this.syncSlidersFromParams();
  }

  private savePreset(): void {
    const name = prompt("Preset name:");
    if (!name || !name.trim()) return;
    this.readSlidersIntoParams();
    // Remove existing user preset with same name
    this.presets = this.presets.filter(p => p.builtIn || p.name !== name.trim());
    this.presets.push({ name: name.trim(), params: cloneParams(this.params), builtIn: false });
    saveUserPresets(this.presets);
    this.refreshPresetOptions();
    this.presetSelect.value = name.trim();
  }

  private deletePreset(): void {
    const name = this.presetSelect.value;
    const preset = this.presets.find(p => p.name === name);
    if (!preset || preset.builtIn) return; // can't delete built-in
    this.presets = this.presets.filter(p => p.name !== name);
    saveUserPresets(this.presets);
    this.refreshPresetOptions();
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 07-advanced-terrain/src/debugPanel.ts
git commit -m "feat: add debug parameter panel UI"
```

---

### Task 6: Wire the panel into main.ts

**Files:**
- Modify: `07-advanced-terrain/src/main.ts`

- [ ] **Step 1: Import and instantiate the panel**

Add import:
```ts
import { DebugPanel } from "./debugPanel";
```

After the `currentParams` and `world` declarations, add:

```ts
const debugPanel = new DebugPanel(currentParams, (newParams) => {
  currentParams = newParams;
  regenerate();
});
```

- [ ] **Step 2: Add the P keyboard shortcut**

In the existing `keydown` handler, add a case for `p` (after the `f` case):

```ts
  if (key === "p") { debugPanel.toggle(); return; }
```

- [ ] **Step 3: Verify the panel works end-to-end**

```bash
cd 07-advanced-terrain && npm run dev
```

Open in browser. Press `P` — panel should appear. Adjust terrain scale slider, click "Apply & Regenerate" — world should regenerate with new params. Test dragging, minimize, presets, section collapse/expand, and per-section reset.

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/main.ts
git commit -m "feat: wire debug panel into main with P shortcut"
```

---

### Task 7: Clean up HTML and toolbar

**Files:**
- Modify: `07-advanced-terrain/index.html`
- Modify: `07-advanced-terrain/src/main.ts`

Remove the old erosion/droplet controls from the toolbar and add the panel toggle button.

- [ ] **Step 1: Update index.html**

Remove these lines from the toolbar div:

```html
    <label class="control" style="cursor:pointer"><input type="checkbox" id="erosion" checked /> Erosion</label>
    <div class="control">
      <label>Droplets: <span id="droplets-val">250</span></label>
      <input type="range" id="droplets" min="0" max="2000" step="250" value="250" />
    </div>
```

Add a panel toggle button after the mode button:

```html
    <button id="params-toggle">Params</button>
```

- [ ] **Step 2: Wire the toggle button in main.ts**

Add after the `debugPanel` instantiation:

```ts
const paramsToggleBtn = document.getElementById("params-toggle") as HTMLButtonElement;
paramsToggleBtn.addEventListener("click", () => { debugPanel.toggle(); paramsToggleBtn.blur(); });
```

- [ ] **Step 3: Clean up remaining references in main.ts**

Remove the variable declarations for `erosionToggle`, `dropletsSlider`, `dropletsVal` if they still exist. Remove any remaining event listeners that reference them.

- [ ] **Step 4: Verify everything works**

```bash
cd 07-advanced-terrain && npm run dev
```

Verify: toolbar no longer has erosion/droplet controls, "Params" button opens the panel, all panel features work, `npm run build` succeeds.

- [ ] **Step 5: Run the build**

```bash
cd 07-advanced-terrain && npm run build
```
Expected: clean build with no errors.

- [ ] **Step 6: Commit**

```bash
git add 07-advanced-terrain/index.html 07-advanced-terrain/src/main.ts
git commit -m "feat: clean up toolbar, add Params toggle button"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full manual test**

```bash
cd 07-advanced-terrain && npm run dev
```

Checklist:
1. Default world generates correctly (same as before)
2. Press `P` — panel appears top-right
3. Panel is draggable by title bar
4. Minimize button collapses to title bar only
5. Terrain Noise and Erosion sections are expanded; others collapsed
6. Change terrain scale to 40, click Apply — terrain regenerates with more detail
7. Toggle erosion off, Apply — terrain is smoother (no erosion)
8. Select "Extreme Mountains" preset — sliders update but world doesn't change yet
9. Click Apply — dramatic mountain terrain appears
10. Reset All — sliders return to defaults
11. Save a custom preset, reload page, preset persists
12. Delete custom preset
13. Debug overlay still shows correct biome/erosion info
14. Walk mode still works (F key)
15. `npm run build` succeeds

- [ ] **Step 2: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: final adjustments to debug panel"
```
