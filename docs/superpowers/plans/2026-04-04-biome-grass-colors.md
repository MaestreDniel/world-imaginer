# Biome Grass Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single flat grass color with per-biome grass colors derived from a programmatic temperature/humidity gradient, with smooth blending at biome edges.

**Architecture:** Add a `grassColorFromClimate()` function that maps (temperature, humidity) to RGB via bilinear interpolation. Extend the existing biome blending kernel to output weighted-average grass colors per column. Pass these through the worker pipeline to the mesher, which uses them instead of `BLOCK_DEFS` color for Grass blocks.

**Tech Stack:** TypeScript, Vite, Three.js (vertex colors), Web Workers

---

## File Map

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `src/blocks.ts` | Block registry | Remove `DeadGrass`, re-number IDs |
| `src/biomes.ts` | Climate→color gradient, per-biome cache, blended color output | Add functions, extend `computeBlendedBiomeParams` |
| `src/chunk.ts` | Chunk generation return type | Return `grassColors` alongside block data |
| `src/mesher.ts` | Vertex color lookup, greedy merge constraint | Accept + use `grassColors` |
| `src/worker.ts` | Worker message types and pipeline | Pass `grassColors` through |
| `src/world.ts` | Chunk storage | Store `grassColors`, forward to mesher (no change needed — meshing happens in worker) |

---

### Task 1: Remove DeadGrass block and update references

**Files:**
- Modify: `src/blocks.ts:26` (remove DeadGrass entry)
- Modify: `src/blocks.ts:64` (remove DeadGrass def)
- Modify: `src/biomes.ts:84` (change Savanna surfaceBlock)

- [ ] **Step 1: Remove DeadGrass from Block object**

In `src/blocks.ts`, remove the `DeadGrass` entry and re-number the blocks after it. The block object becomes:

```ts
export const Block = {
  Air:          0,
  Grass:        1,
  Dirt:         2,
  Stone:        3,
  DeepStone:    4,
  Sand:         5,
  Water:        6,
  Snow:         7,
  Coal:         8,
  Iron:         9,
  OakWood:     10,
  OakLeaves:   11,
  BirchWood:   12,
  BirchLeaves: 13,
  SpruceWood:  14,
  SpruceLeaves:15,
  Cactus:      16,
  RedSand:     17,
  Ice:         18,
  Gravel:      19,
  Sandstone:   20,
  SnowBrick:   21,
  OakPlanks:   22,
  Cobblestone: 23,
  Glass:       24,
} as const;
```

- [ ] **Step 2: Remove DeadGrass from BLOCK_DEFS**

In `src/blocks.ts`, remove the `[Block.DeadGrass]` entry from `BLOCK_DEFS`. All other entries use `Block.X` keys so they auto-adjust to the new numbering.

Also update the file header comment to remove the "DeadGrass" mention:

```ts
/**
 * Block definitions — expanded for biome variety.
 *
 * New blocks: Cactus, Red Sand, Ice, Packed Ice,
 * Oak/Birch/Spruce wood and leaves for biome-specific trees.
 */
```

- [ ] **Step 3: Update Savanna biome to use Block.Grass**

In `src/biomes.ts:84`, change:

```ts
surfaceBlock: Block.DeadGrass,
```

to:

```ts
surfaceBlock: Block.Grass,
```

- [ ] **Step 4: Verify build**

Run: `cd 07-advanced-terrain && npm run build`
Expected: Clean build with no errors

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/blocks.ts 07-advanced-terrain/src/biomes.ts
git commit -m "refactor: remove DeadGrass block, fold into Grass with biome coloring"
```

---

### Task 2: Add grass color gradient function and per-biome cache

**Files:**
- Modify: `src/biomes.ts` (add `grassColorFromClimate`, `BIOME_GRASS_COLORS`)

- [ ] **Step 1: Add the grassColorFromClimate function**

Add the following at the top of `src/biomes.ts`, after the existing imports:

```ts
/**
 * Grass color gradient — maps (temperature, humidity) to RGB.
 *
 * Uses bilinear interpolation across four corner colors:
 *   Hot+Dry  → sandy yellow-brown
 *   Hot+Wet  → bright warm green
 *   Cold+Dry → muted grey-green
 *   Cold+Wet → dark teal/turquoise green
 *
 * Temperature and humidity are normalized from their noise range
 * (roughly -0.5 to 0.5) to 0..1 for interpolation.
 */

// Corner colors as [R, G, B] in 0..255
const GRASS_HOT_DRY:  [number, number, number] = [160, 135, 75];   // sandy yellow-brown
const GRASS_HOT_WET:  [number, number, number] = [100, 180, 50];   // bright warm green
const GRASS_COLD_DRY: [number, number, number] = [120, 140, 110];  // muted grey-green
const GRASS_COLD_WET: [number, number, number] = [50, 140, 120];   // dark teal/turquoise

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map climate values to a grass RGB color.
 * @param temp  Temperature noise value (roughly -0.5 to 0.5)
 * @param humid Humidity noise value (roughly -0.5 to 0.5)
 * @returns Packed 0xRRGGBB color
 */
export function grassColorFromClimate(temp: number, humid: number): number {
  // Normalize to 0..1: -0.5 → 0, +0.5 → 1
  const t = clamp01(temp + 0.5);   // 0 = cold, 1 = hot
  const h = clamp01(humid + 0.5);  // 0 = dry, 1 = wet

  // Bilinear interpolation
  // Bottom edge (cold): cold_dry → cold_wet
  // Top edge (hot):     hot_dry  → hot_wet
  const r = Math.round(lerp(
    lerp(GRASS_COLD_DRY[0], GRASS_COLD_WET[0], h),
    lerp(GRASS_HOT_DRY[0],  GRASS_HOT_WET[0],  h),
    t,
  ));
  const g = Math.round(lerp(
    lerp(GRASS_COLD_DRY[1], GRASS_COLD_WET[1], h),
    lerp(GRASS_HOT_DRY[1],  GRASS_HOT_WET[1],  h),
    t,
  ));
  const b = Math.round(lerp(
    lerp(GRASS_COLD_DRY[2], GRASS_COLD_WET[2], h),
    lerp(GRASS_HOT_DRY[2],  GRASS_HOT_WET[2],  h),
    t,
  ));

  return (r << 16) | (g << 8) | b;
}
```

- [ ] **Step 2: Add per-biome grass color cache**

Below the gradient function, add a lookup table that maps each biome to its representative grass color. The (temp, humidity) midpoints are derived from the thresholds in `biomeFromNoise`:

```ts
/**
 * Pre-computed grass color for each biome, based on representative
 * (temperature, humidity) midpoint from the biome threshold grid.
 *
 * Biomes that don't use Grass as surfaceBlock still get a color here
 * so that blending math works uniformly.
 */
export const BIOME_GRASS_COLORS: Record<number, number> = {
  [Biome.Ocean]:       grassColorFromClimate(0.0, 0.0),
  [Biome.Beach]:       grassColorFromClimate(0.0, 0.0),
  [Biome.Desert]:      grassColorFromClimate(0.35, -0.2),    // hot, dry
  [Biome.Savanna]:     grassColorFromClimate(0.35, 0.3),     // hot, humid
  [Biome.Plains]:      grassColorFromClimate(0.0, -0.3),     // mild, dry-ish
  [Biome.Forest]:      grassColorFromClimate(0.0, 0.35),     // mild, humid
  [Biome.BirchForest]: grassColorFromClimate(0.0, 0.05),     // mild, moderate
  [Biome.Taiga]:       grassColorFromClimate(-0.3, 0.2),     // cold, humid
  [Biome.Tundra]:      grassColorFromClimate(-0.3, -0.15),   // cold, dry
  [Biome.Mountains]:   grassColorFromClimate(-0.1, 0.0),     // cool, neutral
};
```

- [ ] **Step 3: Verify build**

Run: `cd 07-advanced-terrain && npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/biomes.ts
git commit -m "feat: add grass color gradient function and per-biome color cache"
```

---

### Task 3: Extend biome blending to output grass colors

**Files:**
- Modify: `src/biomes.ts:208-272` (`computeBlendedBiomeParams`)

- [ ] **Step 1: Add grassColors to return type and computation**

Modify `computeBlendedBiomeParams` to also return a `grassColors: Uint32Array`. Inside the existing kernel loop (which already iterates over the blend kernel and tracks `biomeCounts`), accumulate weighted grass color components and store the blended result.

The updated function signature and return type:

```ts
export function computeBlendedBiomeParams(
  worldXOff: number,
  worldZOff: number,
  chunkSize: number,
  getBiome: (wx: number, wz: number) => BiomeId,
): {
  blendedScales: Float64Array;
  blendedOffsets: Float64Array;
  dominantBiomes: Uint8Array;
  grassColors: Uint32Array;
}
```

Inside the function, after the existing `biomeCounts.fill(0)` line, add accumulators:

```ts
let totalR = 0, totalG = 0, totalB = 0;
```

Inside the existing kernel inner loop, after `biomeCounts[biome]++`, add:

```ts
const gc = BIOME_GRASS_COLORS[biome];
totalR += (gc >> 16) & 0xFF;
totalG += (gc >> 8) & 0xFF;
totalB += gc & 0xFF;
```

After the dominant biome selection, compute the blended color:

```ts
const avgR = Math.round(totalR / kernelArea);
const avgG = Math.round(totalG / kernelArea);
const avgB = Math.round(totalB / kernelArea);
grassColors[idx] = (avgR << 16) | (avgG << 8) | avgB;
```

Declare `grassColors` alongside `blendedScales`:

```ts
const grassColors = new Uint32Array(chunkSize * chunkSize);
```

Add `grassColors` to the return statement.

- [ ] **Step 2: Verify build**

Run: `cd 07-advanced-terrain && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add 07-advanced-terrain/src/biomes.ts
git commit -m "feat: extend biome blending to output per-column grass colors"
```

---

### Task 4: Update chunk generation to return grass colors

**Files:**
- Modify: `src/chunk.ts:42-340` (`generateChunk`)

- [ ] **Step 1: Change generateChunk return type and value**

Update the return type from `ChunkData` to `{ data: ChunkData; grassColors: Uint32Array }`.

At the top of `generateChunk`, the `computeBlendedBiomeParams` call already destructures its result. Add `grassColors` to the destructuring:

```ts
const { blendedScales, blendedOffsets, dominantBiomes, grassColors } = computeBlendedBiomeParams(
  worldXOff, worldZOff, CHUNK_SIZE, getBiome,
);
```

Change the return statement at the end from:

```ts
return data;
```

to:

```ts
return { data, grassColors };
```

- [ ] **Step 2: Verify build**

Run: `cd 07-advanced-terrain && npm run build`
Expected: Build errors in `worker.ts` (it calls `generateChunk` and expects `Uint8Array`). This is expected — Task 5 fixes it.

- [ ] **Step 3: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat: return grassColors from generateChunk"
```

---

### Task 5: Update worker to pass grass colors through

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Add grassColors to WorkerResponse**

In the `WorkerResponse` interface, add:

```ts
grassColors: Uint32Array;
```

- [ ] **Step 2: Update worker message handler**

Update the `self.onmessage` handler. The `generateChunk` call now returns an object:

Change:

```ts
const data = generateChunk(cx, cy, cz, config);
```

to:

```ts
const { data, grassColors } = generateChunk(cx, cy, cz, config);
```

Add `grassColors` to both the empty and non-empty response objects.

For the empty response:

```ts
const resp: WorkerResponse = {
  id, cx, cy, cz,
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  empty: true,
  blockData: data,
  grassColors,
};
self.postMessage(resp, { transfer: [data.buffer, grassColors.buffer] });
```

- [ ] **Step 3: Update mesher call to pass grassColors**

The worker calls `buildChunkMesh(data, getNeighbor)`. Update to:

```ts
const mesh = buildChunkMesh(data, getNeighbor, grassColors);
```

- [ ] **Step 4: Update non-empty response to include grassColors**

In the non-empty response path:

```ts
const resp: WorkerResponse = {
  id, cx, cy, cz,
  positions, normals, colors, indices,
  empty: false,
  blockData: data,
  grassColors,
};

self.postMessage(resp, {
  transfer: [
    positions.buffer,
    normals.buffer,
    colors.buffer,
    indices.buffer,
    data.buffer,
    grassColors.buffer,
  ],
});
```

- [ ] **Step 5: Verify build**

Run: `cd 07-advanced-terrain && npm run build`
Expected: Build errors in `mesher.ts` (signature mismatch). This is expected — Task 6 fixes it.

- [ ] **Step 6: Commit**

```bash
git add 07-advanced-terrain/src/worker.ts
git commit -m "feat: pass grassColors through worker pipeline"
```

---

### Task 6: Update mesher to use per-column grass colors

**Files:**
- Modify: `src/mesher.ts:36` (`buildChunkMesh` signature)
- Modify: `src/mesher.ts:100-180` (greedy merge loop)

- [ ] **Step 1: Add grassColors parameter**

Update the `buildChunkMesh` signature:

```ts
export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
): MeshData {
```

- [ ] **Step 2: Add Block import**

Add `Block` to the import from `"./blocks"`:

```ts
import { BLOCK_DEFS, Block } from "./blocks";
```

- [ ] **Step 3: Update color lookup for grass blocks**

In the greedy merge section, after `const blockId = val - 1;` (around line 123), replace the color extraction block:

```ts
const def = BLOCK_DEFS[blockId];
const r = ((def.color >> 16) & 255) / 255;
const g = ((def.color >> 8) & 255) / 255;
const b = (def.color & 255) / 255;
```

with:

```ts
const def = BLOCK_DEFS[blockId];
let color = def.color;

// For grass blocks, use the per-column biome-derived color
if (blockId === Block.Grass) {
  // Recover the column (u, v) from the starting position
  const colPos = [0, 0, 0];
  colPos[axis] = d;
  colPos[u] = i;
  colPos[v] = j;
  color = grassColors[colPos[2] * CHUNK_SIZE + colPos[0]];
}

const r = ((color >> 16) & 255) / 255;
const g = ((color >> 8) & 255) / 255;
const b = (color & 255) / 255;
```

- [ ] **Step 4: Add grass color check to greedy width expansion**

In the width expansion loop, change:

```ts
while (i + w < CHUNK_SIZE && mask[j * CHUNK_SIZE + i + w] === val) w++;
```

to:

```ts
while (i + w < CHUNK_SIZE && mask[j * CHUNK_SIZE + i + w] === val) {
  // For grass blocks, stop merging if the column's grass color differs
  if (blockId === Block.Grass) {
    const wPos = [0, 0, 0];
    wPos[axis] = d;
    wPos[u] = i + w;
    wPos[v] = j;
    if (grassColors[wPos[2] * CHUNK_SIZE + wPos[0]] !== color) break;
  }
  w++;
}
```

- [ ] **Step 5: Add grass color check to greedy height expansion**

In the height expansion loop, inside the inner `for (let k = 0; k < w; k++)` loop, after the existing mask value check, add a grass color check:

```ts
let done = false;
while (j + h < CHUNK_SIZE && !done) {
  for (let k = 0; k < w; k++) {
    if (mask[(j + h) * CHUNK_SIZE + i + k] !== val) {
      done = true;
      break;
    }
    // For grass, also check color consistency
    if (blockId === Block.Grass) {
      const hPos = [0, 0, 0];
      hPos[axis] = d;
      hPos[u] = i + k;
      hPos[v] = j + h;
      if (grassColors[hPos[2] * CHUNK_SIZE + hPos[0]] !== color) {
        done = true;
        break;
      }
    }
  }
  if (!done) h++;
}
```

- [ ] **Step 6: Verify build**

Run: `cd 07-advanced-terrain && npm run build`
Expected: Clean build with no errors

- [ ] **Step 7: Commit**

```bash
git add 07-advanced-terrain/src/mesher.ts
git commit -m "feat: use per-column grass colors in mesher with merge constraints"
```

---

### Task 7: Visual verification and tuning

**Files:**
- No file changes expected — this is a manual verification step

- [ ] **Step 1: Run the dev server**

Run: `cd 07-advanced-terrain && npm run dev`

- [ ] **Step 2: Verify grass colors per biome**

Walk between biomes and confirm:
- Plains: moderate green
- Forest: vivid green (high humidity)
- Birch Forest: slightly different green than Forest
- Taiga: cool teal-green tint
- Savanna: warm brownish-green (formerly DeadGrass)

- [ ] **Step 3: Verify edge blending**

Walk across a biome boundary (e.g., Plains→Forest) and confirm grass color transitions smoothly over ~9 blocks rather than changing abruptly.

- [ ] **Step 4: Tune corner colors if needed**

If any biome's grass color looks off, adjust the four corner constants in `src/biomes.ts`:
- `GRASS_HOT_DRY` — sandy yellow-brown
- `GRASS_HOT_WET` — bright warm green
- `GRASS_COLD_DRY` — muted grey-green
- `GRASS_COLD_WET` — dark teal/turquoise

Or adjust the per-biome representative midpoints in `BIOME_GRASS_COLORS`.

- [ ] **Step 5: Commit any tuning changes**

```bash
git add 07-advanced-terrain/src/biomes.ts
git commit -m "chore: tune biome grass colors"
```
