# 07 Advanced Terrain — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build project `07-advanced-terrain` that adds domain warping, Voronoi/Worley noise, and hydraulic erosion simulation to the existing 3D voxel pipeline, producing dramatically more natural-looking terrain while keeping the blocky Minecraft aesthetic.

**Architecture:** Fork from project 06 (biome blending) as the baseline. The noise library (`perlin.ts`) is extended with Voronoi noise and domain warping utilities. A new `erosion.ts` module applies particle-based hydraulic erosion to a 2D heightmap *before* it's voxelised. The chunk generator calls: (1) Voronoi-based continent shapes, (2) domain-warped fBm for local detail, (3) erosion simulation on the heightmap, then (4) existing voxel fill / cave / structure passes. All heavy computation stays in Web Workers.

**Tech Stack:** TypeScript, Vite, Three.js, Web Workers (same as 06).

---

## Phase 0: Chunk Size Change

All tasks in this plan use `CHUNK_SIZE = 16` instead of 32. When copying from project 06, update `chunk.ts` early:

```typescript
export const CHUNK_SIZE = 16;
```

This halves chunk volume (16^3 = 4096 vs 32^3 = 32768), which significantly speeds up erosion and meshing per chunk — important given the heavier generation pipeline. It also means the render radius and vertical Y range may need adjustment (wider radius, more Y layers) to keep the same visible area. Adjust `world.ts` Y range from `[-1, 2]` to `[-2, 4]` and default render radius from 8 to 16 to compensate.

---

## Phase 1: Project Scaffolding

### Task 1: Copy project 06 as the 07 base

**Files:**
- Create: `07-advanced-terrain/` (full copy of `06-biome-blending/`)
- Modify: `07-advanced-terrain/package.json`
- Modify: `07-advanced-terrain/index.html`
- Modify: `07-advanced-terrain/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Step 1: Copy the project directory**

```bash
cp -r 06-biome-blending 07-advanced-terrain
rm -rf 07-advanced-terrain/node_modules 07-advanced-terrain/dist
```

**Step 2: Update package.json**

Change `"name"` to `"07-advanced-terrain"`.

**Step 3: Update index.html title**

Change `<title>` to `07 - Advanced Terrain`.

**Step 4: Update Dockerfile**

Change `EXPOSE` and `--port` to `5180`.

**Step 5: Add entry to docker-compose.yml**

```yaml
  advanced-terrain:
    build:
      context: ./07-advanced-terrain
    container_name: advanced_terrain
    ports:
      - "5180:5180"
    volumes:
      - ./07-advanced-terrain:/app
      - advanced_terrain_modules:/app/node_modules
    networks:
      - app-network
```

Add `advanced_terrain_modules:` to the `volumes:` section at the bottom.

**Step 6: Update README.md**

Add row:
```
| 07 | [Advanced Terrain](./07-advanced-terrain) | Domain warping, Voronoi noise, and hydraulic erosion |
```

**Step 7: Change chunk size to 16 and adjust world Y range**

In `07-advanced-terrain/src/chunk.ts`:
```typescript
export const CHUNK_SIZE = 16;
```

In `07-advanced-terrain/src/world.ts`, update the Y layer range to compensate:
```typescript
const minCY = -2;
const maxCY = 4;
```

In `07-advanced-terrain/src/main.ts`, update default render radius slider value to `16` and the HTML `<input>` default to match.

In `07-advanced-terrain/index.html`:
```html
<input type="range" id="radius" min="1" max="64" value="16" />
```

**Step 8: Install dependencies and verify build**

```bash
cd 07-advanced-terrain && npm install && npm run build
```

Expected: clean compile, identical behavior to project 06.

**Step 9: Commit**

```bash
git add 07-advanced-terrain docker-compose.yml README.md
git commit -m "scaffold: copy project 06 as 07-advanced-terrain base with CHUNK_SIZE=16"
```

---

## Phase 2: Voronoi / Worley Noise

Voronoi (Worley) noise produces cell-based patterns by computing distance to the nearest random feature point in a grid. It's excellent for continent outlines, river networks, and biome territories. We add it to the noise library so it can be used by any subsequent noise pipeline.

### Task 2: Add Voronoi noise to perlin.ts

**Files:**
- Modify: `07-advanced-terrain/src/perlin.ts`

**Step 1: Add Voronoi 2D function to the `createNoise` return**

Add these functions inside `createNoise()`, after `fbm3D`:

```typescript
/**
 * Voronoi / Worley noise — 2D.
 *
 * Divides the plane into a grid of cells. Each cell contains one
 * pseudo-random feature point (jittered from cell center using the
 * seeded permutation table). Returns the distance to the Nth closest
 * feature point (n=0 → closest, n=1 → second closest).
 *
 * Common uses:
 * - F1 (n=0): rounded cell shapes — continent blobs, biome territories
 * - F2-F1 (difference): Voronoi edges — river networks, cracks
 */
function voronoi2D(x: number, y: number): { f1: number; f2: number; cellX: number; cellY: number } {
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  let f1 = 1e10;
  let f2 = 1e10;
  let nearestCellX = 0;
  let nearestCellY = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;

      // Deterministic jitter from permutation table
      const h = p[((cx & 255) + p[(cy & 255)]) & 511];
      const jx = (h & 15) / 15.0;        // 0..1
      const jy = ((h >> 4) & 15) / 15.0; // 0..1

      const fx = cx + jx;
      const fy = cy + jy;

      const distSq = (x - fx) * (x - fx) + (y - fy) * (y - fy);

      if (distSq < f1) {
        f2 = f1;
        f1 = distSq;
        nearestCellX = cx;
        nearestCellY = cy;
      } else if (distSq < f2) {
        f2 = distSq;
      }
    }
  }

  return {
    f1: Math.sqrt(f1),
    f2: Math.sqrt(f2),
    cellX: nearestCellX,
    cellY: nearestCellY,
  };
}
```

**Step 2: Export voronoi2D from the return object**

Change the return statement:

```typescript
return { perlin2D, perlin3D, fbm2D, fbm3D, voronoi2D };
```

**Step 3: Verify build**

```bash
cd 07-advanced-terrain && npm run build
```

Expected: clean compile.

**Step 4: Commit**

```bash
git add 07-advanced-terrain/src/perlin.ts
git commit -m "feat: add Voronoi/Worley 2D noise to noise library"
```

---

### Task 3: Use Voronoi for continent shapes

Replace the simple fBm continent noise in the biome sampler with Voronoi-based continent shapes. This produces organic landmass outlines with clear coastlines instead of the smooth fBm blobs.

**Files:**
- Modify: `07-advanced-terrain/src/biomes.ts`

**Step 1: Update `createBiomeSampler`**

Replace the continent sampling in `sampleNoise`:

```typescript
export function createBiomeSampler(seed: number) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  function sampleNoise(wx: number, wz: number) {
    // Voronoi F2-F1 at large scale produces organic continent edges.
    // F2-F1 → 0 at cell boundaries (coastlines), large in cell interiors.
    const v = continentNoise.voronoi2D(wx / 500, wz / 500);
    const edgeDist = v.f2 - v.f1; // 0 at boundary, ~0.5+ in interior

    // Map to continent value: interior → land (positive), edge → coast/ocean (negative)
    // fBm perturbation breaks up straight Voronoi edges
    const perturbation = continentNoise.fbm2D(wx / 200, wz / 200, 3, 0.5, 2.0) * 0.15;
    const continent = (edgeDist - 0.25) * 2.0 + perturbation;

    const temp = tempNoise.fbm2D(wx / 300, wz / 300, 4, 0.5, 2.0);
    const humid = humidNoise.fbm2D(wx / 300, wz / 300, 4, 0.5, 2.0);
    return { continent, temp, humid };
  }
```

**Step 2: Update `createBiomeDebugSampler` with the same continent logic**

Mirror the Voronoi continent calculation so the debug overlay matches.

**Step 3: Verify build and visually check**

```bash
cd 07-advanced-terrain && npm run build
```

Run `npm run dev` and visually confirm that continents now have more organic, cell-based coastline shapes rather than smooth blobs.

**Step 4: Commit**

```bash
git add 07-advanced-terrain/src/biomes.ts
git commit -m "feat: use Voronoi noise for organic continent shapes"
```

---

## Phase 3: Domain Warping

Domain warping feeds noise output *back into itself* as coordinate offsets, producing twisted, alien landscapes. This is the single most impactful visual upgrade per line of code. We apply it to the terrain heightmap in `chunk.ts`.

### Task 4: Add domain warping utility to perlin.ts

**Files:**
- Modify: `07-advanced-terrain/src/perlin.ts`

**Step 1: Add `warpedFbm2D` inside `createNoise`**

```typescript
/**
 * Domain-warped fBm — the "Inigo Quilez" technique.
 *
 * Instead of sampling fBm(x, y), we sample:
 *   fBm(x + fBm(x, y), y + fBm(x + 5.2, y + 1.3))
 *
 * The inner fBm offsets distort the coordinate space, producing
 * swirling, organic patterns. Increasing `iterations` stacks more
 * warps (each feeds into the next), amplifying the effect.
 *
 * warpStrength controls how far coordinates are displaced (in noise
 * units). Values of 2-4 produce dramatic cliff formations.
 */
function warpedFbm2D(
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  warpStrength: number,
  iterations: number = 1,
): number {
  let wx = x;
  let wy = y;

  for (let i = 0; i < iterations; i++) {
    const offsetX = fbm2D(wx, wy, octaves, persistence, lacunarity);
    const offsetY = fbm2D(wx + 5.2, wy + 1.3, octaves, persistence, lacunarity);
    wx = x + offsetX * warpStrength;
    wy = y + offsetY * warpStrength;
  }

  return fbm2D(wx, wy, octaves, persistence, lacunarity);
}
```

**Step 2: Export warpedFbm2D**

```typescript
return { perlin2D, perlin3D, fbm2D, fbm3D, voronoi2D, warpedFbm2D };
```

**Step 3: Verify build**

```bash
cd 07-advanced-terrain && npm run build
```

**Step 4: Commit**

```bash
git add 07-advanced-terrain/src/perlin.ts
git commit -m "feat: add domain warping utility (warpedFbm2D)"
```

---

### Task 5: Apply domain warping to terrain heightmap

Replace the plain `fbm2D` height sampling in `chunk.ts` with `warpedFbm2D`. This produces dramatic cliff formations, twisted mountain ridges, and more organic terrain shapes.

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

**Step 1: Replace the height computation in the column loop**

Find the existing height computation (around line 72):

```typescript
const baseNoise = noise.fbm2D(wx / 80, wz / 80, 5, 0.5, 2.0);
heights[idx] = baseHeight + blendedOffsets[idx] + baseNoise * 20 * blendedScales[idx];
```

Replace with:

```typescript
// Domain-warped fBm: produces dramatic cliff formations and organic shapes
// warpStrength=3 + 1 iteration gives strong but not chaotic distortion
const baseNoise = noise.warpedFbm2D(
  wx / 80, wz / 80,
  5, 0.5, 2.0,
  /* warpStrength */ 3.0,
  /* iterations */ 1,
);
heights[idx] = baseHeight + blendedOffsets[idx] + baseNoise * 20 * blendedScales[idx];
```

**Step 2: Verify build and visually check**

```bash
cd 07-advanced-terrain && npm run build
```

Run `npm run dev`. Terrain should now have visibly twisted ridges, curved cliff faces, and more dramatic formations, especially in Mountains biome.

**Step 3: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat: apply domain warping to terrain heightmap"
```

---

## Phase 4: Hydraulic Erosion Simulation

Hydraulic erosion is the most computationally involved feature. A virtual water droplet is spawned at a random point, follows the gradient downhill, picks up sediment where it flows fast, and deposits it where it slows down. After thousands of droplets, the heightmap develops realistic ridges, valleys, and alluvial fans.

The key challenge: erosion needs to operate on a *continuous* 2D heightmap, but our terrain is generated per-chunk in workers. Solution: each chunk generates a *padded* heightmap (chunk + margin on all sides), runs erosion on that padded region, then uses only the inner chunk-sized portion for voxelisation. The padding ensures erosion effects at chunk edges look continuous.

### Task 6: Create the erosion module

**Files:**
- Create: `07-advanced-terrain/src/erosion.ts`

**Step 1: Write the hydraulic erosion simulator**

```typescript
/**
 * Particle-based hydraulic erosion.
 *
 * Each droplet carries water and sediment. It flows downhill following
 * the heightmap gradient. Where it's moving fast (steep slope), it
 * erodes terrain; where it slows (flat areas, depressions), it deposits.
 *
 * Key parameters:
 * - droplets: total simulated particles (more = smoother, slower)
 * - erosionRate: how aggressively droplets carve into terrain
 * - depositionRate: how quickly sediment settles
 * - evaporationRate: water loss per step (limits droplet lifetime)
 * - gravity: slope-to-speed conversion factor
 *
 * The heightmap is mutated in place.
 *
 * Reference: Sebastian Lague's "Hydraulic Erosion" implementation
 * https://github.com/SebLague/Hydraulic-Erosion
 */

export interface ErosionConfig {
  droplets: number;
  maxLifetime: number;
  inertia: number;       // 0-1, how much of old direction to keep
  erosionRate: number;
  depositionRate: number;
  evaporationRate: number;
  gravity: number;
  minSlope: number;      // prevents infinite erosion on flat areas
  erosionRadius: number; // radius of erosion brush
}

export const DEFAULT_EROSION: ErosionConfig = {
  droplets: 2000,
  maxLifetime: 64,
  inertia: 0.3,
  erosionRate: 0.3,
  depositionRate: 0.3,
  evaporationRate: 0.02,
  gravity: 10,
  minSlope: 0.01,
  erosionRadius: 2,
};

/**
 * Get height at a floating-point position using bilinear interpolation.
 */
function sampleHeight(map: Float64Array, size: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  if (xi < 0 || xi >= size - 1 || yi < 0 || yi >= size - 1) {
    const cx = Math.max(0, Math.min(size - 1, xi));
    const cy = Math.max(0, Math.min(size - 1, yi));
    return map[cy * size + cx];
  }

  const fx = x - xi;
  const fy = y - yi;
  const h00 = map[yi * size + xi];
  const h10 = map[yi * size + xi + 1];
  const h01 = map[(yi + 1) * size + xi];
  const h11 = map[(yi + 1) * size + xi + 1];

  return h00 * (1 - fx) * (1 - fy)
       + h10 * fx * (1 - fy)
       + h01 * (1 - fx) * fy
       + h11 * fx * fy;
}

/**
 * Compute gradient (dh/dx, dh/dy) at a floating-point position.
 */
function sampleGradient(map: Float64Array, size: number, x: number, y: number): [number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  if (xi < 0 || xi >= size - 1 || yi < 0 || yi >= size - 1) {
    return [0, 0];
  }

  const fx = x - xi;
  const fy = y - yi;
  const h00 = map[yi * size + xi];
  const h10 = map[yi * size + xi + 1];
  const h01 = map[(yi + 1) * size + xi];
  const h11 = map[(yi + 1) * size + xi + 1];

  const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
  const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

  return [gx, gy];
}

/**
 * Precompute erosion brush weights for a given radius.
 * Returns arrays of relative offsets and corresponding weights.
 */
function buildBrush(radius: number): { offsets: [number, number][]; weights: number[] } {
  const offsets: [number, number][] = [];
  const weights: number[] = [];
  let total = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const w = Math.max(0, radius - dist);
        offsets.push([dx, dy]);
        weights.push(w);
        total += w;
      }
    }
  }

  for (let i = 0; i < weights.length; i++) weights[i] /= total;

  return { offsets, weights };
}

/**
 * Run hydraulic erosion on a heightmap in place.
 *
 * @param map      Float64Array of size*size heights (row-major, z*size+x)
 * @param size     Width and height of the heightmap
 * @param config   Erosion parameters
 * @param rngSeed  Deterministic seed for droplet placement
 */
export function erode(
  map: Float64Array,
  size: number,
  config: ErosionConfig = DEFAULT_EROSION,
  rngSeed: number = 42,
): void {
  const { offsets, weights } = buildBrush(config.erosionRadius);

  // Simple LCG for deterministic droplet positions
  let s = rngSeed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  const margin = config.erosionRadius + 1;

  for (let drop = 0; drop < config.droplets; drop++) {
    // Spawn droplet at random position (avoid edges)
    let posX = margin + rng() * (size - 2 * margin);
    let posY = margin + rng() * (size - 2 * margin);
    let dirX = 0;
    let dirY = 0;
    let speed = 0;
    let water = 1;
    let sediment = 0;

    for (let life = 0; life < config.maxLifetime; life++) {
      const xi = Math.floor(posX);
      const yi = Math.floor(posY);

      if (xi < margin || xi >= size - margin || yi < margin || yi >= size - margin) break;

      const oldHeight = sampleHeight(map, size, posX, posY);
      const [gx, gy] = sampleGradient(map, size, posX, posY);

      // Update direction with inertia
      dirX = dirX * config.inertia - gx * (1 - config.inertia);
      dirY = dirY * config.inertia - gy * (1 - config.inertia);

      // Normalise direction
      const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
      if (dirLen < 1e-8) break; // stuck in a pit
      dirX /= dirLen;
      dirY /= dirLen;

      // Move
      const newX = posX + dirX;
      const newY = posY + dirY;
      const newHeight = sampleHeight(map, size, newX, newY);
      const heightDiff = newHeight - oldHeight;

      // Capacity: how much sediment water can carry (more when fast and steep)
      const slope = Math.max(-heightDiff, config.minSlope);
      const capacity = Math.max(slope * speed * water * 8, config.minSlope);

      if (sediment > capacity || heightDiff > 0) {
        // Deposit sediment
        const depositAmount = heightDiff > 0
          ? Math.min(sediment, heightDiff) // fill up to new height when going uphill
          : (sediment - capacity) * config.depositionRate;

        sediment -= depositAmount;

        // Deposit on the 4 surrounding cells (bilinear)
        const fx = posX - xi;
        const fy = posY - yi;
        map[yi * size + xi]           += depositAmount * (1 - fx) * (1 - fy);
        map[yi * size + xi + 1]       += depositAmount * fx * (1 - fy);
        map[(yi + 1) * size + xi]     += depositAmount * (1 - fx) * fy;
        map[(yi + 1) * size + xi + 1] += depositAmount * fx * fy;
      } else {
        // Erode terrain using the brush
        const erodeAmount = Math.min(
          (capacity - sediment) * config.erosionRate,
          -heightDiff + 0.001, // don't erode below new position
        );

        for (let b = 0; b < offsets.length; b++) {
          const [bx, by] = offsets[b];
          const mx = xi + bx;
          const my = yi + by;
          if (mx >= 0 && mx < size && my >= 0 && my < size) {
            map[my * size + mx] -= erodeAmount * weights[b];
          }
        }

        sediment += erodeAmount;
      }

      // Update speed and water
      speed = Math.sqrt(Math.max(0, speed * speed + heightDiff * config.gravity));
      water *= (1 - config.evaporationRate);

      posX = newX;
      posY = newY;
    }
  }
}
```

**Step 2: Verify build**

```bash
cd 07-advanced-terrain && npm run build
```

**Step 3: Commit**

```bash
git add 07-advanced-terrain/src/erosion.ts
git commit -m "feat: add particle-based hydraulic erosion module"
```

---

### Task 7: Integrate erosion into chunk generation

The tricky part: erosion needs context beyond the chunk boundary. We generate a padded heightmap (chunk + 8 blocks margin on each side), run erosion on it, then extract the inner region. The margin means erosion effects bleed naturally across chunk seams.

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

**Step 1: Import erosion**

At the top of `chunk.ts`:

```typescript
import { erode, DEFAULT_EROSION } from "./erosion";
```

**Step 2: Add erosion config to WorldConfig**

```typescript
export interface WorldConfig {
  seed: number;
  waterLevel: number;
  baseHeight: number;
  enableErosion: boolean;
  erosionDroplets: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 42,
  waterLevel: 0,
  baseHeight: 0,
  enableErosion: true,
  erosionDroplets: 1500,
};
```

**Step 3: Refactor generateChunk to apply erosion**

After computing `heights[]` (the column height loop at ~line 66-74) and before the "Fill voxels" section, add the erosion pass:

```typescript
// ── Erosion pass ─────────────────────────────────────────────────
// Generate a padded heightmap, run erosion on it, then copy
// the inner region back to heights[].
if (config.enableErosion) {
  const ERODE_PAD = 8;
  const padSize = CHUNK_SIZE + 2 * ERODE_PAD;
  const paddedMap = new Float64Array(padSize * padSize);

  // Fill padded heightmap — recompute heights for the margin area
  for (let pz = 0; pz < padSize; pz++) {
    for (let px = 0; px < padSize; px++) {
      const wx = worldXOff - ERODE_PAD + px;
      const wz = worldZOff - ERODE_PAD + pz;

      // For cells inside the chunk, use precomputed values
      const lx = px - ERODE_PAD;
      const lz = pz - ERODE_PAD;
      if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
        paddedMap[pz * padSize + px] = heights[lz * CHUNK_SIZE + lx];
      } else {
        // Recompute for margin cells
        const marginBiome = getBiome(wx, wz);
        const marginDef = BIOME_DEFS[marginBiome];
        const marginNoise = noise.warpedFbm2D(
          wx / 80, wz / 80,
          5, 0.5, 2.0, 3.0, 1,
        );
        paddedMap[pz * padSize + px] = baseHeight + marginDef.heightOffset + marginNoise * 20 * marginDef.heightScale;
      }
    }
  }

  // Run erosion
  erode(paddedMap, padSize, {
    ...DEFAULT_EROSION,
    droplets: config.erosionDroplets,
  }, seed + chunkX * 73856093 + chunkZ * 19349663);

  // Copy eroded heights back
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      heights[lz * CHUNK_SIZE + lx] = paddedMap[(lz + ERODE_PAD) * padSize + (lx + ERODE_PAD)];
    }
  }
}
```

**Step 4: Verify build**

```bash
cd 07-advanced-terrain && npm run build
```

**Step 5: Visual test**

Run `npm run dev`. Terrain should show erosion valleys, smoother ridgelines, and sediment deposits in flat areas. Mountains biome will have the most dramatic effect.

**Step 6: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat: integrate hydraulic erosion into chunk generation pipeline"
```

---

## Phase 5: UI Controls & Polish

### Task 8: Add UI toggles for new features

Let the user toggle domain warping and erosion on/off for comparison, and tweak erosion droplet count.

**Files:**
- Modify: `07-advanced-terrain/index.html`
- Modify: `07-advanced-terrain/src/main.ts`

**Step 1: Add controls to index.html toolbar**

After the debug checkbox, add:

```html
<label class="control" style="cursor:pointer"><input type="checkbox" id="erosion" checked /> Erosion</label>
<div class="control">
  <label>Droplets: <span id="droplets-val">1500</span></label>
  <input type="range" id="droplets" min="0" max="5000" step="250" value="1500" />
</div>
```

**Step 2: Wire up in main.ts**

Add element references:

```typescript
const erosionToggle   = document.getElementById("erosion")      as HTMLInputElement;
const dropletsSlider  = document.getElementById("droplets")     as HTMLInputElement;
const dropletsVal     = document.getElementById("droplets-val")!;
```

Pass config when creating world:

```typescript
let world = new World(scene, {
  seed: currentSeed,
  enableErosion: erosionToggle.checked,
  erosionDroplets: Number(dropletsSlider.value),
});
```

Update regenerate function to read current toggle states:

```typescript
function regenerate() {
  // ... existing seed logic ...
  world.dispose();
  world = new World(scene, {
    seed: currentSeed,
    enableErosion: erosionToggle.checked,
    erosionDroplets: Number(dropletsSlider.value),
  });
  // ... rest ...
}
```

Add slider listener:

```typescript
dropletsSlider.addEventListener("input", () => {
  dropletsVal.textContent = String(dropletsSlider.value);
});
```

**Step 3: Add debug overlay info for warp/erosion**

In the debug overlay section of the animation loop, add after existing debug info:

```typescript
`Erosion: ${config.enableErosion ? 'ON' : 'OFF'} (${config.erosionDroplets} drops)<br>` +
```

(Where `config` is obtained from `world.config`.)

**Step 4: Verify build and test UI**

```bash
cd 07-advanced-terrain && npm run build
```

Toggle erosion off → terrain should revert to smooth domain-warped fBm. Increasing droplets → more carved valleys.

**Step 5: Commit**

```bash
git add 07-advanced-terrain/index.html 07-advanced-terrain/src/main.ts
git commit -m "feat: add UI controls for erosion toggle and droplet count"
```

---

### Task 9: Add Voronoi river channels

Use Voronoi F2-F1 as a secondary carving pass: where F2-F1 is near zero (cell boundaries), lower the heightmap to create natural river channels that follow the Voronoi cell edges.

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

**Step 1: Add river carving after the main height computation but before erosion**

After the height loop and before the erosion section:

```typescript
// ── River channels from Voronoi edges ────────────────────────────
// Voronoi F2-F1 → 0 at cell boundaries. We use this to carve
// river-like channels into the terrain. Only below a depth threshold
// so rivers don't cut through mountain peaks.
const riverNoise = createNoise(seed + 7);
for (let lz = 0; lz < CHUNK_SIZE; lz++) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    const wx = worldXOff + lx;
    const wz = worldZOff + lz;
    const idx = lz * CHUNK_SIZE + lx;

    const v = riverNoise.voronoi2D(wx / 200, wz / 200);
    const edgeDist = v.f2 - v.f1; // 0 at edges

    // Carve where edge distance is small — creates river-width channels
    if (edgeDist < 0.08) {
      const carveStrength = (1 - edgeDist / 0.08); // 1 at center, 0 at edges
      const currentHeight = heights[idx];
      // Only carve into terrain that's near/above water level
      if (currentHeight > waterLevel - 2) {
        // Carve down toward water level, creating river beds
        const maxCarve = 6 * carveStrength * carveStrength;
        heights[idx] = Math.max(waterLevel - 2, currentHeight - maxCarve);
      }
    }
  }
}
```

**Step 2: Verify build**

```bash
cd 07-advanced-terrain && npm run build
```

**Step 3: Visual test**

Run `npm run dev`. Look for narrow winding channels filled with water cutting through land biomes. They should follow organic Voronoi cell boundary paths.

**Step 4: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat: add Voronoi-based river channels"
```

---

### Task 10: Performance tuning and final polish

Erosion is the most expensive addition. Ensure the worker pool handles it without freezing the UI, and tune default parameters for a good visual/perf tradeoff.

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts` (tune constants)
- Modify: `07-advanced-terrain/src/erosion.ts` (if needed)

**Step 1: Profile chunk generation time**

Add a timing log in the worker:

```typescript
// In worker.ts, wrap generateChunk:
const t0 = performance.now();
const data = generateChunk(cx, cy, cz, config);
const t1 = performance.now();
if (t1 - t0 > 100) console.warn(`Slow chunk (${cx},${cy},${cz}): ${(t1 - t0).toFixed(0)}ms`);
```

**Step 2: Adjust default erosion parameters if chunks are too slow**

Target: <200ms per chunk on a mid-range CPU. If chunks take longer:
- Reduce `DEFAULT_EROSION.droplets` from 2000 → 1500 or 1000
- Reduce `DEFAULT_EROSION.maxLifetime` from 64 → 48
- Reduce `erosionRadius` from 2 → 1

**Step 3: Verify final build**

```bash
cd 07-advanced-terrain && npm run build
```

**Step 4: Run and walk around the world**

Test all biomes, verify:
- Voronoi coastlines look organic
- Domain warping creates interesting terrain features
- Erosion valleys are visible in mountainous areas
- Rivers follow winding paths through terrain
- No visual glitches at chunk boundaries
- Walk mode collision still works
- FPS stays above 30 with radius 8

**Step 5: Final commit**

```bash
git add 07-advanced-terrain/
git commit -m "polish: performance tuning and chunk generation profiling"
```

---

## Summary of new files and key modifications

| File | Action | Content |
|---|---|---|
| `07-advanced-terrain/` | Create | Full project, forked from 06 |
| `src/perlin.ts` | Modify | Add `voronoi2D`, `warpedFbm2D` |
| `src/erosion.ts` | Create | Particle-based hydraulic erosion |
| `src/biomes.ts` | Modify | Voronoi-based continent shapes |
| `src/chunk.ts` | Modify | Domain warp heights, river channels, erosion pass |
| `src/main.ts` | Modify | UI controls for erosion toggle/droplets |
| `index.html` | Modify | New toolbar controls |
| `src/worker.ts` | Modify | Perf timing |
| `docker-compose.yml` | Modify | Add service entry |
| `README.md` | Modify | Add project row |

**Generation pipeline order (in `generateChunk`):**
1. Biome blending (existing)
2. Domain-warped fBm heights (Task 5)
3. Voronoi river channels (Task 9)
4. Hydraulic erosion (Task 7)
5. Voxel fill, caves, ores (existing)
6. Structures (existing)
