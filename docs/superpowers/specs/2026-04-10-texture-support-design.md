# Texture Support for Block Rendering — Design Spec

**Date:** 2026-04-10  
**Project:** `07-advanced-terrain`  
**Approach:** Per-face quads + texture atlas (Approach A)

---

## Overview

Replace the current flat vertex-color block rendering with image-based texture mapping. Start with a procedurally generated placeholder atlas; the placeholder can later be swapped for a real PNG atlas without changing anything else.

---

## Section 1 — Atlas Structure

- Single `CanvasTexture` generated at startup in `src/textureAtlas.ts`
- Dimensions: **128×128 px**, laid out as an **8×8 grid of 16×16 px tiles** (64 slots)
- Tile slots addressed by integer index 0–63
- `texture.magFilter = THREE.NearestFilter` for pixel-art look
- `texture.minFilter = THREE.NearestFilter`
- `texture.flipY = false` — disables THREE.js's default vertical flip so V=0 is canvas-top and UV math is straightforward
- To swap in a real atlas: replace `buildAtlasTexture()` with a PNG load — no other changes needed

Constants (exported from `textureAtlas.ts`):
```ts
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
export const TILE_SIZE  = 16; // px
```

---

## Section 2 — Block Tile Mapping

`BlockDef` in `blocks.ts` gains a `tiles` field:

```ts
export interface BlockDef {
  name: string;
  color: number;
  solid: boolean;
  transparent: boolean;
  lightEmit: number;
  tiles: { top: number; side: number; bottom: number };
}
```

**Face-distinct blocks:**

| Block | Top tile | Side tile | Bottom tile |
|-------|----------|-----------|-------------|
| Grass | grass-top | grass-side | dirt |
| OakWood | oak-end | oak-bark | oak-end |
| BirchWood | birch-end | birch-bark | birch-end |
| SpruceWood | spruce-end | spruce-bark | spruce-end |

All other blocks use the same tile index for top, side, and bottom.

**Placeholder tile rendering** (in `buildAtlasTexture()`):
- Base fill using the block's existing `color` from `BLOCK_DEFS`
- Noise pass: random per-pixel brightness variation (±15%) to break up flat appearance
- Grass top: scattered darker green dots
- Grass side: green strip along the top edge, dirt base below
- Wood end: concentric ring pattern
- Wood bark: vertical streak pattern

---

## Section 3 — Mesher Changes

### MeshData

```ts
export interface MeshData {
  positions: number[];
  normals:   number[];
  colors:    number[];   // kept for tinting (grass biome color)
  uvs:       number[];   // NEW: 2 floats per vertex
  indices:   number[];
}
```

### Algorithm

The greedy merge loops are removed. Each visible face emits one quad immediately:

```
for each face direction (axis, dir):
  for each slice d along axis:
    for each (i, j) in the slice:
      if face is visible:
        determine face type (top / side / bottom)
        look up tileIdx from block's tiles.{top|side|bottom}
        compute UV corners from tileIdx
        emit quad (4 vertices, 6 indices)
```

**Face type mapping:**
- `axis === 1, dir === +1` → `top`
- `axis === 1, dir === -1` → `bottom`
- `axis === 0 or 2` → `side`

**UV corner computation:**
```ts
const col = tileIdx % ATLAS_COLS;
const row = Math.floor(tileIdx / ATLAS_COLS);
const u0 = col / ATLAS_COLS,       u1 = (col + 1) / ATLAS_COLS;
const v0 = row / ATLAS_ROWS,       v1 = (row + 1) / ATLAS_ROWS;
// With flipY=false: v0 = top of tile, v1 = bottom of tile (canvas-space)
// corners: (u0,v0), (u1,v0), (u1,v1), (u0,v1)
```

**Vertex colors:**
- Grass block top and side faces: biome tint from `grassColors[z * CHUNK_SIZE + x]`
- Grass block bottom face (dirt): `(1.0, 1.0, 1.0)` — white, no tint
- All other blocks: `(1.0, 1.0, 1.0)` — white, so `map × vertexColors = map`
- Directional shading and light factor applied as before

The `grassColors` array and per-column tinting logic in the worker remain unchanged.

---

## Section 4 — Material and Rendering Changes (`world.ts`)

**Construction:**
```ts
const atlasTexture = buildAtlasTexture(); // new
this.material = new THREE.MeshLambertMaterial({
  vertexColors: true,
  map: atlasTexture,  // new
});
```

**Geometry upload** — add uv attribute:
```ts
geometry.setAttribute("uv", new THREE.Float32BufferAttribute(resp.uvs, 2));
```

**Disposal:**
```ts
atlasTexture.dispose(); // added to dispose()
```

No other changes to `world.ts`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/textureAtlas.ts` | **New** — atlas generation, tile constants |
| `src/blocks.ts` | Add `tiles` to `BlockDef`, assign tile indices in `BLOCK_DEFS` |
| `src/mesher.ts` | Replace greedy merge with per-face quad emitter, emit `uvs` |
| `src/world.ts` | Build atlas, update material, add `uv` geometry attribute |

Worker (`worker.ts`) and chunk data (`chunk.ts`) are unchanged.

---

## Out of Scope

- Animated textures (water, lava)
- Normal maps / PBR materials
- Ambient occlusion per vertex
- Transparent block face sorting (glass, water)
