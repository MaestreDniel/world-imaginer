# 09 — Density Terrain (Design)

Date: 2026-05-10
Status: Approved (brainstorm)

## Problem

Project 08's spline-driven terrain produces a 2D heightmap: one `surfaceH(x, z)` per column, applied as a hard ceiling in the chunk fill loop (`08-spline-terrain/src/chunk.ts:208`). Three independent height contributions (continent, erosion, peaks-and-valleys) are summed, then clamped to `[minHeight, maxHeight]`.

Two consequences:

1. **Height is welded to continentalness.** With additive composition and a smooth continent ramp, every change in continentalness moves the surface. Saturating the continent contribution near `maxHeight` clips peaks-and-valleys variation. The Minecraft splines achieve regime-distinct silhouettes (deep ocean, shore plateau, inland plateau, mountains) that the 08 system cannot reproduce.
2. **No silhouette character.** A pure heightmap is smooth in 3D — every column has exactly one ground voxel, no overhangs, no cliffs that don't trace a spline curve, no rock outcrops, no pillars.

We want to prototype the production approach: a unified 3D density field where solid/air is decided per voxel, splines drive `(offset, factor, jaggedness)` 2D fields, and 3D noise produces the actual silhouette character.

## Goal

Build `09-density-terrain/` — a clone of 08 with the height-based pipeline replaced by a 3D density field. Caves, cliffs, plateaus, and overhangs all emerge from one field. Validate that the silhouette behavior is meaningfully richer than 08 while staying within ~2× the chunk-generation cost.

## Non-goals

- Re-deriving hydraulic erosion or river carving for the density field. Both are dropped from 09.
- Cave-biome floor classification (the `pickBiome` cave biome system in 08). Defer until density-only caves are stable; revisit later.
- Production polish on cross-chunk surface artifacts. Documented limitations are acceptable.
- Any change to mesher / lighting / day-night / walk controller / map view. They read the same `ChunkResult` shape.

## Design

### Architecture overview

For any world point `(x, y, z)`, a scalar `density` decides solid (`density >= 0`) or air (`density < 0`). Splines no longer produce a height; they produce three 2D fields per column:

- `offset(x, z)` — the y where ground "wants to be"
- `factor(x, z)` — vertical bias steepness; high = sharp transitions / cliffs even with no 3D noise
- `jaggedness(x, z)` — amplitude of the 3D noise term that gives peaks their irregular silhouette

### Density formula

Per voxel `(wx, wy, wz)`:

```
base     = (offset(wx,wz) - wy) * factor(wx,wz)
envelope = clamp(1 - abs(wy - offset(wx,wz)) / J_FALLOFF, 0, 1)
jagged   = jaggedness(wx,wz) * envelope * fbm3D(wx/J_SCALE, wy/J_SCALE, wz/J_SCALE)
n1       = fbm3D_caveA(wx/CAVE_SCALE, wy/CAVE_SCALE, wz/CAVE_SCALE)
n2       = fbm3D_caveB(wx/CAVE_SCALE, wy/CAVE_SCALE, wz/CAVE_SCALE)
caveMask = max(0, CAVE_T - max(abs(n1), abs(n2)))   // >= 0 inside intersecting tunnels
cave     = caveStrength(wy) * caveMask              // ramps up below sea level, falls off near bedrock
density  = base + jagged - cave
```

Solid iff `density >= 0`.

The vertical envelope on `jagged` keeps 3D noise from spawning floating solid chunks far from the surface. `caveStrength(wy)` is a depth-dependent scalar so caves are denser deep underground and absent in the sky.

### Spline reinterpretation

The `TerrainShape` data shape from `08-spline-terrain/src/splines.ts` is preserved — the curves are now interpreted as:

- `continent` spline → `offset` contribution from continentalness
- `erosionByContinent` → adjusts `offset` and contributes to `factor`
- `pvByErosion` → adjusts `offset` and contributes to `jaggedness`

`DEFAULT_TERRAIN_SHAPE` values are retuned for the new interpretation. The spline editor UI keeps the same controls; only labels change ("Continentalness → height" becomes "Continentalness → offset", etc.).

### Sampling: coarse cells + trilerp

Density is evaluated on a coarse cell grid, then trilerped to per-voxel. Cell dimensions: 4 voxels horizontal, 8 voxels vertical (matching MC). A 16³ chunk maps to 4×2×4 = 32 cells, with 5×3×5 = 75 corner samples.

Per-chunk cost (rough): 75 corners × ~4 fbm3D calls = ~300 noise calls. Compare 08's heightmap: 256 columns × 3 fbm2D = 768 calls. Net is rough parity per-call, possibly favorable; trilerp adds 4096 cheap multiply-adds.

Same `(wx, wy, wz)` always returns the same density (corners are recomputed per chunk, not shared), so chunk seams are seamless. Redundant work at boundaries is ~13% overhead — acceptable.

### Chunk pipeline

Replaces `08-spline-terrain/src/chunk.ts:54-308`. New steps:

1. **Climate sampling** — unchanged from 08.
2. **Spline → offset/factor/jaggedness** — per-column 2D field evaluation. Three `Float32Array(256)` buffers.
3. **Coarse density grid** — allocate `Float32Array(75)`, evaluate density at each corner.
4. **Trilerp expansion** — fill a `Uint8Array(4096)` solid mask by trilerping density across each cell's 4×8×4 voxels (sign-test only; no scalar density retained per voxel).
5. **Voxelize to blocks** — single pass over 4096 voxels:
   - Air or water depending on `wy <= waterLevel`
   - Solid: depth-based block (top = surface, next 4 = sub-surface, deeper = stone/deepstone), biome-aware
   - "Depth" = distance to nearest air voxel above, tracked top-down per column. Cave ceilings get correct surface treatment.
6. **Derive heightmap** — top-down scan per column for highest solid voxel → `heights[colIdx]`. Sentinel for fully-air columns.
7. **Biome / grass / surface paint** — unchanged from 08, reads `heights[]` from step 6.
8. **Aquifers** — same as `08-spline-terrain/src/chunk.ts:317-355`, reads `heights[]`.
9. **Lava / glowstone / bedrock** — unchanged.
10. **Structures + vegetation** — same logic. Structures (houses, pyramid, igloo) read `heights[]` from step 6 (no halo). Trees read **soft offset** for both in-chunk and halo placement (see "Two surfaces" below).

### Two surfaces: hard vs. soft

The 3D density field admits multiple solid/air transitions per column (overhangs, caves), so there is no canonical "surface y." Two derivations coexist:

- **Hard surface** — the actual top-solid voxel y, derived from the voxel grid (step 6). Used for in-chunk surface block painting, aquifer ceiling, ore depth, structure foundation, in-chunk tree y. Available only after the chunk is voxelized.
- **Soft surface** — `offset(wx, wz)` from the splines, no 3D noise applied. Pure 2D, evaluable at any world coordinate. Used for halo lookups (cross-chunk tree canopies) and as the placement reference for vegetation across the board.

**Tree placement uses soft surface for both in-chunk and halo.** This guarantees cross-chunk consistency: a tree placed by chunk A whose canopy crosses into chunk B uses the same soft-surface y as chunk B will when it generates. Trees may visibly float or sink 1-2 voxels relative to the rendered surface in jagged terrain. Documented as a known prototype artifact in `09-density-terrain/README.md`.

Mismatch budget (`|hard - soft|`):
- Deep ocean / plains: ≤ 2 voxels
- Mountains: up to ~`jaggedness * envelope_max`, roughly ±8

If the artifact is visually unacceptable during prototyping, a 5-line addition skips tree placement on columns where `|hard - soft| > 4`.

### `ChunkResult.heightMap` export

The public API returns the **hard** heightmap. Walk controller and map view continue to operate. With true overhangs, walking off a cliff edge sees the heightmap report the top of the highest solid voxel, ignoring overhangs underneath. Same approximation `walkController` lives with today; production fix would derive a "highest walkable surface" per column.

### Cell grid alignment

16/4 = 4 horizontal cells, 16/8 = 2 vertical cells fits exactly inside a chunk. Corners are computed per-chunk (no neighbor sharing). Density is purely a function of world coordinates, so two chunks evaluating the same corner produce identical values — no seam mismatch.

## Files

### New

- `09-density-terrain/src/offsetFactor.ts` — replaces `terrainShape.ts`. Exports `createOffsetFactorSampler(seed, params)` returning `{ offsetAt(wx,wz), columnFields(wx,wz) -> {offset, factor, jaggedness} }`.
- `09-density-terrain/src/densityField.ts` — exports `createDensitySampler(seed, params, offsetFactor)` returning `sampleDensity(wx, wy, wz) -> number`. Single source of truth for the density formula.
- `09-density-terrain/src/chunkDensity.ts` — exports `fillChunkDensity(chunkX, chunkY, chunkZ, sampler, columnFields) -> Uint8Array(4096)` (solid mask). Allocates the 5×3×5 corner buffer, evaluates corners, trilerps.

### Modified (vs. 08)

- `src/chunk.ts` — height pipeline (lines 90-191) removed; calls `fillChunkDensity` instead. Voxel-fill loop reads solid mask. 2D-noise cave block (lines 255-293) removed. Aquifers, ores, lava, glowstone, bedrock, structures, vegetation: kept, read derived `heights[]`.
- `src/splines.ts` — `TerrainShape` shape unchanged; `DEFAULT_TERRAIN_SHAPE` y-values retuned for offset/factor/jaggedness interpretation.
- `src/generationParams.ts` — adds `density: { jaggedScale, jaggedFalloff, caveScale, caveThreshold, caveDepthRange, factorMin, factorMax }`. Drops the erosion config.
- `src/splineEditor.ts` — label updates only.
- `src/debugPanel.ts` — adds collapsible "Density" section bound to `params.density`.
- `src/main.ts` — wiring updates only.
- `README.md` — describes premise, key knobs, documented limitations.

### Removed

- `src/terrainShape.ts` — replaced by `offsetFactor.ts`.
- `src/erosion.ts` — out of scope. Imports removed.

### Reused unchanged from 08

`perlin.ts`, `biomes.ts`, `biomeBoxes.ts`, `blocks.ts`, `mesher.ts`, `worker.ts`, `lighting.ts`, `dayNight.ts`, `walkController.ts`, `textureAtlas.ts`, `climate.ts`, `structures.ts`, `mapView/`. `worker.ts` only changes via its import of the new `chunk.ts`; message protocol identical.

### Docker / config

`docker-compose.yml` gains a `09-density-terrain` service on port `5182` (08 is on 5181). `package.json` copied from 08 with name updated.

## Validation

After the first working version:

1. **Flat region (low jaggedness)** — should look essentially like 08's plains.
2. **Mountain region (high jaggedness, low erosion)** — visibly irregular peaks with cliffs, never reproducible by 08's heightmap.
3. **Ocean → shore → mountain transect** — distinct continentalness regimes still readable.
4. **Density column probe** — sample a known mountain column, confirm density crosses zero multiple times (proves overhangs / caves possible).
5. **Tree at chunk seam** — single tree placed at a chunk boundary in jagged terrain; verify canopy doesn't intersect neighbor chunk's ground.
6. **Performance baseline** — chunk-gen time within 2× of 08. If `fillChunkDensity` dominates and the budget is exceeded, drop default jagged octaves 4 → 3.

## Open knobs

Exposed in the debug panel for runtime tuning:

- `J_SCALE` — jagged-noise frequency
- `J_FALLOFF` — vertical envelope width
- `CAVE_SCALE`, `CAVE_T` — cave noise frequency and intersection threshold
- `caveStrength` ramp parameters (sea-level start, bedrock falloff)
- `factorMin`, `factorMax` — clamp range on the spline-derived factor

## Known prototype limitations (recorded in 09 README)

- No erosion, no rivers.
- Cave-biome floor classification disabled.
- Tree placement uses soft surface; may float/sink 1-2 voxels in jagged terrain.
- `ChunkResult.heightMap` reports highest solid y; walking off an overhanging cliff edge sees the heightmap "lie."
- No precomputed soft heightmap export — only `offset(wx,wz)` evaluable on demand.

## Decisions deferred

- Whether jaggedness should use one or two independent fbm3D fields blended (MC uses two). Start with one; revisit if silhouettes feel under-varied.
- Whether caves should be a separate negative term or absorbed into `jagged` by removing the envelope. Start separate (the formulation above); easier to tune independently.
