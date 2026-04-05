# BFS Block Lighting — Design Spec

**Project**: `07-advanced-terrain`
**Date**: 2026-04-05

---

## Overview

Add Minecraft-style per-voxel block lighting to project 07. Light levels (0–15) are computed via BFS across all loaded chunks on the main thread, then baked into vertex colors at mesh time. Two light source types: skylight (propagates downward from open sky) and emissive blocks (Lava, Glowstone).

---

## 1. New blocks and data model

### New block types (`blocks.ts`)

| Block      | ID | `lightEmit` | Placement                                 |
|------------|----|-------------|-------------------------------------------|
| `Lava`     | 26 | 15          | Deep underground pools/pockets            |
| `Glowstone`| 27 | 15          | Cave ceilings, scattered in cave walls    |

All existing blocks get `lightEmit: 0`.

### `BlockDef` change

```ts
interface BlockDef {
  name: string;
  color: number;
  solid: boolean;
  transparent: boolean;
  lightEmit: number;   // NEW: 0 = non-emissive, 1–15 = emits that level
}
```

### Light grid

A separate `Map<chunkKey, Uint8Array>` (same `CHUNK_SIZE³` shape as `blockData`) stores light levels 0–15. Owned by a new `LightEngine` class on the main thread. Decoupled from block data — no change to block byte encoding.

---

## 2. BFS algorithm (`lighting.ts`)

New file. `LightEngine` class with one primary method: `recompute(chunks)`.

### Seeding

Two source types seed the BFS queue:

1. **Skylight**: For each X/Z column across all loaded chunks, scan downward to the first opaque block. Every block above it (transparent/air) is set to level 15 and enqueued.
2. **Block lights**: Scan all loaded chunks for Lava and Glowstone. Each emissive block is enqueued at its `lightEmit` level (15).

### Propagation rule

Pop a block at level `L`. For each of its 6 axis-aligned neighbors:
- Skip if neighbor is opaque (`!BLOCK_DEFS[block].transparent`)
- If neighbor's current light level < `L - 1`, set it to `L - 1` and enqueue

Falloff: 1 per step → max reach of 14 blocks from a level-15 source.

### Dirty detection

After BFS, compare new vs. old light arrays per chunk. Return a `Set<chunkKey>` of chunks where any block's light level changed. Only those chunks are re-meshed.

---

## 3. Orchestration (`world.ts`)

### New state

```ts
private lightEngine: LightEngine;
private lightDirty = false;
```

### Trigger

At the end of `onWorkerResult`, after `dispatchNext()`:

```ts
if (pendingQueue.length === 0 && inFlight.size === 0 && this.lightDirty) {
  this.runLightPass();
}
```

`lightDirty` is set to `true` whenever a chunk is added or removed.

### Light pass sequence

1. `lightEngine.recompute(this.chunks)` → returns `Set<chunkKey>` of dirty chunks
2. For each dirty chunk: re-dispatch to a worker with **copies** of `blockData` and `lightData` (`new Uint8Array(chunk.blockData)` and `new Uint8Array(lightSlice)`). Copies are required — transferring the originals would detach them from main-thread storage.
3. Worker returns re-meshed geometry → swap out the old `THREE.Mesh` geometry in-place (dispose old, assign new)
4. Clear `lightDirty`

### First-pass behaviour

`WorkerRequest.lightData` is optional. On first-pass generation (no light data yet), the mesher renders blocks at full brightness (`lightFactor = 1.0`). A brief full-bright flash before the light pass completes is acceptable.

---

## 4. Worker protocol (`worker.ts`)

`WorkerRequest` gains:

```ts
lightData?: Uint8Array   // optional, CHUNK_SIZE³, values 0–15
```

`lightData` is transferred (zero-copy) alongside `blockData` when present.

---

## 5. Mesher changes (`mesher.ts`)

`buildChunkMesh` gains a new parameter:

```ts
function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: Uint8Array | null,   // NEW
): MeshData
```

### Vertex color calculation

```ts
const lightFactor = lightData ? lightData[chunkIndex(x, y, z)] / 15 : 1.0;

const sr = r * shade * lightFactor;
const sg = g * shade * lightFactor;
const sb = b * shade * lightFactor;
```

Existing directional `shade` (top = 1.0, X-sides = 0.7, Z-sides = 0.8, bottom = 0.5) is preserved and multiplied with `lightFactor`. No forced ambient minimum — caves are pitch black unless lit.

---

## 6. Terrain generation (`chunk.ts`)

Both placements use `createNoise(seed + N)` with unused seed offsets. No new noise infrastructure needed.

### Lava placement

Only runs in chunks with `cy <= -1` (world Y ≤ -1 — the deep underground layers). After cave carving, for each cave block in that chunk:

```
if noise(x/20, z/20) > 0.7 → replace Cave with Lava
```

Creates small pools and rivers at depth. The `cy` guard is checked in `generateChunk` before running this pass.

### Glowstone placement

After cave carving, scan for `Cave` blocks with a solid block directly above (ceiling detection):

```
if grid[above] is solid AND noise(x/15, z/15) > 0.65 → replace Cave with Glowstone
```

Seeded with a different noise offset from Lava to prevent co-location.

---

## Files changed

| File | Change |
|------|--------|
| `blocks.ts` | Add `Lava`, `Glowstone`; add `lightEmit` to `BlockDef` and all entries |
| `lighting.ts` | **New file** — `LightEngine` class with BFS |
| `chunk.ts` | Add Lava + Glowstone placement passes in `generateChunk` |
| `worker.ts` | Add optional `lightData` to `WorkerRequest`; pass to mesher |
| `mesher.ts` | Accept `lightData` param; apply `lightFactor` to vertex colors |
| `world.ts` | Add `LightEngine`, `lightDirty` flag, `runLightPass()` method |
