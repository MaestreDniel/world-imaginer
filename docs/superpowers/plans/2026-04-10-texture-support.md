# Texture Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat vertex-color block rendering in `07-advanced-terrain` with image-based textures using a procedural placeholder atlas that can be swapped for a real PNG later.

**Architecture:** A 128×128 `CanvasTexture` atlas (8×8 grid of 16×16 tiles) is built at startup. The greedy mesher is replaced with a per-face quad emitter that assigns UV coordinates pointing to each block's tile. Vertex colors are kept (white for untinted blocks, biome-tinted for grass) so `map × vertexColors` blends correctly in `MeshLambertMaterial`.

**Tech Stack:** Three.js, TypeScript (strict), Vite, Web Workers (worker runs a subset of source files — no DOM or THREE.js allowed in files imported by `worker.ts`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/blocks.ts` | Modify | Add `ATLAS_COLS`, `ATLAS_ROWS`, `ATLAS_TILE_SIZE`, `TILE_IDS`, and `tiles` field to `BlockDef`/`BLOCK_DEFS` |
| `src/textureAtlas.ts` | Create | Draw all placeholder tiles onto a canvas; return `THREE.CanvasTexture` |
| `src/mesher.ts` | Modify | Replace greedy merge with per-face quad emitter; emit `uvs` |
| `src/worker.ts` | Modify | Add `uvs: Float32Array` to `WorkerResponse`; pack and transfer it |
| `src/world.ts` | Modify | Build atlas, pass it to material, upload `uv` geometry attribute |

> **Worker constraint:** `worker.ts` imports `mesher.ts`, `chunk.ts`, `blocks.ts`, and `lighting.ts`. None of these may import `textureAtlas.ts` (which uses `document` and `THREE`). Atlas constants (`ATLAS_COLS`, `ATLAS_ROWS`, `ATLAS_TILE_SIZE`, `TILE_IDS`) live in `blocks.ts` so the worker can reach them without touching the DOM.

---

## Task 1: Add atlas constants and tile IDs to `blocks.ts`

**Files:**
- Modify: `07-advanced-terrain/src/blocks.ts`

- [ ] **Step 1: Add atlas constants and `TILE_IDS` after the `Block` definition**

Open `07-advanced-terrain/src/blocks.ts` and insert the following block immediately after the `Block` const (after line 36, before the `BlockId` type):

```ts
// ── Atlas layout ──────────────────────────────────────────────────────────────
export const ATLAS_COLS      = 8;
export const ATLAS_ROWS      = 8;
export const ATLAS_TILE_SIZE = 16; // px per tile

/**
 * Tile index → slot in the 8×8 atlas.
 * Layout: index 0 = top-left, index 7 = top-right, index 8 = second row left…
 * These constants are safe to import from the Web Worker (no DOM/THREE deps).
 */
export const TILE_IDS = {
  Air:          0,
  GrassTop:     1,
  GrassSide:    2,
  Dirt:         3,
  Stone:        4,
  DeepStone:    5,
  Sand:         6,
  Water:        7,
  Snow:         8,
  Coal:         9,
  Iron:         10,
  OakBark:      11,
  OakEnd:       12,
  OakLeaves:    13,
  BirchBark:    14,
  BirchEnd:     15,
  BirchLeaves:  16,
  SpruceBark:   17,
  SpruceEnd:    18,
  SpruceLeaves: 19,
  Cactus:       20,
  RedSand:      21,
  Ice:          22,
  Gravel:       23,
  Sandstone:    24,
  SnowBrick:    25,
  OakPlanks:    26,
  Cobblestone:  27,
  Glass:        28,
  Lava:         29,
  Glowstone:    30,
} as const;
```

- [ ] **Step 2: Add `tiles` to `BlockDef`**

Replace the existing `BlockDef` interface:

```ts
export interface BlockDef {
  name: string;
  color: number;
  solid: boolean;
  transparent: boolean;
  lightEmit: number;  // 0 = non-emissive; 1–15 = emits that light level
  tiles: { top: number; side: number; bottom: number };
}
```

- [ ] **Step 3: Update `BLOCK_DEFS` — add `tiles` to every entry**

Replace the entire `BLOCK_DEFS` constant with the version below. Every block has `tiles`; face-distinct blocks (Grass, wood types) use different tile indices per face; all others repeat the same tile:

```ts
export const BLOCK_DEFS: Record<number, BlockDef> = {
  [Block.Air]: {
    name: "Air", color: 0x7EC8E3, solid: false, transparent: true, lightEmit: 0,
    tiles: { top: TILE_IDS.Air, side: TILE_IDS.Air, bottom: TILE_IDS.Air },
  },
  [Block.Grass]: {
    name: "Grass", color: 0x4CAF50, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.GrassTop, side: TILE_IDS.GrassSide, bottom: TILE_IDS.Dirt },
  },
  [Block.Dirt]: {
    name: "Dirt", color: 0x8B5E3C, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Dirt, side: TILE_IDS.Dirt, bottom: TILE_IDS.Dirt },
  },
  [Block.Stone]: {
    name: "Stone", color: 0x808080, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Stone, side: TILE_IDS.Stone, bottom: TILE_IDS.Stone },
  },
  [Block.DeepStone]: {
    name: "Deep Stone", color: 0x505050, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.DeepStone, side: TILE_IDS.DeepStone, bottom: TILE_IDS.DeepStone },
  },
  [Block.Sand]: {
    name: "Sand", color: 0xEDC9AF, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Sand, side: TILE_IDS.Sand, bottom: TILE_IDS.Sand },
  },
  [Block.Water]: {
    name: "Water", color: 0x2196F3, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Water, side: TILE_IDS.Water, bottom: TILE_IDS.Water },
  },
  [Block.Snow]: {
    name: "Snow", color: 0xF0F0F0, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Snow, side: TILE_IDS.Snow, bottom: TILE_IDS.Snow },
  },
  [Block.Coal]: {
    name: "Coal", color: 0x333333, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Coal, side: TILE_IDS.Coal, bottom: TILE_IDS.Coal },
  },
  [Block.Iron]: {
    name: "Iron", color: 0xC19A6B, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Iron, side: TILE_IDS.Iron, bottom: TILE_IDS.Iron },
  },
  [Block.OakWood]: {
    name: "Oak Wood", color: 0x6D4C2A, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.OakEnd, side: TILE_IDS.OakBark, bottom: TILE_IDS.OakEnd },
  },
  [Block.OakLeaves]: {
    name: "Oak Leaves", color: 0x2E7D32, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.OakLeaves, side: TILE_IDS.OakLeaves, bottom: TILE_IDS.OakLeaves },
  },
  [Block.BirchWood]: {
    name: "Birch Wood", color: 0xD4C9A8, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.BirchEnd, side: TILE_IDS.BirchBark, bottom: TILE_IDS.BirchEnd },
  },
  [Block.BirchLeaves]: {
    name: "Birch Leaves", color: 0x6DBF4B, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.BirchLeaves, side: TILE_IDS.BirchLeaves, bottom: TILE_IDS.BirchLeaves },
  },
  [Block.SpruceWood]: {
    name: "Spruce Wood", color: 0x3E2723, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.SpruceEnd, side: TILE_IDS.SpruceBark, bottom: TILE_IDS.SpruceEnd },
  },
  [Block.SpruceLeaves]: {
    name: "Spruce Leaves", color: 0x1B5E20, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.SpruceLeaves, side: TILE_IDS.SpruceLeaves, bottom: TILE_IDS.SpruceLeaves },
  },
  [Block.Cactus]: {
    name: "Cactus", color: 0x388E3C, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Cactus, side: TILE_IDS.Cactus, bottom: TILE_IDS.Cactus },
  },
  [Block.RedSand]: {
    name: "Red Sand", color: 0xC97044, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.RedSand, side: TILE_IDS.RedSand, bottom: TILE_IDS.RedSand },
  },
  [Block.Ice]: {
    name: "Ice", color: 0xB3E5FC, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Ice, side: TILE_IDS.Ice, bottom: TILE_IDS.Ice },
  },
  [Block.Gravel]: {
    name: "Gravel", color: 0x9E9E9E, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Gravel, side: TILE_IDS.Gravel, bottom: TILE_IDS.Gravel },
  },
  [Block.Sandstone]: {
    name: "Sandstone", color: 0xD4B483, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Sandstone, side: TILE_IDS.Sandstone, bottom: TILE_IDS.Sandstone },
  },
  [Block.SnowBrick]: {
    name: "Snow Brick", color: 0xDCE8EC, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.SnowBrick, side: TILE_IDS.SnowBrick, bottom: TILE_IDS.SnowBrick },
  },
  [Block.OakPlanks]: {
    name: "Oak Planks", color: 0xBC8F5E, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.OakPlanks, side: TILE_IDS.OakPlanks, bottom: TILE_IDS.OakPlanks },
  },
  [Block.Cobblestone]: {
    name: "Cobblestone", color: 0x6B6B6B, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Cobblestone, side: TILE_IDS.Cobblestone, bottom: TILE_IDS.Cobblestone },
  },
  [Block.Glass]: {
    name: "Glass", color: 0xCCE8F0, solid: true, transparent: true, lightEmit: 0,
    tiles: { top: TILE_IDS.Glass, side: TILE_IDS.Glass, bottom: TILE_IDS.Glass },
  },
  [Block.Lava]: {
    name: "Lava", color: 0xFF6600, solid: true, transparent: false, lightEmit: 15,
    tiles: { top: TILE_IDS.Lava, side: TILE_IDS.Lava, bottom: TILE_IDS.Lava },
  },
  [Block.Glowstone]: {
    name: "Glowstone", color: 0xFFDD44, solid: true, transparent: false, lightEmit: 15,
    tiles: { top: TILE_IDS.Glowstone, side: TILE_IDS.Glowstone, bottom: TILE_IDS.Glowstone },
  },
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds (or only fails on files not yet updated — `mesher.ts` errors are expected until Task 3).

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/blocks.ts
git commit -m "feat(07): add atlas constants and tile IDs to blocks"
```

---

## Task 2: Create `src/textureAtlas.ts`

**Files:**
- Create: `07-advanced-terrain/src/textureAtlas.ts`

- [ ] **Step 1: Create the file**

Create `07-advanced-terrain/src/textureAtlas.ts` with the full content below:

```ts
import * as THREE from "three";
import { TILE_IDS, ATLAS_COLS, ATLAS_ROWS, ATLAS_TILE_SIZE } from "./blocks";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seeded LCG — reproducible noise independent of Math.random. */
function makeLcg(seed: number): () => number {
  let s = (seed ^ 0x5A5A5A5A) >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Column index for a tile slot. */
function tc(idx: number): number { return idx % ATLAS_COLS; }
/** Row index for a tile slot. */
function tr(idx: number): number { return Math.floor(idx / ATLAS_COLS); }

/**
 * Fill a tile slot with a base color plus per-pixel brightness noise.
 * `variance` is a fraction of 255 (e.g. 0.10 = ±25.5 brightness).
 */
function drawNoiseTile(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  color: number,
  variance: number,
  seed: number,
): void {
  const x0  = col * ATLAS_TILE_SIZE;
  const y0  = row * ATLAS_TILE_SIZE;
  const rng = makeLcg(seed);
  const rb  = (color >> 16) & 255;
  const gb  = (color >>  8) & 255;
  const bb  =  color        & 255;
  const img = ctx.createImageData(ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
  const n   = ATLAS_TILE_SIZE * ATLAS_TILE_SIZE;
  for (let i = 0; i < n; i++) {
    const v = (rng() - 0.5) * variance * 255;
    img.data[i * 4 + 0] = Math.max(0, Math.min(255, rb + v)) | 0;
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, gb + v)) | 0;
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, bb + v)) | 0;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

// ── Specialised tile painters ─────────────────────────────────────────────────

function drawGrassTop(ctx: CanvasRenderingContext2D): void {
  drawNoiseTile(ctx, tc(TILE_IDS.GrassTop), tr(TILE_IDS.GrassTop), 0x4CAF50, 0.15, TILE_IDS.GrassTop);
  const x0  = tc(TILE_IDS.GrassTop) * ATLAS_TILE_SIZE;
  const y0  = tr(TILE_IDS.GrassTop) * ATLAS_TILE_SIZE;
  const rng = makeLcg(TILE_IDS.GrassTop + 1000);
  ctx.fillStyle = "#2E7D32";
  for (let i = 0; i < 14; i++) {
    ctx.fillRect(
      x0 + (rng() * ATLAS_TILE_SIZE) | 0,
      y0 + (rng() * ATLAS_TILE_SIZE) | 0,
      1, 1,
    );
  }
}

function drawGrassSide(ctx: CanvasRenderingContext2D): void {
  const col = tc(TILE_IDS.GrassSide);
  const row = tr(TILE_IDS.GrassSide);
  // Dirt base
  drawNoiseTile(ctx, col, row, 0x8B5E3C, 0.10, TILE_IDS.GrassSide);
  // Green strip on top 3 rows
  ctx.fillStyle = "#4CAF50";
  ctx.fillRect(col * ATLAS_TILE_SIZE, row * ATLAS_TILE_SIZE, ATLAS_TILE_SIZE, 3);
}

function drawWoodEnd(ctx: CanvasRenderingContext2D, tileIdx: number, baseColor: number): void {
  const col = tc(tileIdx);
  const row = tr(tileIdx);
  drawNoiseTile(ctx, col, row, baseColor, 0.10, tileIdx);
  const cx = col * ATLAS_TILE_SIZE + ATLAS_TILE_SIZE / 2;
  const cy = row * ATLAS_TILE_SIZE + ATLAS_TILE_SIZE / 2;
  const rb = (baseColor >> 16) & 255;
  const gb = (baseColor >>  8) & 255;
  const bb =  baseColor        & 255;
  ctx.strokeStyle = `rgba(${rb * 0.55 | 0},${gb * 0.55 | 0},${bb * 0.55 | 0},0.5)`;
  ctx.lineWidth = 1;
  for (let r = 2; r < ATLAS_TILE_SIZE / 2; r += 3) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawWoodBark(ctx: CanvasRenderingContext2D, tileIdx: number, baseColor: number): void {
  const col = tc(tileIdx);
  const row = tr(tileIdx);
  drawNoiseTile(ctx, col, row, baseColor, 0.10, tileIdx);
  const x0  = col * ATLAS_TILE_SIZE;
  const y0  = row * ATLAS_TILE_SIZE;
  const rb  = (baseColor >> 16) & 255;
  const gb  = (baseColor >>  8) & 255;
  const bb  =  baseColor        & 255;
  ctx.fillStyle = `rgba(${rb * 0.65 | 0},${gb * 0.65 | 0},${bb * 0.65 | 0},0.45)`;
  const rng = makeLcg(tileIdx + 2000);
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x0 + (rng() * ATLAS_TILE_SIZE) | 0, y0, 1, ATLAS_TILE_SIZE);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a 128×128 CanvasTexture atlas with procedural placeholder tiles.
 * To swap in a real atlas: replace this function with a TextureLoader call
 * that returns a Promise<THREE.Texture> — no other files need to change.
 */
export function buildAtlasTexture(): THREE.CanvasTexture {
  const canvas    = document.createElement("canvas");
  canvas.width    = ATLAS_COLS * ATLAS_TILE_SIZE;   // 128
  canvas.height   = ATLAS_ROWS * ATLAS_TILE_SIZE;   // 128
  const ctx = canvas.getContext("2d")!;

  // Uniform noise tiles: [tileIdx, baseColor, variance]
  const noiseTiles: Array<[number, number, number]> = [
    [TILE_IDS.Dirt,         0x8B5E3C, 0.10],
    [TILE_IDS.Stone,        0x808080, 0.08],
    [TILE_IDS.DeepStone,    0x505050, 0.07],
    [TILE_IDS.Sand,         0xEDC9AF, 0.08],
    [TILE_IDS.Water,        0x2196F3, 0.05],
    [TILE_IDS.Snow,         0xF0F0F0, 0.05],
    [TILE_IDS.Coal,         0x333333, 0.15],
    [TILE_IDS.Iron,         0xC19A6B, 0.12],
    [TILE_IDS.OakLeaves,    0x2E7D32, 0.12],
    [TILE_IDS.BirchLeaves,  0x6DBF4B, 0.12],
    [TILE_IDS.SpruceLeaves, 0x1B5E20, 0.12],
    [TILE_IDS.Cactus,       0x388E3C, 0.10],
    [TILE_IDS.RedSand,      0xC97044, 0.08],
    [TILE_IDS.Ice,          0xB3E5FC, 0.04],
    [TILE_IDS.Gravel,       0x9E9E9E, 0.12],
    [TILE_IDS.Sandstone,    0xD4B483, 0.08],
    [TILE_IDS.SnowBrick,    0xDCE8EC, 0.06],
    [TILE_IDS.OakPlanks,    0xBC8F5E, 0.10],
    [TILE_IDS.Cobblestone,  0x6B6B6B, 0.12],
    [TILE_IDS.Glass,        0xCCE8F0, 0.03],
    [TILE_IDS.Lava,         0xFF6600, 0.08],
    [TILE_IDS.Glowstone,    0xFFDD44, 0.08],
  ];

  for (const [idx, color, variance] of noiseTiles) {
    drawNoiseTile(ctx, tc(idx), tr(idx), color, variance, idx);
  }

  drawGrassTop(ctx);
  drawGrassSide(ctx);
  drawWoodEnd(ctx, TILE_IDS.OakEnd,      0x6D4C2A);
  drawWoodBark(ctx, TILE_IDS.OakBark,    0x6D4C2A);
  drawWoodEnd(ctx, TILE_IDS.BirchEnd,    0xD4C9A8);
  drawWoodBark(ctx, TILE_IDS.BirchBark,  0xD4C9A8);
  drawWoodEnd(ctx, TILE_IDS.SpruceEnd,   0x3E2723);
  drawWoodBark(ctx, TILE_IDS.SpruceBark, 0x3E2723);

  const texture       = new THREE.CanvasTexture(canvas);
  texture.magFilter   = THREE.NearestFilter;
  texture.minFilter   = THREE.NearestFilter;
  texture.flipY       = false;
  return texture;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds (mesher errors still expected until Task 3).

- [ ] **Step 3: Commit**

```bash
git add 07-advanced-terrain/src/textureAtlas.ts
git commit -m "feat(07): add procedural texture atlas generator"
```

---

## Task 3: Rewrite `src/mesher.ts` — per-face quad emitter with UVs

**Files:**
- Modify: `07-advanced-terrain/src/mesher.ts`

- [ ] **Step 1: Replace the entire file**

Overwrite `07-advanced-terrain/src/mesher.ts` with:

```ts
import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS, Block, ATLAS_COLS, ATLAS_ROWS } from "./blocks";

/**
 * Per-face quad emitter — replaces the greedy mesher.
 *
 * Each visible block face becomes exactly one quad (4 vertices, 2 triangles).
 * UV coordinates point to the block's assigned tile in the 8×8 texture atlas.
 * Vertex colors are kept for biome-tinted grass; all other blocks use white
 * so that `map × vertexColors = map` in MeshLambertMaterial.
 */

export interface MeshData {
  positions: number[];
  normals:   number[];
  colors:    number[];
  uvs:       number[];   // 2 floats per vertex (u, v)
  indices:   number[];
}

type NeighborLookup = (x: number, y: number, z: number) => number;

export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: Uint8Array | null,
): MeshData {
  const positions: number[] = [];
  const normals:   number[] = [];
  const colors:    number[] = [];
  const uvs:       number[] = [];
  const indices:   number[] = [];

  // Six face directions: [axis, sign]
  // axis: 0=x, 1=y, 2=z   sign: +1 or -1
  const faces: [number, number][] = [
    [0, -1], [0, 1],
    [1, -1], [1, 1],
    [2, -1], [2, 1],
  ];

  for (const [axis, dir] of faces) {
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;

    const normal = [0, 0, 0];
    normal[axis] = dir;

    for (let d = 0; d < CHUNK_SIZE; d++) {
      for (let j = 0; j < CHUNK_SIZE; j++) {
        for (let i = 0; i < CHUNK_SIZE; i++) {
          // Map (d, i, j) → local voxel position
          const pos = [0, 0, 0];
          pos[axis]  = d;
          pos[uAxis] = i;
          pos[vAxis] = j;

          const block = data[chunkIndex(pos[0], pos[1], pos[2])];
          const def   = BLOCK_DEFS[block];
          if (!def || def.transparent) continue;

          // Check the voxel on the other side of this face
          const nPos = [pos[0], pos[1], pos[2]];
          nPos[axis] += dir;

          let neighborBlock: number;
          if (
            nPos[0] < 0 || nPos[0] >= CHUNK_SIZE ||
            nPos[1] < 0 || nPos[1] >= CHUNK_SIZE ||
            nPos[2] < 0 || nPos[2] >= CHUNK_SIZE
          ) {
            neighborBlock = getNeighbor(nPos[0], nPos[1], nPos[2]);
          } else {
            neighborBlock = data[chunkIndex(nPos[0], nPos[1], nPos[2])];
          }

          const nDef = BLOCK_DEFS[neighborBlock];
          if (nDef && !nDef.transparent) continue; // face is hidden

          // ── Tile UV ──────────────────────────────────────────────────────
          // axis 1 (Y): dir +1 = top face, dir -1 = bottom face
          // axis 0/2 (X/Z): side face
          const faceType: "top" | "side" | "bottom" =
            axis === 1 ? (dir === 1 ? "top" : "bottom") : "side";
          const tileIdx = def.tiles[faceType];

          const tCol = tileIdx % ATLAS_COLS;
          const tRow = (tileIdx / ATLAS_COLS) | 0;
          const u0 = tCol / ATLAS_COLS,       u1 = (tCol + 1) / ATLAS_COLS;
          const v0 = tRow / ATLAS_ROWS,       v1 = (tRow + 1) / ATLAS_ROWS;

          // ── Vertex color (white unless grass top/side for biome tint) ────
          let packedColor = 0xFFFFFF;
          if (block === Block.Grass && faceType !== "bottom") {
            packedColor = grassColors[pos[2] * CHUNK_SIZE + pos[0]];
          }
          const r = ((packedColor >> 16) & 255) / 255;
          const g = ((packedColor >>  8) & 255) / 255;
          const b = ( packedColor        & 255) / 255;

          // ── Directional shading ──────────────────────────────────────────
          const shade =
            axis === 1 ? (dir === 1 ? 1.0 : 0.5) :
            axis === 0 ? 0.7 : 0.8;

          // ── Light level (from the air-side voxel of this face) ───────────
          let lightLevel = 15;
          if (lightData) {
            const lp = [pos[0], pos[1], pos[2]];
            lp[axis] += dir;
            if (
              lp[0] >= 0 && lp[0] < CHUNK_SIZE &&
              lp[1] >= 0 && lp[1] < CHUNK_SIZE &&
              lp[2] >= 0 && lp[2] < CHUNK_SIZE
            ) {
              lightLevel = lightData[chunkIndex(lp[0], lp[1], lp[2])];
            }
            lightLevel = Math.max(lightLevel, def.lightEmit);
          }
          const lightFactor = 0.2 + (lightLevel / 15) * 0.8;

          const sr = r * shade * lightFactor;
          const sg = g * shade * lightFactor;
          const sb = b * shade * lightFactor;

          // ── Quad geometry ────────────────────────────────────────────────
          const corner = [0, 0, 0];
          corner[axis]  = d + (dir > 0 ? 1 : 0);
          corner[uAxis] = i;
          corner[vAxis] = j;

          const du = [0, 0, 0]; du[uAxis] = 1;
          const dv = [0, 0, 0]; dv[vAxis] = 1;

          const vi = positions.length / 3;

          // 4 corners of the 1×1 quad, CCW from bottom-left
          const qc = [
            [corner[0],                corner[1],                corner[2]               ],
            [corner[0] + du[0],        corner[1] + du[1],        corner[2] + du[2]       ],
            [corner[0] + du[0]+dv[0],  corner[1] + du[1]+dv[1],  corner[2] + du[2]+dv[2] ],
            [corner[0] + dv[0],        corner[1] + dv[1],        corner[2] + dv[2]       ],
          ];
          // UV corners match quad corners: (u0,v0)→(u1,v0)→(u1,v1)→(u0,v1)
          const uvc = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

          for (let k = 0; k < 4; k++) {
            positions.push(qc[k][0], qc[k][1], qc[k][2]);
            normals.push(normal[0], normal[1], normal[2]);
            colors.push(sr, sg, sb);
            uvs.push(uvc[k][0], uvc[k][1]);
          }

          // Winding: positive-dir faces use 0-1-2, 0-2-3;
          //          negative-dir faces reverse to face outward
          if (dir > 0) {
            indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          } else {
            indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
          }
        }
      }
    }
  }

  return { positions, normals, colors, uvs, indices };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds (worker.ts errors expected until Task 4 because `WorkerResponse` still lacks `uvs`).

- [ ] **Step 3: Commit**

```bash
git add 07-advanced-terrain/src/mesher.ts
git commit -m "feat(07): replace greedy mesher with per-face quad emitter + UV support"
```

---

## Task 4: Update `src/worker.ts` — propagate `uvs` through the worker pipeline

**Files:**
- Modify: `07-advanced-terrain/src/worker.ts`

- [ ] **Step 1: Add `uvs` to `WorkerResponse`**

In `worker.ts`, update the `WorkerResponse` interface:

```ts
export interface WorkerResponse {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;        // NEW
  indices: Uint32Array;
  empty: boolean;
  blockData: Uint8Array;
  grassColors: Uint32Array;
}
```

- [ ] **Step 2: Handle the empty-chunk path**

In the `if (mesh.indices.length === 0)` branch, add `uvs` to the response and its transfer list:

```ts
if (mesh.indices.length === 0) {
  const resp: WorkerResponse = {
    id, cx, cy, cz,
    positions: new Float32Array(0),
    normals:   new Float32Array(0),
    colors:    new Float32Array(0),
    uvs:       new Float32Array(0),   // NEW
    indices:   new Uint32Array(0),
    empty: true,
    blockData: data,
    grassColors,
  };
  self.postMessage(resp, { transfer: [data.buffer, grassColors.buffer] });
  return;
}
```

- [ ] **Step 3: Pack and transfer `uvs` in the non-empty path**

Replace the non-empty response block:

```ts
const positions = new Float32Array(mesh.positions);
const normals   = new Float32Array(mesh.normals);
const colors    = new Float32Array(mesh.colors);
const uvs       = new Float32Array(mesh.uvs);       // NEW
const indices   = new Uint32Array(mesh.indices);

const resp: WorkerResponse = {
  id, cx, cy, cz,
  positions, normals, colors, uvs, indices,           // uvs added
  empty: false,
  blockData: data,
  grassColors,
};

self.postMessage(resp, {
  transfer: [
    positions.buffer,
    normals.buffer,
    colors.buffer,
    uvs.buffer,             // NEW
    indices.buffer,
    data.buffer,
    grassColors.buffer,
  ],
});
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds (world.ts errors expected until Task 5 because `resp.uvs` is not yet consumed).

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/worker.ts
git commit -m "feat(07): propagate uvs through worker pipeline"
```

---

## Task 5: Update `src/world.ts` — wire atlas texture and uv geometry attribute

**Files:**
- Modify: `07-advanced-terrain/src/world.ts`

- [ ] **Step 1: Add the import**

At the top of `world.ts`, add the import for `buildAtlasTexture` alongside the existing imports:

```ts
import { buildAtlasTexture } from "./textureAtlas";
```

- [ ] **Step 2: Add `atlasTexture` field to the `World` class**

Inside the `World` class, alongside `private material`, add:

```ts
private atlasTexture: THREE.CanvasTexture;
```

- [ ] **Step 3: Build atlas and update material in the constructor**

Replace the material line in the constructor:

```ts
// Before:
this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

// After:
this.atlasTexture = buildAtlasTexture();
this.material = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.atlasTexture });
```

- [ ] **Step 4: Upload the `uv` geometry attribute**

In `onWorkerResult`, in the non-empty branch where geometry attributes are set, add the `uv` attribute after `color`:

```ts
geometry.setAttribute("position", new THREE.Float32BufferAttribute(resp.positions, 3));
geometry.setAttribute("normal",   new THREE.Float32BufferAttribute(resp.normals,   3));
geometry.setAttribute("color",    new THREE.Float32BufferAttribute(resp.colors,    3));
geometry.setAttribute("uv",       new THREE.Float32BufferAttribute(resp.uvs,       2));  // NEW
geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));
```

- [ ] **Step 5: Dispose the atlas texture in `dispose()`**

In the `dispose()` method, add disposal alongside `this.material.dispose()`:

```ts
this.atlasTexture.dispose();   // NEW
this.material.dispose();
```

- [ ] **Step 6: Verify full build**

```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds with zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add 07-advanced-terrain/src/world.ts
git commit -m "feat(07): wire atlas texture and uv attribute in world renderer"
```

---

## Task 6: Visual verification

**Files:** none

- [ ] **Step 1: Start the dev server**

```bash
cd 07-advanced-terrain && npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5174`).

- [ ] **Step 2: Check texture rendering**

Verify the following visually:

1. **Grass blocks** — top face is green with dark dots, side face has a green strip at the top over a brown base, visible in the world
2. **Stone / dirt / sand** — each shows a distinct noisy color, not flat
3. **Wood trunks** — top/bottom show concentric rings, sides show vertical bark streaks
4. **Glowstone / lava** — still emit light (light system unchanged); surface shows texture
5. **Biome grass tint** — grass in different biomes is tinted differently (warm = yellowish, cold = blueish)
6. **No seams** — no bright white gaps between chunks at their boundaries
7. **No black quads** — if any face shows black, the UV is mapping to an empty (unfilled) atlas slot; inspect which block type it is and verify its `TILE_IDS` entry in `blocks.ts`

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(07): texture support complete — placeholder atlas rendering"
```
