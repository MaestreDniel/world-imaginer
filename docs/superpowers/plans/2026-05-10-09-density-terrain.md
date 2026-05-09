# 09 Density Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `09-density-terrain/` — a clone of `08-spline-terrain/` whose chunk pipeline is replaced by a unified 3D density field driven by spline-derived `(offset, factor, jaggedness)` 2D fields, sampled on a coarse 5×3×5 corner grid and trilerped to per-voxel.

**Architecture:** Density `= (offset(x,z) - y) * factor(x,z) + jaggedness(x,z) * envelope(y) * fbm3D(x,y,z) - cave(x,y,z)`. Solid iff density ≥ 0. The density branch is gated behind a flag in `GenerationParams` while the new modules are wired up; once the visual is validated, the legacy heightmap pipeline (and erosion/rivers/legacy caves) is deleted and the flag goes with it.

**Tech Stack:** TypeScript strict + Vite (no test framework — this repo has none; verification is build-time type checks plus visual checks in the dev server). All new code lives in `09-density-terrain/src/`.

**Verification convention.** This repo has no test runner. For each task, "verify" means:
1. `npm run build` from inside `09-density-terrain/` exits 0 with no type errors.
2. Where listed, a `console.log`/`console.assert` block in `main.ts` produces the expected output on page load (kept under a `if (import.meta.env.DEV)` guard, removed in cleanup task at the end).
3. Where listed, a visual check in `npm run dev` matches the description.

**Spec reference:** `docs/superpowers/specs/2026-05-10-09-density-terrain-design.md`.

---

### Task 1: Scaffold `09-density-terrain` from `08-spline-terrain`

**Files:**
- Create: `09-density-terrain/` (copy of `08-spline-terrain/`)
- Modify: `09-density-terrain/package.json` (rename)
- Modify: `09-density-terrain/Dockerfile` (port)
- Modify: `docker-compose.yml` (add service)
- Modify: `09-density-terrain/README.md` (header)

- [ ] **Step 1: Copy the project tree**

```bash
cp -r 08-spline-terrain 09-density-terrain
rm -rf 09-density-terrain/node_modules 09-density-terrain/dist
```

- [ ] **Step 2: Rename in `package.json`**

Edit `09-density-terrain/package.json` line 2:

```json
"name": "09-density-terrain",
```

- [ ] **Step 3: Update Dockerfile port**

Edit `09-density-terrain/Dockerfile`:

```dockerfile
FROM node:20-bullseye-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5182

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5182"]
```

- [ ] **Step 4: Add docker-compose service**

Append to `docker-compose.yml` immediately after the `spline-terrain:` block, before the `networks:` section:

```yaml
  density-terrain:
    build:
      context: ./09-density-terrain
    container_name: density_terrain
    ports:
      - "5182:5182"
    volumes:
      - ./09-density-terrain:/app
      - density_terrain_modules:/app/node_modules
    networks:
      - app-network
```

And add to the `volumes:` block at the bottom:

```yaml
  density_terrain_modules:
```

- [ ] **Step 5: Update README header**

Replace the first paragraph of `09-density-terrain/README.md` with:

```markdown
# 09 — Density Terrain

Prototype: replace 08's heightmap pipeline with a 3D density field. Splines drive `(offset, factor, jaggedness)` 2D fields; density is sampled on a coarse cell grid and trilerped per voxel. Caves, cliffs, and overhangs all emerge from the single density field.

See `docs/superpowers/specs/2026-05-10-09-density-terrain-design.md` for the design.

Port: 5182.
```

- [ ] **Step 6: Install and verify dev server runs**

```bash
cd 09-density-terrain
npm install
npm run build
```

Expected: build exits 0.

- [ ] **Step 7: Commit**

```bash
git add 09-density-terrain docker-compose.yml
git commit -m "feat(09): scaffold density-terrain from 08"
```

---

### Task 2: Add `DensityParams` and `useDensityPipeline` flag to `GenerationParams`

The flag lets the legacy heightmap path coexist with the new density path during build-up. Density params are populated up-front so all later tasks can read them.

**Files:**
- Modify: `09-density-terrain/src/generationParams.ts`

- [ ] **Step 1: Add `DensityParams` interface**

After the `OreParams` interface (around line 55), insert:

```typescript
export interface DensityParams {
  /** fBm3D frequency divisor for the jaggedness term. Larger = smoother peaks. */
  jaggedScale: number;
  /** Vertical falloff for the jaggedness envelope around offset(x,z). */
  jaggedFalloff: number;
  /** fBm octaves for the jaggedness noise. */
  jaggedOctaves: number;
  /** fBm3D frequency divisor for the cave noises. */
  caveScale: number;
  /** Threshold for cave intersection (|n| < t inside tunnels, mapped to caveMask). */
  caveThreshold: number;
  /** Cave term reaches full strength `caveDepthRange` voxels below sea level. */
  caveDepthRange: number;
  /** Lower clamp on factor(x,z). */
  factorMin: number;
  /** Upper clamp on factor(x,z). */
  factorMax: number;
}
```

- [ ] **Step 2: Add fields to `GenerationParams`**

Locate the `GenerationParams` interface (around line 85) and add two fields after `vegetation`:

```typescript
  density: DensityParams;
  /** When true, chunk.ts uses the 3D density pipeline; when false, the legacy heightmap pipeline. */
  useDensityPipeline: boolean;
```

- [ ] **Step 3: Add defaults to `DEFAULT_PARAMS`**

Inside `DEFAULT_PARAMS` (after `vegetation` block, before the closing `};`), add:

```typescript
  density: {
    jaggedScale: 80,
    jaggedFalloff: 24,
    jaggedOctaves: 3,
    caveScale: 60,
    caveThreshold: 0.08,
    caveDepthRange: 32,
    factorMin: 0.5,
    factorMax: 6.0,
  },
  useDensityPipeline: false,
```

- [ ] **Step 4: Verify build**

```bash
cd 09-density-terrain
npm run build
```

Expected: build exits 0. The dev server (if running) should show terrain identical to 08 since the flag is off.

- [ ] **Step 5: Commit**

```bash
git add 09-density-terrain/src/generationParams.ts
git commit -m "feat(09): add DensityParams + useDensityPipeline flag (off by default)"
```

---

### Task 3: Create `offsetFactor.ts`

Pure 2D module: given climate sample, returns `(offset, factor, jaggedness)`. Reused interpretation of the existing 08 splines without changing their data shape.

**Files:**
- Create: `09-density-terrain/src/offsetFactor.ts`
- Modify: `09-density-terrain/src/main.ts` (temporary sanity log)

- [ ] **Step 1: Create the module**

Create `09-density-terrain/src/offsetFactor.ts`:

```typescript
import { createClimateSampler, type ClimateSample } from "./climate";
import { evalSpline, evalAnchored } from "./splines";
import type { GenerationParams } from "./generationParams";

export interface ColumnFields {
  offset: number;
  factor: number;
  jaggedness: number;
}

export interface OffsetFactorSampler {
  sampleClimate(wx: number, wz: number): ClimateSample;
  fieldsFromClimate(sample: ClimateSample): ColumnFields;
  fieldsAt(wx: number, wz: number): ColumnFields;
  /** Soft surface y at (wx, wz) — equals offset, the y where ground "wants to be". */
  offsetAt(wx: number, wz: number): number;
}

export function createOffsetFactorSampler(
  seed: number,
  params: GenerationParams,
): OffsetFactorSampler {
  const sampleClimate = createClimateSampler(seed, params.climate);
  const shape = params.shape.shape;
  const { factorMin, factorMax } = params.density;

  function fieldsFromClimate(sample: ClimateSample): ColumnFields {
    const { continentalness, erosion, peaksValleys } = sample;

    // continent spline → primary offset
    const offsetBase = evalSpline(shape.continent, continentalness);

    // erosionByContinent → adds to offset and contributes to factor
    const eroAdj = evalAnchored(shape.erosionByContinent, continentalness, erosion);

    // pvByErosion → adds to offset and contributes to jaggedness
    const pvAdj = evalAnchored(shape.pvByErosion, erosion, peaksValleys);

    const offset = offsetBase + eroAdj * 0.4 + pvAdj * 0.2;

    // factor: high when erosion is low (sharp cliffs / mountains)
    // erosion in ~[-1, 1]; map -1 → factorMax, 1 → factorMin
    const factorRaw = factorMax + (factorMin - factorMax) * (erosion * 0.5 + 0.5);
    const factor = Math.max(factorMin, Math.min(factorMax, factorRaw));

    // jaggedness: high when peaks-and-valleys is high AND erosion is low
    // pv in ~[-1, 1]; erosion shrinks amplitude when high
    const erosionDamp = Math.max(0, 1 - (erosion * 0.5 + 0.5));
    const jaggedness = Math.max(0, peaksValleys) * erosionDamp;

    return { offset, factor, jaggedness };
  }

  function fieldsAt(wx: number, wz: number): ColumnFields {
    return fieldsFromClimate(sampleClimate(wx, wz));
  }

  function offsetAt(wx: number, wz: number): number {
    return fieldsAt(wx, wz).offset;
  }

  return { sampleClimate, fieldsFromClimate, fieldsAt, offsetAt };
}
```

- [ ] **Step 2: Add a temporary sanity log in `main.ts`**

Find the line in `main.ts` where `DEFAULT_CONFIG` or `DEFAULT_PARAMS` is first used, and immediately after it add:

```typescript
if (import.meta.env.DEV) {
  // TEMP: offsetFactor sanity check
  const { createOffsetFactorSampler } = await import("./offsetFactor");
  const sampler = createOffsetFactorSampler(42, DEFAULT_PARAMS);
  console.log("[09 sanity] offsetFactor at origin:", sampler.fieldsAt(0, 0));
  console.log("[09 sanity] offsetFactor at (1000, 1000):", sampler.fieldsAt(1000, 1000));
  console.log("[09 sanity] offsetFactor at (-2000, 500):", sampler.fieldsAt(-2000, 500));
}
```

(If `main.ts`'s top-level isn't `async`, wrap in an IIFE: `(async () => { ... })();`)

- [ ] **Step 3: Verify**

```bash
cd 09-density-terrain
npm run build
npm run dev
```

Open the browser and check the console. Expected: three lines like `{ offset: <number>, factor: <number 0.5–6.0>, jaggedness: <number ≥ 0> }`. `factor` must be within `[factorMin, factorMax]`. `jaggedness` must be ≥ 0.

- [ ] **Step 4: Commit**

```bash
git add 09-density-terrain/src/offsetFactor.ts 09-density-terrain/src/main.ts
git commit -m "feat(09): offsetFactor sampler — splines → (offset, factor, jaggedness)"
```

---

### Task 4: Create `densityField.ts`

Single-point density evaluation given a column-fields sampler and 3D noise.

**Files:**
- Create: `09-density-terrain/src/densityField.ts`
- Modify: `09-density-terrain/src/main.ts` (extend sanity log)

- [ ] **Step 1: Create the module**

Create `09-density-terrain/src/densityField.ts`:

```typescript
import { createNoise } from "./perlin";
import type { OffsetFactorSampler, ColumnFields } from "./offsetFactor";
import type { GenerationParams } from "./generationParams";

export interface DensitySampler {
  /** Sample density at world (wx, wy, wz). Solid iff return >= 0. */
  sampleDensity(wx: number, wy: number, wz: number): number;
  /** Same, but with an already-computed column-fields value (avoids redundant 2D work). */
  densityFromFields(fields: ColumnFields, wx: number, wy: number, wz: number): number;
}

export function createDensitySampler(
  seed: number,
  params: GenerationParams,
  offsetFactor: OffsetFactorSampler,
  waterLevel: number,
): DensitySampler {
  const jaggedNoise = createNoise(seed + 30);
  const caveNoiseA  = createNoise(seed + 31);
  const caveNoiseB  = createNoise(seed + 32);
  const d = params.density;

  function caveStrength(wy: number): number {
    // 0 above sea level, 1 at sea level - caveDepthRange, 0 below bedrock
    const minHeight = params.extent.minHeight;
    if (wy >= waterLevel) return 0;
    if (wy <= minHeight + 4) return 0;
    const depth = waterLevel - wy;
    const ramp = Math.min(1, depth / d.caveDepthRange);
    const bedrockFalloff = Math.min(1, (wy - minHeight - 4) / 8);
    return ramp * bedrockFalloff;
  }

  function densityFromFields(
    fields: ColumnFields,
    wx: number,
    wy: number,
    wz: number,
  ): number {
    const { offset, factor, jaggedness } = fields;

    const base = (offset - wy) * factor;

    const dy = Math.abs(wy - offset);
    const envelope = Math.max(0, 1 - dy / d.jaggedFalloff);
    const jagged = jaggedness * envelope * jaggedNoise.fbm3D(
      wx / d.jaggedScale, wy / d.jaggedScale, wz / d.jaggedScale,
      d.jaggedOctaves, 0.5, 2.0,
    );

    let cave = 0;
    const cs = caveStrength(wy);
    if (cs > 0) {
      const n1 = caveNoiseA.fbm3D(wx / d.caveScale, wy / d.caveScale, wz / d.caveScale, 2, 0.5, 2.0);
      const n2 = caveNoiseB.fbm3D(wx / d.caveScale, wy / d.caveScale, wz / d.caveScale, 2, 0.5, 2.0);
      const m = Math.max(0, d.caveThreshold - Math.max(Math.abs(n1), Math.abs(n2)));
      // Multiply by factor so caves match local terrain "hardness" scale.
      cave = cs * m * factor * 8;
    }

    return base + jagged - cave;
  }

  function sampleDensity(wx: number, wy: number, wz: number): number {
    return densityFromFields(offsetFactor.fieldsAt(wx, wz), wx, wy, wz);
  }

  return { sampleDensity, densityFromFields };
}
```

- [ ] **Step 2: Extend the sanity log in `main.ts`**

After the existing offsetFactor logs, append:

```typescript
  const { createDensitySampler } = await import("./densityField");
  const density = createDensitySampler(42, DEFAULT_PARAMS, sampler, DEFAULT_CONFIG.waterLevel);
  console.log("[09 sanity] density deep underground (0, -100, 0):", density.sampleDensity(0, -100, 0).toFixed(2), "(should be > 0)");
  console.log("[09 sanity] density high in sky (0, 200, 0):", density.sampleDensity(0, 200, 0).toFixed(2), "(should be < 0)");
  console.log("[09 sanity] density at offset (column 1000,1000):");
  const f = sampler.fieldsAt(1000, 1000);
  console.log("  offset=", f.offset.toFixed(2), "density at y=offset:", density.sampleDensity(1000, f.offset, 1000).toFixed(2), "(should be ≈ 0 ± jaggedness)");
```

- [ ] **Step 3: Verify**

```bash
cd 09-density-terrain
npm run build
npm run dev
```

Open the browser console. Expected:
- "deep underground": positive (large positive number).
- "high in sky": negative (large negative number).
- "at y=offset": small magnitude (within roughly ±jaggedness × 1).

- [ ] **Step 4: Commit**

```bash
git add 09-density-terrain/src/densityField.ts 09-density-terrain/src/main.ts
git commit -m "feat(09): density formula (offset/factor base + jagged + cave)"
```

---

### Task 5: Create `chunkDensity.ts`

Per-chunk density evaluation: 5×3×5 corner grid, trilerp to per-voxel solid mask.

**Files:**
- Create: `09-density-terrain/src/chunkDensity.ts`
- Modify: `09-density-terrain/src/main.ts` (extend sanity log)

- [ ] **Step 1: Create the module**

Create `09-density-terrain/src/chunkDensity.ts`:

```typescript
import { CHUNK_SIZE } from "./chunk";
import type { DensitySampler } from "./densityField";
import type { OffsetFactorSampler, ColumnFields } from "./offsetFactor";

const CELL_X = 4;
const CELL_Y = 8;
const CELL_Z = 4;
const CORNERS_X = CHUNK_SIZE / CELL_X + 1; // 5
const CORNERS_Y = CHUNK_SIZE / CELL_Y + 1; // 3
const CORNERS_Z = CHUNK_SIZE / CELL_Z + 1; // 5

/**
 * Returns a Uint8Array of length CHUNK_SIZE^3 with 1 at solid voxels, 0 at air voxels.
 * Density is evaluated at 5x3x5 = 75 corner samples, then trilinearly interpolated
 * per voxel (sign-tested only — no scalar density retained).
 */
export function fillChunkDensity(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  offsetFactor: OffsetFactorSampler,
  density: DensitySampler,
  /** Pre-computed column fields for the 16x16 footprint, length CHUNK_SIZE^2, indexed lz*CHUNK_SIZE+lx. */
  columnFields: ColumnFields[],
): Uint8Array {
  const solid = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  const wxOff = chunkX * CHUNK_SIZE;
  const wyOff = chunkY * CHUNK_SIZE;
  const wzOff = chunkZ * CHUNK_SIZE;

  // Step 1: corner densities (75 samples).
  const corners = new Float32Array(CORNERS_X * CORNERS_Y * CORNERS_Z);
  for (let cz = 0; cz < CORNERS_Z; cz++) {
    const lz = cz * CELL_Z; // 0, 4, 8, 12, 16
    const wz = wzOff + lz;
    for (let cx = 0; cx < CORNERS_X; cx++) {
      const lx = cx * CELL_X; // 0, 4, 8, 12, 16
      const wx = wxOff + lx;
      // For lx in [0, 16): use precomputed columnFields. For lx == 16: sample fresh.
      const fields =
        lx < CHUNK_SIZE && lz < CHUNK_SIZE
          ? columnFields[lz * CHUNK_SIZE + lx]
          : offsetFactor.fieldsAt(wx, wz);
      for (let cy = 0; cy < CORNERS_Y; cy++) {
        const wy = wyOff + cy * CELL_Y;
        corners[(cy * CORNERS_Z + cz) * CORNERS_X + cx] =
          density.densityFromFields(fields, wx, wy, wz);
      }
    }
  }

  // Step 2: trilerp per voxel; sign-test → solid mask.
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const cy = (ly / CELL_Y) | 0;
    const ty = (ly - cy * CELL_Y) / CELL_Y;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const cz = (lz / CELL_Z) | 0;
      const tz = (lz - cz * CELL_Z) / CELL_Z;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const cx = (lx / CELL_X) | 0;
        const tx = (lx - cx * CELL_X) / CELL_X;

        const i000 = ((cy + 0) * CORNERS_Z + (cz + 0)) * CORNERS_X + (cx + 0);
        const i100 = ((cy + 0) * CORNERS_Z + (cz + 0)) * CORNERS_X + (cx + 1);
        const i010 = ((cy + 0) * CORNERS_Z + (cz + 1)) * CORNERS_X + (cx + 0);
        const i110 = ((cy + 0) * CORNERS_Z + (cz + 1)) * CORNERS_X + (cx + 1);
        const i001 = ((cy + 1) * CORNERS_Z + (cz + 0)) * CORNERS_X + (cx + 0);
        const i101 = ((cy + 1) * CORNERS_Z + (cz + 0)) * CORNERS_X + (cx + 1);
        const i011 = ((cy + 1) * CORNERS_Z + (cz + 1)) * CORNERS_X + (cx + 0);
        const i111 = ((cy + 1) * CORNERS_Z + (cz + 1)) * CORNERS_X + (cx + 1);

        const c00 = corners[i000] * (1 - tx) + corners[i100] * tx;
        const c10 = corners[i010] * (1 - tx) + corners[i110] * tx;
        const c01 = corners[i001] * (1 - tx) + corners[i101] * tx;
        const c11 = corners[i011] * (1 - tx) + corners[i111] * tx;
        const c0 = c00 * (1 - tz) + c10 * tz;
        const c1 = c01 * (1 - tz) + c11 * tz;
        const d  = c0 * (1 - ty) + c1 * ty;

        solid[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = d >= 0 ? 1 : 0;
      }
    }
  }

  return solid;
}
```

- [ ] **Step 2: Extend the sanity log in `main.ts`**

Append after the previous logs:

```typescript
  const { fillChunkDensity } = await import("./chunkDensity");
  const { CHUNK_SIZE } = await import("./chunk");

  // Build columnFields for chunk (0, ?, 0)
  function buildFields(cx: number, cz: number): ColumnFields[] {
    const out: ColumnFields[] = [];
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        out.push(sampler.fieldsAt(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz));
      }
    }
    return out;
  }
  const fields00 = buildFields(0, 0);

  // Deep underground chunk (cy = -8 → wy ∈ [-128, -113])
  const deepSolid = fillChunkDensity(0, -8, 0, sampler, density, fields00);
  let deepCount = 0;
  for (let i = 0; i < deepSolid.length; i++) deepCount += deepSolid[i];
  console.log(`[09 sanity] deep chunk (0, -8, 0): ${deepCount}/4096 solid (expect ≫ 3500)`);

  // Sky chunk (cy = 10 → wy ∈ [160, 175])
  const skySolid = fillChunkDensity(0, 10, 0, sampler, density, fields00);
  let skyCount = 0;
  for (let i = 0; i < skySolid.length; i++) skyCount += skySolid[i];
  console.log(`[09 sanity] sky chunk (0, 10, 0): ${skyCount}/4096 solid (expect 0)`);
```

- [ ] **Step 3: Verify**

```bash
cd 09-density-terrain
npm run build
npm run dev
```

Browser console expected:
- deep chunk: a number well above 3500 (most voxels solid; some may be cave).
- sky chunk: 0.

- [ ] **Step 4: Commit**

```bash
git add 09-density-terrain/src/chunkDensity.ts 09-density-terrain/src/main.ts
git commit -m "feat(09): chunkDensity — 5x3x5 corner grid + trilerp solid mask"
```

---

### Task 6: Add the density branch to `chunk.ts` (behind the flag)

Implements the full density pipeline as an alternative branch of `generateChunk`. The legacy heightmap branch is left untouched. The flag in params decides which runs.

**Files:**
- Modify: `09-density-terrain/src/chunk.ts`

- [ ] **Step 1: Add a top-level dispatcher**

Locate `export function generateChunk(...)` (around line 54). Rename it to `generateChunkLegacy` (the legacy heightmap path) — find/replace within that file only — and add a new `generateChunk` above it that dispatches:

```typescript
export function generateChunk(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  config: WorldConfig,
): ChunkResult {
  if (config.params.useDensityPipeline) {
    return generateChunkDensity(chunkX, chunkY, chunkZ, config);
  }
  return generateChunkLegacy(chunkX, chunkY, chunkZ, config);
}
```

- [ ] **Step 2: Import the new modules at the top of `chunk.ts`**

Add to the import block:

```typescript
import { createOffsetFactorSampler, type ColumnFields } from "./offsetFactor";
import { createDensitySampler } from "./densityField";
import { fillChunkDensity } from "./chunkDensity";
```

- [ ] **Step 3: Implement `generateChunkDensity`**

Append to the end of `chunk.ts` (after `generateChunkLegacy`):

```typescript
function generateChunkDensity(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  config: WorldConfig,
): ChunkResult {
  const { seed, waterLevel } = config;
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const wxOff = chunkX * CHUNK_SIZE;
  const wyOff = chunkY * CHUNK_SIZE;
  const wzOff = chunkZ * CHUNK_SIZE;

  // Re-use the same seed offsets the legacy branch used so visual identity
  // (ore positions, gravel patches, etc.) stays consistent across the swap.
  const layerNoise  = createNoise(seed);
  const gravelNoise = createNoise(seed);

  // ── 1. Climate sampling (per column) ──────────────────────────────
  const offsetFactor = createOffsetFactorSampler(seed, config.params);
  const density = createDensitySampler(seed, config.params, offsetFactor, waterLevel);
  const tempHumidSampler = createBiomeSampler(seed, config.params.biomes);

  const columnFields: ColumnFields[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
  const colTemp     = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colHumid    = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colContinent= new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colErosion  = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colPV       = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const biomes      = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const idx = lz * CHUNK_SIZE + lx;
      const sample = offsetFactor.sampleClimate(wx, wz);
      columnFields[idx] = offsetFactor.fieldsFromClimate(sample);
      const { temp, humid } = tempHumidSampler(wx, wz);
      biomes[idx] = classifyBiome(
        sample.continentalness, sample.erosion, sample.peaksValleys,
        temp, humid, config.params.biomePicker,
      );
      colTemp[idx]      = temp;
      colHumid[idx]     = humid;
      colContinent[idx] = sample.continentalness;
      colErosion[idx]   = sample.erosion;
      colPV[idx]        = sample.peaksValleys;
    }
  }

  // ── 2. Coarse density grid + trilerp → solid mask ─────────────────
  const solid = fillChunkDensity(chunkX, chunkY, chunkZ, offsetFactor, density, columnFields);

  // ── 3. Voxelize: solid → block, with depth tracked top-down per column.
  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let i = 0; i < heights.length; i++) heights[i] = -Infinity;

  // Track "depth below highest solid in this chunk's column", needed for surface/sub-surface/stone tiers.
  // We iterate y top-down so air voxels reset depth, and the first solid voxel becomes the surface.
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const colIdx = lz * CHUNK_SIZE + lx;
      const biomeId = biomes[colIdx];
      const biomeDef = BIOME_DEFS[biomeId];
      let depth = -1; // -1 means "no solid seen yet in this column"
      let surfaceWy = -Infinity;
      for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
        const wy = wyOff + ly;
        const voxIdx = chunkIndex(lx, ly, lz);
        const isSolid = solid[voxIdx] === 1;
        if (!isSolid) {
          depth = -1;
          data[voxIdx] = wy <= waterLevel ? Block.Water : Block.Air;
          continue;
        }
        if (depth === -1) {
          depth = 0;
          surfaceWy = wy;
          if (heights[colIdx] === -Infinity) heights[colIdx] = wy;
        }

        // Block selection
        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const layerVar = layerNoise.fbm2D(wx / 40, wz / 40, 3, 0.5, 2.0) * 3;

        let block: number;
        if (depth < 1) {
          block = biomeDef.surfaceBlock;
        } else if (depth < 5 + layerVar) {
          block = biomeDef.subSurfaceBlock;
        } else if (depth < 30 + layerVar) {
          block = Block.Stone;
        } else {
          block = Block.DeepStone;
        }

        // Snow cap on mountain peaks
        if (biomeId === Biome.Mountains && depth < 1 && surfaceWy > 30) {
          block = Block.Snow;
        }

        // Gravel patches on ocean floor
        if (biomeId === Biome.Ocean && depth < 2) {
          const gravelVal = gravelNoise.perlin2D(wx / 8, wz / 8);
          if (gravelVal > 0.3) block = Block.Gravel;
        }

        // Ice on water at water level in cold biomes — handled in a later water-surface pass.

        data[voxIdx] = block;
        depth++;
        // wy / wx / wz used above; nothing else needed here.
      }
    }
  }

  // ── 4. Patch up: ores, ice, aquifers, lava, glowstone, bedrock, structures, vegetation ──
  // (Filled in by Tasks 7–8.)

  const { grassColors } = computeBlendedGrassColors(
    wxOff, wzOff, CHUNK_SIZE,
    tempHumidSampler,
    (lx, lz) => biomes[lz * CHUNK_SIZE + lx] as BiomeId,
  );

  return { data, grassColors, heightMap: heights };
}
```

- [ ] **Step 4: Verify build (flag still off)**

```bash
cd 09-density-terrain
npm run build
```

Expected: build exits 0. Dev server still shows 08-equivalent terrain since the flag is off.

- [ ] **Step 5: Commit**

```bash
git add 09-density-terrain/src/chunk.ts
git commit -m "feat(09): density branch in chunk.ts (flag-gated, no decorations yet)"
```

---

### Task 7: Wire ores, ice, aquifers, lava, glowstone, bedrock into the density branch

Reuse the same passes as the legacy branch but operating on the density-built voxel grid. Same logic, just different source data.

**Files:**
- Modify: `09-density-terrain/src/chunk.ts`

- [ ] **Step 1: Add ore pass to `generateChunkDensity`**

After the voxelize loop (where `data[voxIdx] = block;` happens), but before the `computeBlendedGrassColors` call, insert:

```typescript
  // ── Ores — re-pass over Stone/DeepStone voxels ────────────────────
  const oreNoise = createNoise(seed + 2);
  const { ores } = config.params;
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = wyOff + ly;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const voxIdx = chunkIndex(lx, ly, lz);
        const b = data[voxIdx];
        if (b !== Block.Stone && b !== Block.DeepStone) continue;
        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const colIdx = lz * CHUNK_SIZE + lx;
        const surfaceH = heights[colIdx];
        if (surfaceH === -Infinity) continue;
        const depth = surfaceH - wy;
        const oreVal = oreNoise.fbm3D(wx / ores.scale, wy / ores.scale, wz / ores.scale, 2, 0.5, 2.0);
        if (oreVal > ores.ironThreshold && depth > ores.ironMinDepth) {
          data[voxIdx] = Block.Iron;
        } else if (oreVal > ores.coalThreshold && depth > 8) {
          data[voxIdx] = Block.Coal;
        }
      }
    }
  }
```

- [ ] **Step 2: Add ice pass for water-surface in cold biomes**

Append after the ore pass:

```typescript
  // ── Ice on water surface in cold biomes ───────────────────────────
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wy = waterLevel;
      if (wy < wyOff || wy >= wyOff + CHUNK_SIZE) continue;
      const ly = wy - wyOff;
      const voxIdx = chunkIndex(lx, ly, lz);
      if (data[voxIdx] !== Block.Water) continue;
      const biomeId = biomes[lz * CHUNK_SIZE + lx];
      if (biomeId === Biome.Tundra || biomeId === Biome.Taiga || biomeId === Biome.FrozenOcean) {
        data[voxIdx] = Block.Ice;
      }
    }
  }
```

- [ ] **Step 3: Add aquifer pass**

Append after the ice pass — same logic as legacy `chunk.ts:317-355`:

```typescript
  // ── Aquifers ──────────────────────────────────────────────────────
  const { aquifers } = config.params;
  if (aquifers.enabled) {
    const aquiferPresenceNoise = createNoise(seed + 13);
    const aquiferLevelNoise    = createNoise(seed + 14);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = wzOff + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = wxOff + lx;
        const colIdx = lz * CHUNK_SIZE + lx;
        if (heights[colIdx] !== -Infinity && heights[colIdx] <= waterLevel) continue;
        const rawLevel = waterLevel + aquifers.levelOffset
          + aquiferLevelNoise.fbm2D(
              wx / aquifers.levelScale,
              wz / aquifers.levelScale,
              2, 0.5, 2.0,
            ) * aquifers.levelAmplitude;
        const localSurface = Math.floor(rawLevel);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const wy = wyOff + ly;
          const voxIdx = chunkIndex(lx, ly, lz);
          if (data[voxIdx] !== Block.Air) continue;
          if (wy > localSurface) continue;
          const presence = aquiferPresenceNoise.fbm3D(
            wx / aquifers.presenceScale,
            wy / (aquifers.presenceScale * 2),
            wz / aquifers.presenceScale,
            2, 0.5, 2.0,
          );
          if (presence <= aquifers.presenceThreshold) continue;
          data[voxIdx] = Block.Water;
        }
      }
    }
  }

  // Surface block under water → sub-surface (grass → dirt under ponds)
  for (let ly = CHUNK_SIZE - 1; ly >= 1; ly--) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (data[chunkIndex(lx, ly, lz)] !== Block.Water) continue;
        const belowIdx = chunkIndex(lx, ly - 1, lz);
        const biomeDef = BIOME_DEFS[biomes[lz * CHUNK_SIZE + lx]];
        if (data[belowIdx] === biomeDef.surfaceBlock) {
          data[belowIdx] = biomeDef.subSurfaceBlock;
        }
      }
    }
  }
```

- [ ] **Step 4: Add lava + glowstone passes**

Append:

```typescript
  // ── Lava (deep chunks only) ───────────────────────────────────────
  if (chunkY <= -1) {
    const lavaNoise = createNoise(seed + 4);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
          const wx = wxOff + lx;
          const wz = wzOff + lz;
          const n = lavaNoise.perlin2D(wx / 20, wz / 20);
          if (n > 0.7) data[chunkIndex(lx, ly, lz)] = Block.Lava;
        }
      }
    }
  }

  // ── Glowstone on cave ceilings ────────────────────────────────────
  const glowstoneNoise = createNoise(seed + 8);
  for (let ly = 0; ly < CHUNK_SIZE - 1; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
        const above = data[chunkIndex(lx, ly + 1, lz)];
        const aboveDef = BLOCK_DEFS[above];
        if (!aboveDef || aboveDef.transparent) continue;
        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const n = glowstoneNoise.perlin2D(wx / 15, wz / 15);
        if (n > 0.65) data[chunkIndex(lx, ly, lz)] = Block.Glowstone;
      }
    }
  }
```

- [ ] **Step 5: Add bedrock pass**

Append:

```typescript
  // ── Bedrock floor ─────────────────────────────────────────────────
  const BEDROCK_BOTTOM = config.params.extent.minHeight;
  const BEDROCK_FUZZY_HEIGHT = 2;
  if (wyOff <= BEDROCK_BOTTOM + BEDROCK_FUZZY_HEIGHT && wyOff + CHUNK_SIZE > BEDROCK_BOTTOM) {
    const bedrockNoise = createNoise(seed + 15);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const wy = wyOff + ly;
      if (wy < BEDROCK_BOTTOM || wy > BEDROCK_BOTTOM + BEDROCK_FUZZY_HEIGHT) continue;
      const rowAbove = wy - BEDROCK_BOTTOM;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (rowAbove === 0) {
            data[chunkIndex(lx, ly, lz)] = Block.Bedrock;
          } else {
            const wx = wxOff + lx;
            const wz = wzOff + lz;
            const n = bedrockNoise.perlin2D((wx + rowAbove * 13) / 3, (wz + rowAbove * 17) / 3);
            const threshold = -0.66 + rowAbove * 0.5;
            if (n > threshold) data[chunkIndex(lx, ly, lz)] = Block.Bedrock;
          }
        }
      }
    }
  }
```

- [ ] **Step 6: Verify build**

```bash
cd 09-density-terrain
npm run build
```

Expected: build exits 0.

- [ ] **Step 7: Commit**

```bash
git add 09-density-terrain/src/chunk.ts
git commit -m "feat(09): ores/ice/aquifers/lava/glowstone/bedrock in density branch"
```

---

### Task 8: Wire structures + vegetation in the density branch (trees use soft offset)

Trees use the `offsetAt(wx, wz)` soft surface for both in-chunk and halo placement, per the §4 design decision.

**Files:**
- Modify: `09-density-terrain/src/chunk.ts`

- [ ] **Step 1: Add a `treeMask` and the structure pass**

Append to `generateChunkDensity` after the bedrock pass:

```typescript
  const treeMask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  // ── Structure placement (single chunk-center attempt) ──────────────
  const structNoise = createNoise(seed + 6);
  const structVal = structNoise.perlin2D(chunkX * 1.17, chunkZ * 1.17);
  const centerLx = Math.floor(CHUNK_SIZE / 2);
  const centerLz = Math.floor(CHUNK_SIZE / 2);
  const centerColIdx = centerLz * CHUNK_SIZE + centerLx;
  const centerBiome = biomes[centerColIdx];
  const centerSurfaceH = heights[centerColIdx];
  if (centerSurfaceH !== -Infinity) {
    const centerSurfLocal = Math.floor(centerSurfaceH) - wyOff;
    if (centerSurfLocal >= 4 && centerSurfLocal < CHUNK_SIZE - 8 && centerSurfaceH > waterLevel) {
      if (centerBiome === Biome.Desert && structVal > 0.7) {
        placePyramid(data, centerLx, centerSurfLocal, centerLz);
      } else if (centerBiome === Biome.Tundra && structVal > 0.55) {
        placeIgloo(data, centerLx, centerSurfLocal, centerLz);
      } else if ((centerBiome === Biome.Plains || centerBiome === Biome.Savanna) && structVal > 0.6) {
        placeHouse(data, centerLx, centerSurfLocal, centerLz);
        if (structVal > 0.4 && centerLx + 10 < CHUNK_SIZE - 1 && centerLz + 8 < CHUNK_SIZE - 1) {
          placeHouse(data, centerLx + 8, centerSurfLocal, centerLz + 6);
        }
      }
    }
  }
```

- [ ] **Step 2: Add the tree placement pass**

Append:

```typescript
  // ── Tree placement (soft-surface y for both in-chunk and halo) ─────
  const MAX_TREE_REACH = 10;
  const CANOPY_HALO = 2;
  const POISSON_RADIUS = 1;
  const NOISE_HALO = CANOPY_HALO + POISSON_RADIUS;
  const NOISE_SIDE = CHUNK_SIZE + 2 * NOISE_HALO;
  const treeNoise = createNoise(seed + 3);
  const candidate = new Uint8Array(NOISE_SIDE * NOISE_SIDE);
  const userVeg = config.params.vegetation.treeDensity;
  const GLOBAL_TREE_DENSITY = 0.40;

  for (let lz = -NOISE_HALO; lz < CHUNK_SIZE + NOISE_HALO; lz++) {
    for (let lx = -NOISE_HALO; lx < CHUNK_SIZE + NOISE_HALO; lx++) {
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const v = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
      if ((v + 1) * 0.5 < GLOBAL_TREE_DENSITY) {
        candidate[(lz + NOISE_HALO) * NOISE_SIDE + (lx + NOISE_HALO)] = 1;
      }
    }
  }

  function priorityHash(wx: number, wz: number): number {
    let h = (Math.imul(wx | 0, 374761393) ^ Math.imul(wz | 0, 668265263) ^ Math.imul(seed | 0, 2654435761)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function unitHash(wx: number, wz: number): number {
    let h = (Math.imul(wx | 0, 73856093) ^ Math.imul(wz | 0, 19349663) ^ Math.imul(seed | 0, 83492791)) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }

  function isSelected(lx: number, lz: number): boolean {
    const cIdx = (lz + NOISE_HALO) * NOISE_SIDE + (lx + NOISE_HALO);
    if (!candidate[cIdx]) return false;
    const wx = wxOff + lx;
    const wz = wzOff + lz;
    const p = priorityHash(wx, wz);
    for (let dz = -POISSON_RADIUS; dz <= POISSON_RADIUS; dz++) {
      for (let dx = -POISSON_RADIUS; dx <= POISSON_RADIUS; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nIdx = (lz + dz + NOISE_HALO) * NOISE_SIDE + (lx + dx + NOISE_HALO);
        if (!candidate[nIdx]) continue;
        const np = priorityHash(wx + dx, wz + dz);
        if (np >= p) return false;
      }
    }
    return true;
  }

  for (let lz = -CANOPY_HALO; lz < CHUNK_SIZE + CANOPY_HALO; lz++) {
    for (let lx = -CANOPY_HALO; lx < CHUNK_SIZE + CANOPY_HALO; lx++) {
      if (!isSelected(lx, lz)) continue;
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const inChunk = (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE);

      // Soft-surface lookup for both in-chunk and halo (design §4).
      const softY = offsetFactor.offsetAt(wx, wz);
      const surfaceH = softY;

      let biomeId: number;
      if (inChunk) {
        biomeId = biomes[lz * CHUNK_SIZE + lx];
      } else {
        const sample = offsetFactor.sampleClimate(wx, wz);
        const { temp, humid } = tempHumidSampler(wx, wz);
        biomeId = classifyBiome(
          sample.continentalness, sample.erosion, sample.peaksValleys,
          temp, humid, config.params.biomePicker,
        );
      }
      const biomeDef = BIOME_DEFS[biomeId];

      if (surfaceH <= waterLevel) continue;
      if (biomeId === Biome.Mountains && surfaceH > 30) continue;
      const surfaceLocal = Math.floor(surfaceH) - wyOff;

      if (biomeDef.cactus) {
        if (!inChunk) continue;
        const accept = Math.min(1, (0.04 * userVeg) / GLOBAL_TREE_DENSITY);
        if (unitHash(wx, wz) >= accept) continue;
        if (surfaceLocal < 0 || surfaceLocal >= CHUNK_SIZE - 1) continue;
        const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
        if (surfBlock !== biomeDef.surfaceBlock) continue;
        placeCactus(data, lx, surfaceLocal, lz, wx, wz);
        treeMask[lz * CHUNK_SIZE + lx] = 1;
        continue;
      }

      if (biomeDef.treeWood === null || biomeDef.treeLeaves === null) continue;

      const accept = Math.min(1, (biomeDef.treeDensity * userVeg) / GLOBAL_TREE_DENSITY);
      if (unitHash(wx, wz) >= accept) continue;

      if (surfaceLocal >= CHUNK_SIZE) continue;
      if (surfaceLocal + MAX_TREE_REACH < 0) continue;

      if (inChunk && surfaceLocal >= 0 && surfaceLocal < CHUNK_SIZE) {
        const surfIdx = chunkIndex(lx, surfaceLocal, lz);
        const sb = data[surfIdx];
        if (sb === Block.Air) {
          data[surfIdx] = biomeDef.surfaceBlock === Block.Snow ? Block.Snow : biomeDef.subSurfaceBlock;
        } else if (sb === biomeDef.surfaceBlock && sb !== Block.Snow) {
          data[surfIdx] = biomeDef.subSurfaceBlock;
        }
      }

      const wood = biomeDef.treeWood;
      const leaves = biomeDef.treeLeaves;
      if (wood === Block.SpruceWood) {
        placeSpruceTree(data, lx, surfaceLocal, lz, wood, leaves, wx, wz);
      } else if (wood === Block.BirchWood) {
        placeBirchTree(data, lx, surfaceLocal, lz, wood, leaves, wx, wz);
      } else {
        placeOakTree(data, lx, surfaceLocal, lz, wood, leaves, wx, wz);
      }

      if (inChunk) treeMask[lz * CHUNK_SIZE + lx] = 1;
    }
  }
```

- [ ] **Step 3: Add the surface-decoration pass**

Append:

```typescript
  // ── Surface decorations (flowers / tall grass / etc.) ──────────────
  if (config.params.vegetation.enabled) {
    const decoNoise = createNoise(seed + 16);
    const globalDensity = config.params.vegetation.globalDensity;
    for (let lz = 1; lz < CHUNK_SIZE - 1; lz++) {
      for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
        const colIdx = lz * CHUNK_SIZE + lx;
        const biomeDef = BIOME_DEFS[biomes[colIdx]];
        if (biomeDef.decorations.length === 0) continue;
        if (heights[colIdx] === -Infinity || heights[colIdx] <= waterLevel) continue;
        if (treeMask[colIdx]) continue;

        const surfaceLocal = Math.floor(heights[colIdx]) - wyOff;
        if (surfaceLocal < 0 || surfaceLocal >= CHUNK_SIZE - 1) continue;
        const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
        if (surfBlock !== biomeDef.surfaceBlock) continue;
        const aboveIdx = chunkIndex(lx, surfaceLocal + 1, lz);
        if (data[aboveIdx] !== Block.Air) continue;

        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const decoVal = (decoNoise.perlin2D(wx / 1.7, wz / 1.7) + 1) * 0.5;
        const threshold = biomeDef.decorationDensity * globalDensity;
        if (decoVal >= threshold) continue;

        let totalWeight = 0;
        for (const c of biomeDef.decorations) totalWeight += c.weight;
        const hash = ((wx * 374761393) ^ (wz * 668265263)) >>> 0;
        const r = ((hash % 100000) / 100000) * totalWeight;
        let acc = 0;
        let chosen: number = biomeDef.decorations[0].block;
        for (const c of biomeDef.decorations) {
          acc += c.weight;
          if (r < acc) { chosen = c.block; break; }
        }

        data[aboveIdx] = chosen;
      }
    }
  }
```

- [ ] **Step 4: Verify build**

```bash
cd 09-density-terrain
npm run build
```

Expected: build exits 0.

- [ ] **Step 5: Commit**

```bash
git add 09-density-terrain/src/chunk.ts
git commit -m "feat(09): structures + vegetation (soft-offset trees) in density branch"
```

---

### Task 9: Retune `DEFAULT_TERRAIN_SHAPE` for offset/factor/jaggedness semantics + flip flag

This is the visible flip. The legacy branch is now intentionally broken (defaults retuned) — so the flag default flips in the same task.

**Files:**
- Modify: `09-density-terrain/src/splines.ts`
- Modify: `09-density-terrain/src/generationParams.ts`

- [ ] **Step 1: Retune `DEFAULT_TERRAIN_SHAPE`**

Replace the `DEFAULT_TERRAIN_SHAPE` constant at the bottom of `09-density-terrain/src/splines.ts` with:

```typescript
export const DEFAULT_TERRAIN_SHAPE: TerrainShape = {
  // continent.y is now the OFFSET (where ground "wants to be" on the y axis).
  // Steep risers between flat plateaus → distinct ocean / shore / inland regimes.
  continent: [
    { x: -1.0, y: -45 },
    { x: -0.4, y: -30 },
    { x: -0.18, y:  -8 },
    { x: -0.12, y:   2 },
    { x:  0.05, y:   4 },
    { x:  0.10, y:  20 },
    { x:  0.45, y:  60 },
    { x:  1.0, y:  85 },
  ],
  // erosionByContinent.y contributes to offset (low erosion → small bonus)
  // and the SAMPLER applies a separate erosion → factor mapping.
  erosionByContinent: [
    { anchor: -0.2, spline: [{ x: -1, y:   2 }, { x: 0, y:  0 }, { x: 1, y:  -1 }] },
    { anchor:  0.4, spline: [{ x: -1, y:  18 }, { x: 0, y:  0 }, { x: 1, y:  -8 }] },
  ],
  // pvByErosion.y is the PEAKS-AND-VALLEYS magnitude that gets clamped to >= 0
  // and used as `jaggedness` amplitude on the 3D noise term.
  pvByErosion: [
    { anchor: -0.5, spline: [{ x: -1, y:  -2 }, { x: 0, y: 0.4 }, { x: 1, y:  1.0 }] },
    { anchor:  0.5, spline: [{ x: -1, y:  -1 }, { x: 0, y: 0.1 }, { x: 1, y:  0.3 }] },
  ],
};
```

- [ ] **Step 2: Flip the flag default**

In `09-density-terrain/src/generationParams.ts`, change:

```typescript
  useDensityPipeline: false,
```

to:

```typescript
  useDensityPipeline: true,
```

- [ ] **Step 3: Run dev server and validate visually**

```bash
cd 09-density-terrain
npm run dev
```

Browser checks (per spec §"Validation"):

1. **Flat region** — fly over a flat-looking biome (low jaggedness, e.g. plains). Expected: smooth terrain, similar feel to 08's plains.
2. **Mountain region** — fly to a mountain biome. Expected: visibly irregular peaks with cliffs / overhang silhouettes, NOT a smooth height curve.
3. **Ocean → shore → mountain transect** — pan across continentalness gradient. Expected: distinct regimes (deep ocean, flat shore plateau, mountainous inland).
4. **Density column probe (console)** — temporarily add to `main.ts`:
   ```typescript
   const { createDensitySampler } = await import("./densityField");
   const ofs = createOffsetFactorSampler(42, DEFAULT_PARAMS);
   const den = createDensitySampler(42, DEFAULT_PARAMS, ofs, 0);
   const f = ofs.fieldsAt(2000, 2000);
   const ys: number[] = [];
   let prev = den.densityFromFields(f, 2000, -50, 2000);
   for (let y = -49; y <= 100; y++) {
     const cur = den.densityFromFields(f, 2000, y, 2000);
     if ((prev >= 0) !== (cur >= 0)) ys.push(y);
     prev = cur;
   }
   console.log("[09 sanity] zero crossings at (2000,*,2000):", ys);
   ```
   Expected: at least one zero crossing; in mountain columns, possibly more than one (proves overhangs/caves possible).
5. **Tree at chunk seam** — find a tree whose canopy crosses a chunk boundary in jagged terrain. Expected: canopy renders cleanly, no obvious intersection with neighbor terrain (some 1-2 voxel float/sink is acceptable per spec).
6. **Performance** — open the browser console and watch the slow-chunk warnings from `worker.ts:52`. Most chunks should generate in < 50 ms; if many exceed 100 ms, note this for the cleanup task.

If the visual is broken (entirely solid, entirely air, single flat plane), see "Tuning notes" below before committing. Iterate by editing the spline values and `density` defaults in-place; commit only after the visual passes.

**Tuning notes (in case validation fails):**
- All air → check that base term sign convention is correct: `(offset - wy) * factor` should be POSITIVE below offset.
- All solid → check `factorMin` not too high; check jagged term sign.
- Flat surfaces only (no jaggedness) → check `pvByErosion` y-values are positive enough; check `jaggedFalloff` not too small.
- Floating solid in sky → reduce `jaggedFalloff` or check envelope clamp.

- [ ] **Step 4: Commit**

```bash
git add 09-density-terrain/src/splines.ts 09-density-terrain/src/generationParams.ts
git commit -m "feat(09): flip to density pipeline + retune splines for offset/factor/jaggedness"
```

---

### Task 10: Delete the legacy heightmap pipeline, erosion, rivers, and `terrainShape.ts`

The legacy `generateChunkLegacy` and the dispatcher flag are both dead code now. Removing them simplifies `chunk.ts` and locks in the new pipeline.

**Files:**
- Modify: `09-density-terrain/src/chunk.ts`
- Modify: `09-density-terrain/src/generationParams.ts`
- Modify: `09-density-terrain/src/main.ts`
- Delete: `09-density-terrain/src/terrainShape.ts`
- Delete: `09-density-terrain/src/erosion.ts`

- [ ] **Step 1: Inline `generateChunkDensity` as `generateChunk`**

In `09-density-terrain/src/chunk.ts`:
- Delete the dispatcher `generateChunk` function from Task 6 Step 1.
- Delete `generateChunkLegacy` and its entire body (the original 08 implementation).
- Rename `generateChunkDensity` → `generateChunk` (keep the same signature).
- Remove the now-unused imports: `createTerrainShaper` (was from `./terrainShape`), `erode`, `toErosionConfig`, `RiverParams`-related code, `riverNoise`, etc.

- [ ] **Step 2: Drop `useDensityPipeline` and erosion/rivers from `generationParams.ts`**

In `09-density-terrain/src/generationParams.ts`:
- Remove the `useDensityPipeline` field from `GenerationParams`.
- Remove the `useDensityPipeline: true,` line from `DEFAULT_PARAMS`.
- Remove `ErosionParams`, `erosion: ErosionParams;`, the erosion default block, and `toErosionConfig`.
- Remove `RiverParams`, `rivers: RiverParams;`, and the river default block.
- Remove `import { ErosionConfig, DEFAULT_EROSION } from "./erosion";`.

- [ ] **Step 3: Delete the legacy modules**

```bash
rm 09-density-terrain/src/terrainShape.ts
rm 09-density-terrain/src/erosion.ts
```

- [ ] **Step 4: Remove the temporary sanity logs from `main.ts`**

Strip the `if (import.meta.env.DEV) { ... }` block added in Tasks 3, 4, 5, and 9 Step 3.

- [ ] **Step 5: Verify build and dev server**

```bash
cd 09-density-terrain
npm run build
npm run dev
```

Expected: build exits 0. Visual identical to end of Task 9.

- [ ] **Step 6: Commit**

```bash
git add 09-density-terrain/src
git commit -m "chore(09): delete legacy heightmap pipeline, erosion, rivers, sanity logs"
```

---

### Task 11: Update `splineEditor.ts` labels

The spline data shape is unchanged but the meaning of each curve's y axis has shifted. UI labels need to match.

**Files:**
- Modify: `09-density-terrain/src/splineEditor.ts`

- [ ] **Step 1: Find and update labels**

Search `09-density-terrain/src/splineEditor.ts` for any of these strings and update:

| Old label | New label |
| --- | --- |
| "Continentalness → Height" | "Continentalness → Offset" |
| "Erosion → Height" | "Erosion → Offset (sub-spline; also drives factor)" |
| "Peaks & Valleys → Height" | "Peaks & Valleys → Jaggedness amplitude" |
| Any "Height" axis label on the editor canvas | "Offset" (for continent and erosion editors) or "Jaggedness" (for the PV editor) |

If labels are constructed from string concatenation, find the constants in the file and edit each.

- [ ] **Step 2: Verify**

```bash
cd 09-density-terrain
npm run build
npm run dev
```

Open the spline editor in the running app. Expected: new labels visible. Editing curves still works (the data shape is unchanged).

- [ ] **Step 3: Commit**

```bash
git add 09-density-terrain/src/splineEditor.ts
git commit -m "chore(09): relabel spline editor for offset/factor/jaggedness semantics"
```

---

### Task 12: Add a Density section to `debugPanel.ts`

Live-edit knobs for the density formula tuning.

**Files:**
- Modify: `09-density-terrain/src/debugPanel.ts`

- [ ] **Step 1: Locate the existing pattern**

Open `09-density-terrain/src/debugPanel.ts` and find an existing collapsible section (e.g., for `caves` or `aquifers`). Use it as a template — the panel uses a consistent pattern of `addNumber(...)` (or similar) calls bound to `params.<group>.<field>`.

- [ ] **Step 2: Add the Density section**

After the existing caves / aquifers section, add a new collapsible section "Density" with these sliders (use the same factory functions as neighboring sections):

```
Density
├─ jaggedScale       range 20  – 200, step 1
├─ jaggedFalloff     range 4   – 64,  step 1
├─ jaggedOctaves     range 1   – 6,   step 1 (integer)
├─ caveScale         range 20  – 160, step 1
├─ caveThreshold     range 0.0 – 0.3, step 0.005
├─ caveDepthRange    range 4   – 96,  step 1
├─ factorMin         range 0.1 – 4.0, step 0.05
└─ factorMax         range 1.0 – 12,  step 0.1
```

Each slider should write to `params.density.<field>` and trigger the same world re-render hook the existing knobs use.

- [ ] **Step 3: Verify**

```bash
cd 09-density-terrain
npm run dev
```

Open the debug panel. Expected: a "Density" section is visible; moving a slider visibly retunes the terrain on the next chunk regeneration.

- [ ] **Step 4: Commit**

```bash
git add 09-density-terrain/src/debugPanel.ts
git commit -m "feat(09): debug panel — Density section for live tuning"
```

---

### Task 13: Final README pass

**Files:**
- Modify: `09-density-terrain/README.md`

- [ ] **Step 1: Replace `09-density-terrain/README.md` with the full prototype writeup**

```markdown
# 09 — Density Terrain

Prototype: replace 08's heightmap pipeline with a unified 3D density field. Splines drive `(offset, factor, jaggedness)` 2D fields; density is sampled on a coarse 5×3×5 corner grid and trilerped per voxel. Caves, cliffs, plateaus, and overhangs all emerge from the single density field.

## How it works

For any world point `(x, y, z)`:

```
density = (offset(x,z) - y) * factor(x,z)
        + jaggedness(x,z) * envelope(y) * fbm3D(x, y, z)
        - cave(x, y, z)
```

Solid iff `density >= 0`. Splines from 08 are reinterpreted:

- **Continentalness → offset** — the y where ground "wants to be"
- **Erosion → factor** (cliff sharpness) and a small offset bonus
- **Peaks & valleys → jaggedness amplitude** on the 3D noise

## Knobs (debug panel → "Density")

- `jaggedScale` — fBm3D frequency for the silhouette noise
- `jaggedFalloff` — vertical falloff above/below offset (controls floating-rock prevention)
- `jaggedOctaves` — octave count
- `caveScale`, `caveThreshold`, `caveDepthRange` — cave network shape and depth distribution
- `factorMin`, `factorMax` — clamp range on the per-column factor

## Known prototype limitations

- **No erosion, no rivers** — both were heightmap-coupled in 08. Out of scope.
- **Cave-biome floor classification disabled** — the `pickBiome`-based floor system from 08 is tied to the legacy intersecting-noise cave carving and was not re-derived for density caves.
- **Trees use soft-surface (offset) y for both in-chunk and halo placement** — guarantees cross-chunk consistency for canopies but may visibly float or sink 1–2 voxels in jagged terrain.
- **`ChunkResult.heightMap` is the highest solid voxel y** — so walking off the edge of an overhang sees the heightmap "lie" (same approximation `walkController` lives with today).

## Files

- `src/offsetFactor.ts` — splines → `(offset, factor, jaggedness)` per column
- `src/densityField.ts` — single-point density formula
- `src/chunkDensity.ts` — coarse-grid corner sampling + trilerp → solid mask
- `src/chunk.ts` — voxelization, biomes, ores, caves (via density), structures, trees
- `src/splines.ts` — spline data shape (unchanged from 08; semantics retuned)

## Run

```
npm install
npm run dev   # http://localhost:5182
```

Or via Docker: `docker compose up density-terrain`.
```

- [ ] **Step 2: Verify build one last time**

```bash
cd 09-density-terrain
npm run build
```

Expected: build exits 0.

- [ ] **Step 3: Commit**

```bash
git add 09-density-terrain/README.md
git commit -m "docs(09): README writeup with knobs and known limitations"
```

---

## Final state

- `09-density-terrain/` exists as a working Vite project on port 5182.
- Density-driven terrain produces irregular peaks, cliffs, caves, and overhangs that 08 could not.
- Spline editor remains usable; debug panel exposes density tuning live.
- Erosion, rivers, and the legacy heightmap pipeline are gone from 09.
- README documents the formula, the knobs, and the four known prototype limitations.
