# 09 — Density Terrain

Prototype: replace 08's heightmap pipeline with a unified 3D density field. Splines drive `(offset, factor, jaggedness)` 2D fields; density is sampled on a coarse 5×3×5 corner grid, trilerped per voxel, and a per-voxel detail noise is added before the sign test. Solid iff density ≥ 0. Cliffs, plateaus, overhangs, and caves all emerge from the single density field.

Spec: `docs/superpowers/specs/2026-05-10-09-density-terrain-design.md`. Plan: `docs/superpowers/plans/2026-05-10-09-density-terrain.md`.

## How it works

Per voxel `(wx, wy, wz)`:

```
base     = (offset(wx,wz) - wy) * factor(wx,wz)
envelope = clamp(1 - |wy - offset(wx,wz)| / jaggedFalloff, 0, 1)
jagged   = jaggedness(wx,wz) * envelope * fbm3D(wx, wy, wz)   // sampled at corners, trilerped
caves    = caveStrength(wy) * caveMask(wx, wy, wz)
detail   = perlin3D(wx, wy, wz) * surfaceEnv * dramaAmp        // per-voxel, post-trilerp
density  = base + jagged - caves + detail
```

Splines reinterpreted from 08's height-driven shape:

- **Continentalness → offset** — primary surface y. A near-step continent spline (deep ocean → shore plateau → inland → mountains) gives distinct regimes.
- **Erosion → offset bonus + factor** — low erosion produces sharp factor (cliffs); high erosion produces a soft factor (rolling).
- **Peaks & Valleys → offset wobble + jaggedness amplitude** — controls how much 3D noise contribution goes into density.

Two more terms keep the silhouette interesting beyond what splines + 3D-corner-grid alone can do:

- **Height perturbation** (in `offsetFactor.ts`) — a 2D fBm shifts `offset` by up to ±80 voxels, gated by `erosionDamp`, so column-scale peaks and valleys exist independently of continentalness.
- **Spire perturbation** — a second 2D noise gated by a "mountain climate" mask (low erosion + high continentalness) adds up to ±60 more voxels of column-scale variation, producing tall narrow peaks.
- **Per-voxel detail noise** (in `chunkDensity.ts`) — added after the trilerp to produce sub-cell sign oscillation. Without it the trilerp interpolates linearly between 4×8×4-spaced corners and overhangs are impossible. Amplitude is gated by `jaggedness × spireMask`, so deserts and plains stay smooth while mountains and windswept get rocky chaos.

## Knobs (debug panel → "Density Field")

- `jaggedScale` / `jaggedFalloff` / `jaggedOctaves` — 3D jagged noise frequency, vertical envelope, octave count
- `caveScale` / `caveThreshold` / `caveDepthRange` — cave network shape, intersection threshold, depth distribution
- `factorMin` / `factorMax` — clamp range on the per-column factor (low = squashed, high = cliffy)

Tunables hardcoded in source (worth editing for serious experiments):

- `HEIGHT_PERTURB_*` and `SPIRE_*` — `offsetFactor.ts:20-32`
- `DETAIL_*` — `chunkDensity.ts:5-12`
- `JAGGED_GAIN` — `offsetFactor.ts:57`
- Per-biome `terrainDrama` — `biomes.ts` (currently unused but available for biome-driven detail tuning)

## Known prototype limitations

- **No erosion, no rivers** — both were heightmap-coupled in 08. Out of scope.
- **Cave-biome floor classification disabled** — the `pickBiome`-based floor system in 08 was tied to the legacy intersecting-noise cave carving and was not re-derived for density caves.
- **Trees use soft-surface (offset) y for both in-chunk and halo placement** — guarantees cross-chunk consistency for canopies but may visibly float or sink 1–2 voxels in jagged terrain.
- **`ChunkResult.heightMap` is the highest solid voxel y** — walking off the edge of an overhang sees the heightmap "lie" (same approximation `walkController` lives with today).
- **Trilerp 8-voxel cells limit overhang complexity** — at most one sign flip per cell vertically. Real Minecraft-style overhang stacks would need finer cells or full per-voxel density.

## Files

- `src/offsetFactor.ts` — splines + climate → `(offset, factor, jaggedness, spireMask)` per column
- `src/densityField.ts` — single-point density formula (base + jagged + cave)
- `src/chunkDensity.ts` — coarse-grid corner sampling + trilerp + per-voxel detail → solid mask
- `src/chunk.ts` — voxelization, biomes, ores, structures, trees, decorations
- `src/splines.ts` — spline data shape (unchanged from 08; semantics retuned)
- `src/biomes.ts` — biome defs include 09-only `terrainDrama` field

## Run

```
npm install
npm run dev   # http://localhost:5182
```

Or via Docker: `docker compose up density-terrain`.
