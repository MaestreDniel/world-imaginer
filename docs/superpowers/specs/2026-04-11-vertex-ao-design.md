# Vertex Ambient Occlusion — Design Spec

## Overview

Add per-vertex ambient occlusion (AO) to the voxel mesher in project 07. Each vertex of a visible block face checks its 3 neighboring voxel positions (2 edge-adjacent + 1 corner-diagonal). The count of solid neighbors (0–3) maps to a brightness multiplier that is baked into vertex colors during meshing. This creates smooth shadow gradients where blocks meet edges and corners, at zero runtime GPU cost.

## AO Table

```
AO_TABLE = [1.0, 0.80, 0.60, 0.45]
```

Index = number of solid occluders around a vertex corner. Moderate intensity — clear depth definition without looking heavy-handed.

## Algorithm

### Per vertex of each visible face:

1. Given the face's axis/direction and the vertex's corner position on the quad, identify the 2 edge neighbors and 1 corner neighbor in the plane perpendicular to the face normal.
   - For a face on axis `A` with tangent axes `U` and `V`, a vertex at corner `(+U, +V)` checks:
     - Edge 1: offset `+U` along the face plane
     - Edge 2: offset `+V` along the face plane  
     - Corner: offset `+U, +V` (diagonal)
2. Sample each position from `ChunkData` using the existing `data[]` array for in-bounds positions or `getNeighbor()` for boundary voxels.
3. A position counts as an occluder if the block there is **not transparent** (i.e., `!BLOCK_DEFS[blockId].transparent` or `blockId` is nonzero and not transparent). Use the same `BLOCK_DEFS[id].transparent` check already in the mesher.
4. Count occluders (0–3). **Special case:** if both edge neighbors are solid, the corner is forced to count as solid too (since the corner is visually hidden behind both edges). This gives the standard formula:
   - `if (side1 && side2) ao = 0` (meaning 3 occluders)
   - `else ao = 3 - (side1 + side2 + corner)`
   - Maps `ao` value (0–3) through `AO_TABLE[3 - ao]` ... or equivalently, `occluderCount = side1 + side2 + corner` (with the forced-corner rule), then `AO_TABLE[occluderCount]`.
5. Look up `AO_TABLE[occluderCount]` → `aoFactor`.

### Combining with existing shading

AO multiplies into vertex color alongside the existing factors:

```
finalColor = biomeColor × directionalShade × lightFactor × aoFactor
```

This replaces the current per-face uniform color with per-vertex varying color, which is what creates the smooth gradient across each quad.

### Quad diagonal flipping

After computing AO for all 4 vertices of a face (`ao0, ao1, ao2, ao3` for corners 0–3):

- Compare diagonal sums: `ao0 + ao2` vs `ao1 + ao3`
- If `ao0 + ao2 < ao1 + ao3`, flip the triangle split:
  - Positive-dir faces: use `(0,1,3), (1,2,3)` instead of `(0,1,2), (0,2,3)`
  - Negative-dir faces: reverse winding accordingly
- This ensures the GPU interpolates along the lower-valued diagonal, preventing bright seam artifacts on faces with asymmetric AO.

## Files Changed

### `mesher.ts`

- Add `AO_TABLE` constant at module level.
- Add helper function to compute AO for a single vertex given the face axis, direction, vertex corner offsets, and block data access.
- In the per-face loop inside `buildChunkMesh()`:
  - Compute `aoFactor` for each of the 4 quad vertices.
  - Multiply `aoFactor` into the vertex color (`sr`, `sg`, `sb`) alongside existing `shade` and `lightFactor`.
  - After computing all 4 AO values, apply the diagonal flip logic to the index emission.

### No other files change

- `lighting.ts` — Skylight propagation is independent of AO.
- `worker.ts` — Already passes `data` and `getNeighbor` to the mesher; no interface change needed.
- `world.ts` — No changes.
- `blocks.ts` — Uses existing `transparent` property; no changes.
- `main.ts` — No changes. `MeshLambertMaterial` with `vertexColors: true` already interpolates per-vertex colors across triangles.

## Performance Impact

- **Meshing time:** Small increase. For each visible face, 4 vertices × 3 neighbor lookups = 12 array reads per face. These are cheap index lookups into `Uint8Array`. Typical overhead: ~5-10% on mesh build time.
- **Mesh size:** Unchanged. Same number of vertices and indices (quad flipping only reorders indices, doesn't add any).
- **GPU cost:** Zero. AO is baked into vertex colors.
