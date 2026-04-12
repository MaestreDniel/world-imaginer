# Caves & Lakes Redesign (project 07)

**Date:** 2026-04-12
**Scope:** `07-advanced-terrain`

## Problem

The current cave generation in `07-advanced-terrain/src/chunk.ts` produces small disconnected "craters" rather than connected cave systems:

1. **Main cave pass** (chunk.ts:219–227) thresholds a single 3D fBm field (`caveVal > threshold`). Thresholding an isotropic fBm gives spherical blobs, not tunnels, so caves don't form paths and don't branch.
2. **Surface erosion pass** (chunk.ts:244–270) carves additional air pockets within the top ~8 blocks using a *separate* noise field, producing the visible surface craters in the reference screenshot. Because it uses a different noise seed than the main cave field, these openings are isolated and don't connect to anything below.
3. **No lakes/aquifers**: the only water comes from the global `waterLevel` ocean fill. There is no way for a lake to exist at elevation or for a cave to contain groundwater.

## Goals

1. Caves form **connected, winding, deeper-going tunnel networks** instead of isolated pockets.
2. Caves that reach the surface act as **entrances to the underground system**, not as disconnected craters.
3. **Lakes and aquifers** can exist at arbitrary elevations, independent of the global water level. A single mechanism unifies surface ponds and underground flooded caverns.
4. Frequency of surface water features is reduced compared to the current "crater" density.

## Non-goals

- No changes to biomes, mesher, lighting, rendering, or the block palette.
- No changes to the main terrain height pipeline, rivers, or erosion.
- No new block types — existing `Block.Air`, `Block.Water`, `Block.Lava` are reused.

---

## Design

### Overview of changes

- `src/chunk.ts` — replace cave pass, delete surface-erosion pass, add aquifer pass.
- `src/generationParams.ts` — replace `CaveParams`, add `AquiferParams`.
- `src/debugPanel.ts` — expose new knobs, remove old surface-erosion controls.

No other files change.

### New order of operations in `generateChunk`

1. Height generation + rivers + erosion (unchanged)
2. Main voxel fill — terrain, biomes, ores, **new cave test**
3. ~~Surface erosion pass~~ **deleted**
4. **New: aquifer pass** — floods caves and creates surface ponds
5. Lava pass (unchanged; only converts Air → Lava, so aquifer water is preserved)
6. Glowstone pass (unchanged)
7. Structure placement (unchanged)

---

### 1. Caves: intersecting-noise tubes with depth bias

Replace the single-fbm test at chunk.ts:219–227 with a two-field intersection.

**Algorithm:**

```
yScaled = y / (scale * verticalStretch)
n1 = caveNoiseA.fbm3D(x/scale, yScaled, z/scale, octaves, 0.5, 2.0)
n2 = caveNoiseB.fbm3D(x/scale, yScaled, z/scale, octaves, 0.5, 2.0)
t  = min(thresholdMax, thresholdBase + depth * depthGain)
isCave = (depth >= minDepth) && (abs(n1) < t) && (abs(n2) < t)
if isCave:
  block = (wy <= waterLevel) ? Block.Water : Block.Air
```

**Why it works:**

- Each `|fbm| < t` defines a 2D iso-surface in 3D space. The **intersection** of two independent such surfaces is a 1D curve → a winding tube. This is the standard Minecraft-style technique for connected cave tunnels.
- `verticalStretch > 1` divides the y coordinate by a **larger** number, so the noise field varies slowly in y. Iso-surfaces become near-horizontal slabs, and the intersection of two near-horizontal slabs is a near-horizontal line → tunnels prefer horizontal orientation (caves run sideways, not straight up).
- Depth-biased threshold `t(depth)` starts tight near the surface (rare tubes) and grows deeper (wider, more common networks). Flips the current surface-biased behavior.
- **`minDepth = 2`** protects the top-most surface block (grass/sand/snow) and the first sub-surface block below it, so caves can't carve a floating grass overhang. Caves CAN still reach the surface — but because they come from the same two noise fields as the deep tunnels, any surface-breaching tube is by construction a continuation of the underground system below it, i.e. a real entrance. The unified field is exactly what distinguishes entrances from the old disconnected craters.

**Block replacement:** carved cells become `Block.Water` if `wy <= waterLevel` else `Block.Air`. This matches current behavior and preserves the ocean fill in columns beneath the global sea level. The aquifer pass (§2) may further flood Air cells.

**New `CaveParams`:**

```ts
interface CaveParams {
  scale: number;           // 22     — noise scale for tunnel sizing
  octaves: number;         // 3
  verticalStretch: number; // 2.0    — >1 elongates noise vertically → horizontal tunnels
  thresholdBase: number;   // 0.06   — tight tubes near surface (rare openings)
  thresholdMax:  number;   // 0.16   — wider networks deep
  depthGain:     number;   // 0.004  — per-block threshold growth with depth
  minDepth:      number;   // 2      — protects top 2 blocks (grass + first sub-surface)
}
```

**Deletions:**

- `surfaceErosionScale`, `surfaceErosionThreshold`, `surfaceErosionDepth` removed from `CaveParams`.
- The entire surface-erosion loop at chunk.ts:244–270 is deleted.
- The `erosionNoise` variable at chunk.ts:246 is deleted.

**Noise seeds:** `seed + 1` (caveNoiseA, existing), `seed + 9` (caveNoiseB, new).

---

### 2. Aquifers and surface ponds via water-table noise

A new pass runs after caves and before lava. It uses two noise fields:

- **Presence field** — low-frequency 3D noise that marks "this region has water."
- **Level field** — 2D noise that defines the local water surface height within a region.

**Algorithm (per voxel):**

```
presence = aquiferPresence.fbm3D(x/presenceScale, y/(presenceScale*2), z/presenceScale, 2, 0.5, 2.0)
if presence > presenceThreshold:
  localY = aquiferLevel.fbm2D(x/levelScale, z/levelScale, 2, 0.5, 2.0) * levelAmplitude + levelOffset
  if wy <= localY and data[voxIdx] == Block.Air:
    data[voxIdx] = Block.Water
```

**Why it produces both aquifers and surface ponds:**

- **Underground**: cave air cells below the local water level get flooded. Multiple disconnected aquifers appear naturally wherever the presence field crosses threshold — each cave network can have its own water level.
- **Surface ponds**: when presence is high above terrain and the local level sits slightly above ground, the surface air column up to `localY` fills with water → a pond sitting on the terrain, potentially well above global `waterLevel`.
- **Global ocean unaffected**: the main voxel-fill pass already writes `Block.Water` for all cells with `wy <= waterLevel`. The aquifer pass only converts `Air → Water`, so existing ocean tiles are untouched.
- **Frequency control**: `presenceThreshold` is the main knob — higher → rarer lakes and aquifers.

**New `AquiferParams`:**

```ts
interface AquiferParams {
  enabled: boolean;          // true
  presenceScale: number;     // 160  — large → sparse regions
  presenceThreshold: number; // 0.35 — higher → rarer
  levelScale: number;        // 80   — 2D scale of the local water surface
  levelAmplitude: number;    // 8    — wobble of the local water surface
  levelOffset: number;       // 2    — bias above global waterLevel
}
```

Added to `GenerationParams`:

```ts
interface GenerationParams {
  terrain: TerrainParams;
  erosion: ErosionParams;
  caves: CaveParams;
  aquifers: AquiferParams;   // new
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
}
```

**Noise seeds:** `seed + 10` (presence), `seed + 11` (level).

**Interaction with lava pass:** lava placement only replaces `Block.Air`, so any water written by the aquifer pass is preserved. This means deep aquifers and deep lava coexist as distinct features — an aquifer in a lava-eligible chunk will not be replaced.

---

### 3. Debug panel updates

In `src/debugPanel.ts`:

- **Add** controls for new cave fields: `scale`, `verticalStretch`, `thresholdBase`, `thresholdMax`, `depthGain`, `minDepth`.
- **Add** controls for new aquifer fields: `enabled`, `presenceThreshold`, `levelAmplitude`, `levelOffset`.
- **Remove** controls for `surfaceErosionScale`, `surfaceErosionThreshold`, `surfaceErosionDepth`.

---

## Parameter summary

| Group | Field | Default | Purpose |
|---|---|---|---|
| caves | scale | 22 | Tunnel sizing |
| caves | octaves | 3 | Noise detail |
| caves | verticalStretch | 2.0 | Horizontal tunnel preference |
| caves | thresholdBase | 0.06 | Surface rarity |
| caves | thresholdMax | 0.16 | Deep density cap |
| caves | depthGain | 0.004 | Per-block growth |
| caves | minDepth | 2 | Top-blocks protection |
| aquifers | enabled | true | Master toggle |
| aquifers | presenceScale | 160 | Region size |
| aquifers | presenceThreshold | 0.35 | Rarity |
| aquifers | levelScale | 80 | Local water surface scale |
| aquifers | levelAmplitude | 8 | Local surface wobble |
| aquifers | levelOffset | 2 | Bias vs global waterLevel |

---

## Acceptance criteria

1. Fresh terrain generation shows **no isolated surface craters**; the brown-patch artifact from the reference screenshot is gone.
2. Inspecting underground at various X/Z positions reveals **connected, winding tunnels** that branch and persist over many blocks, not isolated pockets.
3. Caves deeper in the world are **denser** than near the surface.
4. Caves that do reach the surface are **continuations of underground tunnels** — stepping into one leads into a larger system.
5. Lakes of varying sizes appear at elevations **above, at, and below** the global water level.
6. Some underground cave chambers are **flooded with water** (aquifers), not just air.
7. The global ocean fill (everything at/below `waterLevel` outside lakes) is unchanged.
8. Debug panel exposes all new knobs; changing `presenceThreshold` visibly changes lake frequency; changing `depthGain` visibly changes cave density with depth.

## Out of scope / explicit non-goals

- No agent/walker tunnels, no Voronoi F2–F1 caves.
- No lake shore decoration (sand rings around ponds).
- No water flow simulation — aquifers and ponds are static fills.
- No changes to river carving, erosion, or structure placement.
