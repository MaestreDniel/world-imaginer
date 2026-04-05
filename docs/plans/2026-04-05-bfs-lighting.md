# BFS Block Lighting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Minecraft-style per-voxel BFS block lighting to project 07, with skylight and Lava/Glowstone point light sources baked into vertex colors.

**Architecture:** A `LightEngine` class runs a global BFS across all loaded chunks on the main thread after each generation wave, producing a `Map<chunkKey, Uint8Array>` of light levels (0–15). Dirty chunks are re-dispatched to workers for re-meshing with the light data, which is multiplied into vertex colors. Lava and Glowstone are new block types placed in terrain generation.

**Tech Stack:** TypeScript, Three.js, Web Workers, Vite — no test runner. Verify each task by running `npm run dev` inside `07-advanced-terrain/` and checking the browser.

---

## Task 1: Add `lightEmit` to `BlockDef` and register Lava + Glowstone

**Files:**
- Modify: `07-advanced-terrain/src/blocks.ts`

**Step 1: Add `lightEmit` to the `BlockDef` interface**

In `blocks.ts`, find the `BlockDef` interface (line ~39) and add the new field:

```ts
export interface BlockDef {
  name: string;
  color: number;
  solid: boolean;
  transparent: boolean;
  lightEmit: number;  // 0 = non-emissive; 1–15 = emits that light level
}
```

**Step 2: Add Lava and Glowstone to the `Block` object**

After `Glass: 25`:

```ts
Lava:        26,
Glowstone:   27,
```

**Step 3: Add `lightEmit: 0` to every existing entry in `BLOCK_DEFS`, then add Lava and Glowstone**

Every existing entry needs `lightEmit: 0`. Then add:

```ts
[Block.Lava]:        { name: "Lava",        color: 0xFF6600, solid: true,  transparent: false, lightEmit: 15 },
[Block.Glowstone]:   { name: "Glowstone",   color: 0xFFDD44, solid: true,  transparent: false, lightEmit: 15 },
```

**Step 4: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```

Expected: no errors. If existing BLOCK_DEFS entries complain about missing `lightEmit`, add `lightEmit: 0` to each one.

**Step 5: Commit**

```bash
git add 07-advanced-terrain/src/blocks.ts
git commit -m "feat(07): add lightEmit to BlockDef, add Lava and Glowstone blocks"
```

---

## Task 2: Place Lava and Glowstone in terrain generation

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

**Context:** `generateChunk` uses seed offsets 1–3, 5–7. Use offset 4 for Lava noise and offset 8 for Glowstone noise. Cave blocks are `Block.Air`. Lava only spawns in chunks with `chunkY <= -1` (world Y ≤ -1). Glowstone spawns on cave ceilings at any depth.

**Step 1: Add noise instances at the top of `generateChunk` (after existing noise declarations ~line 55)**

```ts
const lavaNoise     = createNoise(seed + 4);
const glowstoneNoise = createNoise(seed + 8);
```

**Step 2: Add Lava and Glowstone placement passes after the surface cave erosion block (after line ~268, before the structure placement pass)**

```ts
// ── Lava placement (deep chunks only) ────────────────────────────────────
// Replace cave air with lava in chunks at world Y ≤ -1.
if (chunkY <= -1) {
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
        const wx = worldXOff + lx;
        const wz = worldZOff + lz;
        const n = lavaNoise.perlin2D(wx / 20, wz / 20);
        if (n > 0.7) data[chunkIndex(lx, ly, lz)] = Block.Lava;
      }
    }
  }
}

// ── Glowstone placement (cave ceilings, all depths) ───────────────────────
// Replace cave air that has a solid block directly above it (ceiling).
for (let ly = 0; ly < CHUNK_SIZE - 1; ly++) {
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
      const above = data[chunkIndex(lx, ly + 1, lz)];
      const aboveDef = BLOCK_DEFS[above];
      if (!aboveDef || aboveDef.transparent) continue; // no solid ceiling
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const n = glowstoneNoise.perlin2D(wx / 15, wz / 15);
      if (n > 0.65) data[chunkIndex(lx, ly, lz)] = Block.Glowstone;
    }
  }
}
```

Note: this needs `BLOCK_DEFS` imported. Add the import at the top of chunk.ts:

```ts
import { Block, BLOCK_DEFS } from "./blocks";
```

(Replace the existing `import { Block } from "./blocks"` at line 1.)

**Step 3: Verify in browser**

```bash
cd 07-advanced-terrain && npm run dev
```

Open the browser, fly underground. You should see orange lava pools in deep areas and yellow glowstone on cave ceilings. The blocks won't glow yet (lighting not wired), but they should appear with their colors.

**Step 4: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat(07): place Lava and Glowstone in terrain generation"
```

---

## Task 3: Store `grassColors` in `LoadedChunk`

**Files:**
- Modify: `07-advanced-terrain/src/world.ts`

**Context:** `grassColors` is computed during generation and returned in `WorkerResponse`, but currently discarded after first-pass meshing. Re-meshing during the light pass needs it. We must store it.

**Step 1: Add `grassColors` to the `LoadedChunk` interface (line ~28)**

```ts
interface LoadedChunk {
  mesh: THREE.Mesh | null;
  blockData: Uint8Array | null;
  grassColors: Uint32Array | null;  // NEW
}
```

**Step 2: Store `grassColors` when handling worker results**

In `onWorkerResult`, in both the `resp.empty` branch and the non-empty branch, set `grassColors` on the stored chunk:

Empty branch (around line ~74):
```ts
this.chunks.set(key, { mesh: null, blockData: resp.blockData, grassColors: resp.grassColors });
```

Non-empty branch (around line ~87):
```ts
this.chunks.set(key, { mesh, blockData: resp.blockData, grassColors: resp.grassColors });
```

**Step 3: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add 07-advanced-terrain/src/world.ts
git commit -m "feat(07): store grassColors in LoadedChunk for light-pass re-meshing"
```

---

## Task 4: Add re-mesh mode to worker + lightData support in mesher

**Files:**
- Modify: `07-advanced-terrain/src/worker.ts`
- Modify: `07-advanced-terrain/src/mesher.ts`

**Context:** The light pass needs to re-mesh chunks using existing block data + new light data, skipping terrain generation entirely. Add a `remesh` flag to `WorkerRequest`. When true, skip `generateChunk` and use the provided `blockData` directly. The mesher gets a new `lightData` parameter it multiplies into vertex colors.

### 4a — Update `worker.ts`

**Step 1: Extend `WorkerRequest` with remesh fields**

```ts
export interface WorkerRequest {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  config: WorldConfig;
  remesh?: boolean;       // NEW: skip generation, use provided blockData
  blockData?: Uint8Array; // NEW: provided when remesh = true
  grassColors?: Uint32Array; // NEW: provided when remesh = true
  lightData?: Uint8Array; // NEW: per-voxel light levels 0–15
}
```

**Step 2: Update the worker `onmessage` handler to branch on `remesh`**

Replace the existing handler body with:

```ts
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, cx, cy, cz, config, remesh, lightData } = e.data;

  let data: ChunkData;
  let grassColors: Uint32Array;

  if (remesh && e.data.blockData && e.data.grassColors) {
    // Light-pass re-mesh: skip generation, use provided data
    data = e.data.blockData;
    grassColors = e.data.grassColors;
  } else {
    const t0 = performance.now();
    const result: ChunkResult = generateChunk(cx, cy, cz, config);
    const t1 = performance.now();
    if (t1 - t0 > 100) console.warn(`Slow chunk (${cx},${cy},${cz}): ${(t1 - t0).toFixed(0)}ms`);
    data = result.data;
    grassColors = result.grassColors;
  }

  const getNeighbor = (lx: number, ly: number, lz: number): number => {
    if (lx < 0 || lx >= CHUNK_SIZE ||
        ly < 0 || ly >= CHUNK_SIZE ||
        lz < 0 || lz >= CHUNK_SIZE) {
      return 0;
    }
    return data[chunkIndex(lx, ly, lz)];
  };

  const mesh = buildChunkMesh(data, getNeighbor, grassColors, lightData ?? null);

  if (mesh.indices.length === 0) {
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
    return;
  }

  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const colors = new Float32Array(mesh.colors);
  const indices = new Uint32Array(mesh.indices);

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
};
```

### 4b — Update `mesher.ts`

**Step 1: Add `lightData` parameter to `buildChunkMesh`**

Change the function signature (line ~36):

```ts
export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: Uint8Array | null,
): MeshData {
```

**Step 2: Apply `lightFactor` to vertex colors**

Inside the quad-emit section, find where `sr`, `sg`, `sb` are computed (around line ~148–158) and update:

```ts
// Simple directional shading
const shade = axis === 1
  ? (dir === 1 ? 1.0 : 0.5)
  : axis === 0 ? 0.7 : 0.8;

// Light level baked from LightEngine (0–15). Default 1.0 if no light data.
const voxPos = [0, 0, 0];
voxPos[axis] = d; voxPos[u] = i; voxPos[v] = j;
const lightLevel = lightData ? lightData[chunkIndex(voxPos[0], voxPos[1], voxPos[2])] : 15;
const lightFactor = lightLevel / 15;

const sr = r * shade * lightFactor;
const sg = g * shade * lightFactor;
const sb = b * shade * lightFactor;
```

**Step 3: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Verify in browser — terrain should look identical to before (lightData is null until Task 6 wires it up)**

```bash
npm run dev
```

Open browser, check that the world renders normally (no visual change yet is correct — lightData is null so `lightFactor = 1.0`).

**Step 5: Commit**

```bash
git add 07-advanced-terrain/src/worker.ts 07-advanced-terrain/src/mesher.ts
git commit -m "feat(07): add remesh mode to worker and lightData support to mesher"
```

---

## Task 5: Create `lighting.ts` — LightEngine BFS

**Files:**
- Create: `07-advanced-terrain/src/lighting.ts`

**Context:** `LightEngine` owns the light grid. `recompute()` takes the loaded chunks map, runs a full global BFS (skylight + block lights), and returns a set of chunk keys whose light changed. The BFS uses 6-connected propagation with -1 attenuation per step. The `transparent` field in `BLOCK_DEFS` controls whether a block passes light.

```ts
import { CHUNK_SIZE, chunkIndex } from "./chunk";
import { BLOCK_DEFS } from "./blocks";

function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

function worldToChunk(w: number): number {
  return Math.floor(w / CHUNK_SIZE);
}

function worldToLocal(w: number): number {
  return ((w % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

interface ChunkEntry {
  blockData: Uint8Array | null;
}

export class LightEngine {
  private lightGrid = new Map<string, Uint8Array>();

  /**
   * Re-run the full BFS over all currently loaded chunks.
   * Returns the set of chunk keys whose light values changed.
   */
  recompute(chunks: Map<string, ChunkEntry>): Set<string> {
    // Snapshot old light values for dirty detection
    const oldGrid = new Map<string, Uint8Array>();
    for (const [key, arr] of this.lightGrid) {
      oldGrid.set(key, new Uint8Array(arr));
    }

    // Reset light grid to zero for all loaded chunks
    this.lightGrid.clear();
    for (const [key] of chunks) {
      this.lightGrid.set(key, new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE));
    }

    // Helper: get block id at world coords (returns -1 if chunk unloaded)
    const getBlock = (wx: number, wy: number, wz: number): number => {
      const key = chunkKey(worldToChunk(wx), worldToChunk(wy), worldToChunk(wz));
      const chunk = chunks.get(key);
      if (!chunk || !chunk.blockData) return -1;
      const lx = worldToLocal(wx);
      const ly = worldToLocal(wy);
      const lz = worldToLocal(wz);
      return chunk.blockData[chunkIndex(lx, ly, lz)];
    };

    // Helper: get current light level at world coords
    const getLight = (wx: number, wy: number, wz: number): number => {
      const key = chunkKey(worldToChunk(wx), worldToChunk(wy), worldToChunk(wz));
      const arr = this.lightGrid.get(key);
      if (!arr) return 0;
      const lx = worldToLocal(wx);
      const ly = worldToLocal(wy);
      const lz = worldToLocal(wz);
      return arr[chunkIndex(lx, ly, lz)];
    };

    // Helper: set light level at world coords
    const setLight = (wx: number, wy: number, wz: number, level: number): void => {
      const key = chunkKey(worldToChunk(wx), worldToChunk(wy), worldToChunk(wz));
      const arr = this.lightGrid.get(key);
      if (!arr) return;
      const lx = worldToLocal(wx);
      const ly = worldToLocal(wy);
      const lz = worldToLocal(wz);
      arr[chunkIndex(lx, ly, lz)] = level;
    };

    // Helper: is a block transparent (passes light)?
    const isTransparent = (blockId: number): boolean => {
      if (blockId < 0) return false; // unloaded = opaque
      const def = BLOCK_DEFS[blockId];
      return def ? def.transparent : false;
    };

    // BFS queue: [wx, wy, wz, level]
    const queue: Array<[number, number, number, number]> = [];

    // ── Seed 1: Skylight ────────────────────────────────────────────────────
    // For each (cx, cz) column of loaded chunks, find the highest loaded Y,
    // then scan downward. All transparent blocks above the first opaque block
    // (in any layer) receive light level 15.
    const columnMap = new Map<string, { minCY: number; maxCY: number }>();
    for (const key of chunks.keys()) {
      const [cx, cy, cz] = key.split(",").map(Number);
      const colKey = `${cx},${cz}`;
      const existing = columnMap.get(colKey);
      if (!existing) {
        columnMap.set(colKey, { minCY: cy, maxCY: cy });
      } else {
        existing.minCY = Math.min(existing.minCY, cy);
        existing.maxCY = Math.max(existing.maxCY, cy);
      }
    }

    for (const [colKey, { minCY, maxCY }] of columnMap) {
      const [cx, cz] = colKey.split(",").map(Number);
      const wxBase = cx * CHUNK_SIZE;
      const wzBase = cz * CHUNK_SIZE;

      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const wx = wxBase + lx;
          const wz = wzBase + lz;

          let inSky = true;
          // Scan from top of highest chunk downward
          for (let cy = maxCY; cy >= minCY; cy--) {
            const wyBase = cy * CHUNK_SIZE;
            for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
              const wy = wyBase + ly;
              const blockId = getBlock(wx, wy, wz);
              if (blockId < 0) continue; // unloaded block
              if (inSky && isTransparent(blockId)) {
                setLight(wx, wy, wz, 15);
                queue.push([wx, wy, wz, 15]);
              } else {
                inSky = false;
              }
            }
          }
        }
      }
    }

    // ── Seed 2: Block lights ────────────────────────────────────────────────
    for (const [key, chunk] of chunks) {
      if (!chunk.blockData) continue;
      const [cx, cy, cz] = key.split(",").map(Number);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const blockId = chunk.blockData[chunkIndex(lx, ly, lz)];
            const def = BLOCK_DEFS[blockId];
            if (!def || def.lightEmit === 0) continue;
            const wx = cx * CHUNK_SIZE + lx;
            const wy = cy * CHUNK_SIZE + ly;
            const wz = cz * CHUNK_SIZE + lz;
            setLight(wx, wy, wz, def.lightEmit);
            queue.push([wx, wy, wz, def.lightEmit]);
          }
        }
      }
    }

    // ── BFS propagation ─────────────────────────────────────────────────────
    const neighbors: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];

    let head = 0;
    while (head < queue.length) {
      const [wx, wy, wz, level] = queue[head++];
      if (level <= 1) continue;
      const next = level - 1;

      for (const [dx, dy, dz] of neighbors) {
        const nx = wx + dx;
        const ny = wy + dy;
        const nz = wz + dz;

        const blockId = getBlock(nx, ny, nz);
        if (!isTransparent(blockId)) continue;
        if (getLight(nx, ny, nz) >= next) continue;

        setLight(nx, ny, nz, next);
        queue.push([nx, ny, nz, next]);
      }
    }

    // ── Dirty detection ─────────────────────────────────────────────────────
    const dirty = new Set<string>();
    for (const [key, newArr] of this.lightGrid) {
      const old = oldGrid.get(key);
      if (!old) {
        dirty.add(key);
        continue;
      }
      for (let i = 0; i < newArr.length; i++) {
        if (newArr[i] !== old[i]) {
          dirty.add(key);
          break;
        }
      }
    }

    return dirty;
  }

  /** Returns a copy of the light data for a chunk (for sending to workers). */
  getLightData(key: string): Uint8Array | null {
    const arr = this.lightGrid.get(key);
    return arr ? new Uint8Array(arr) : null;
  }
}
```

**Step 1: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```

Expected: no errors.

**Step 2: Commit**

```bash
git add 07-advanced-terrain/src/lighting.ts
git commit -m "feat(07): add LightEngine with global BFS skylight and block light propagation"
```

---

## Task 6: Wire `LightEngine` into `world.ts`

**Files:**
- Modify: `07-advanced-terrain/src/world.ts`

**Context:** Add `LightEngine`, a `lightDirty` flag, and a `runLightPass()` method. The light pass triggers when the worker queue drains and `lightDirty` is true. Re-meshed chunks swap their `THREE.Mesh` geometry in-place. Copies of `blockData`, `grassColors`, and `lightData` are sent to workers (originals must stay on the main thread).

**Step 1: Add import**

At the top of `world.ts`, add:

```ts
import { LightEngine } from "./lighting";
```

**Step 2: Add `lightEngine` and `lightDirty` to the `World` class**

After `private nextId = 0;` (line ~41):

```ts
private lightEngine = new LightEngine();
private lightDirty = false;
private remeshInFlight = new Set<string>(); // tracks re-mesh requests to avoid re-queueing
```

**Step 3: Set `lightDirty = true` when a chunk is added**

In `onWorkerResult`, right before the final `this.dispatchNext()` call, after the chunk is stored:

```ts
if (!resp.empty) this.lightDirty = true;
```

Also set it when a chunk is removed. In the unload loop inside `update()`, where `this.chunks.delete(key)` is called:

```ts
this.lightDirty = true;
this.chunks.delete(key);
```

**Step 4: Trigger the light pass when the queue drains**

At the very end of `onWorkerResult`, after `this.dispatchNext()`, add:

```ts
// Trigger light pass once all generation workers are idle and we have new chunks
if (
  this.pendingQueue.length === 0 &&
  this.inFlight.size === 0 &&
  this.remeshInFlight.size === 0 &&
  this.lightDirty
) {
  this.runLightPass();
}
```

**Step 5: Add `runLightPass()` method**

Add after `dispatchNext()`:

```ts
private runLightPass(): void {
  this.lightDirty = false;

  const dirty = this.lightEngine.recompute(this.chunks);

  for (const key of dirty) {
    const chunk = this.chunks.get(key);
    if (!chunk || !chunk.blockData || !chunk.grassColors) continue;
    if (this.remeshInFlight.has(key)) continue;

    const [cx, cy, cz] = key.split(",").map(Number);
    const lightData = this.lightEngine.getLightData(key);
    if (!lightData) continue;

    this.remeshInFlight.add(key);

    // Find a free worker (or queue if none available)
    const req: WorkerRequest = {
      id: this.nextId++,
      cx, cy, cz,
      config: this.config,
      remesh: true,
      blockData: new Uint8Array(chunk.blockData),   // copy — original stays in LoadedChunk
      grassColors: new Uint32Array(chunk.grassColors), // copy
      lightData,
    };

    // Dispatch directly to first free worker, or push to pending queue
    let dispatched = false;
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workerBusy[i]) continue;
      this.workerBusy[i] = true;
      this.workers[i].postMessage(req, {
        transfer: [req.blockData!.buffer, req.grassColors!.buffer, req.lightData!.buffer],
      });
      dispatched = true;
      break;
    }
    if (!dispatched) {
      this.pendingQueue.push(req);
    }
  }
}
```

**Step 6: Handle re-mesh worker responses — swap geometry in-place**

In `onWorkerResult`, at the top of the method, add a branch for remesh responses. The remesh response has the same shape as a normal response but must update the existing mesh rather than creating a new entry:

```ts
private onWorkerResult(workerIdx: number, resp: WorkerResponse): void {
  this.workerBusy[workerIdx] = false;

  const key = chunkKey(resp.cx, resp.cy, resp.cz);

  // Re-mesh response: swap geometry and return
  if (this.remeshInFlight.has(key)) {
    this.remeshInFlight.delete(key);
    const existing = this.chunks.get(key);
    if (existing) {
      if (!resp.empty) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(resp.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(resp.normals, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(resp.colors, 3));
        geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));

        if (existing.mesh) {
          // Swap geometry on existing mesh (no scene add/remove needed)
          existing.mesh.geometry.dispose();
          existing.mesh.geometry = geometry;
        } else {
          const mesh = new THREE.Mesh(geometry, this.material);
          mesh.position.set(resp.cx * CHUNK_SIZE, resp.cy * CHUNK_SIZE, resp.cz * CHUNK_SIZE);
          this.scene.add(mesh);
          existing.mesh = mesh;
        }
      }
      // blockData and grassColors are NOT updated — we keep the originals
    }
    this.dispatchNext();
    return; // Skip the rest of the normal path
  }

  // ... (rest of existing onWorkerResult code unchanged)
```

**Step 7: Verify TypeScript compiles**

```bash
cd 07-advanced-terrain && npx tsc --noEmit
```

Expected: no errors. Fix any type errors (e.g., `WorkerRequest` needs `remesh?`, `blockData?`, `grassColors?` — added in Task 4).

**Step 8: Verify lighting in browser**

```bash
npm run dev
```

Expected results:
- Above-ground blocks are lit at full brightness (skylight level 15)
- Caves are dark (light level 0 = pitch black unless near Lava/Glowstone)
- Lava and Glowstone clusters glow orange/yellow, spreading warm light ~14 blocks
- Light transitions smoothly (1 level per block, so a 14-block gradient from source to darkness)
- Moving around causes the world to reload chunks — light updates correctly after each movement burst

If Lava/Glowstone lights are visible but skylight makes everything equally bright, check the skylight seeding loop — `inSky` must reset to `true` for each (lx, lz) column.

**Step 9: Commit**

```bash
git add 07-advanced-terrain/src/world.ts
git commit -m "feat(07): wire LightEngine into world — BFS lighting with skylight and point lights"
```

---

## Done

At this point, the full BFS lighting system is live:
- Lava and Glowstone placed in terrain
- `LightEngine` computes a global BFS light grid after each chunk generation wave
- Dirty chunks are re-meshed with light data baked into vertex colors
- Skylight floods down from open sky; Lava/Glowstone spread point light underground
