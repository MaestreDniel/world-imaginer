# Surface Vegetation — Design

Add ground-cover decorations to populated biomes: bushes (and a desert dead-bush variant), tall grass, ferns, and three flower colours. Decorations are non-solid (walkable) and rendered as Minecraft-style cross-quad sprites.

Project: `07-advanced-terrain`.

## Goals

- Visually populate the surface of every land biome with biome-appropriate ground cover.
- Keep decorations walkable (non-solid) and physics-friendly.
- Re-use the existing chunk-generation pipeline; no new mesh layers.
- Expose a global density slider in the debug panel so the user can scale or disable decorations like every other generation parameter.

## Non-goals

- No animated/swaying plants.
- No biome-specific flower palettes beyond the three shared colours (a single `FlowerRed`/`FlowerYellow`/`FlowerBlue` set is reused across all flowering biomes).
- No double-tall plants (sunflowers, double tall grass) — single-cell sprites only.
- No mushrooms or shaded-biome variants in this iteration.
- No changes to existing trees, cacti, or larger structures (pyramids, igloos, houses).

## Architecture overview

Six concrete touchpoints:

1. **Block defs** (`blocks.ts`) — 7 new block IDs and 7 new atlas tile IDs; introduce a `renderShape` field on `BlockDef`.
2. **Atlas painters** (`textureAtlas.ts`) — 7 new procedural sprite painters with alpha cutout; sprites skip the existing `extrudeTile` step.
3. **Mesher** (`mesher.ts`) — branch on `def.renderShape`. Cross blocks emit two crossed double-sided quads; cube blocks unchanged.
4. **Material** (`world.ts`) — single shared `MeshLambertMaterial` gains `alphaTest: 0.5` (cube tiles are opaque so they're unaffected).
5. **Generation pass** (`chunk.ts` + `biomes.ts`) — new decoration table on each `BiomeDef`, new placement pass after the tree pass; respects the existing tree mask.
6. **Params + UI** (`generationParams.ts`, `debugPanel.ts`) — new `vegetation` params group with `enabled` toggle and `globalDensity` / `treeDensity` sliders.

Walking through plants and lighting work without changes — `world.isSolid` already keys off `BLOCK_DEFS.solid`, and the lighting BFS already handles `transparent: true` cells.

## 1. Blocks and tiles

### Block IDs (`blocks.ts`)

```
Block.Bush         = 28
Block.DeadBush     = 29
Block.Fern         = 30
Block.TallGrass    = 31
Block.FlowerRed    = 32
Block.FlowerYellow = 33
Block.FlowerBlue   = 34
```

### Atlas tile IDs (`blocks.ts`)

```
TILE_IDS.Bush         = 31
TILE_IDS.DeadBush     = 32
TILE_IDS.Fern         = 33
TILE_IDS.TallGrass    = 34
TILE_IDS.FlowerRed    = 35
TILE_IDS.FlowerYellow = 36
TILE_IDS.FlowerBlue   = 37
```

(Atlas is 8×8 = 64 slots, currently 31 used; comfortably within budget.)

### `BlockDef` shape

Add an optional field with `"cube"` default:

```ts
export type RenderShape = "cube" | "cross";
export interface BlockDef {
  // ...existing fields...
  renderShape?: RenderShape;   // default "cube"
}
```

### `BLOCK_DEFS` entries

All seven decorations share:

```ts
{ solid: false, transparent: true, lightEmit: 0, renderShape: "cross",
  tiles: { top: TILE_IDS.<Same>, side: TILE_IDS.<Same>, bottom: TILE_IDS.<Same> } }
```

Representative colours (used only for the minimap / debug; visuals come from atlas):

| Block | Colour |
|---|---|
| Bush | `0x4A7C3A` |
| DeadBush | `0x8C6A3A` |
| Fern | `0x356C2E` |
| TallGrass | `0x69B040` |
| FlowerRed | `0xC04040` |
| FlowerYellow | `0xE8C440` |
| FlowerBlue | `0x5C7CC8` |

## 2. Atlas painters (`textureAtlas.ts`)

Add a helper:

```ts
function drawSpriteTile(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  draw: (ctx: CanvasRenderingContext2D, x0: number, y0: number) => void,
): void {
  const x0 = tileX(col);
  const y0 = tileY(row);
  ctx.clearRect(x0, y0, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE); // alpha = 0
  draw(ctx, x0, y0);
}
```

Per-sprite painters (16×16 each, alpha = 0 background, deterministic seeded LCG for variation):

- **Bush** — fill a roughly circular cluster centred at (8, 11) radius 4–5 with colours sampled from `0x355E29`, `0x4A7C3A`, `0x6BA34D`. A few darker pixels for shading.
- **DeadBush** — draw 5–7 thin diagonal "twigs" from the bottom centre upward in colours `0x6F4A1F`, `0x8C6A3A`. Mostly empty space.
- **Fern** — narrow vertical frond: a 1-px stem from (8, 15) to (8, 2), plus alternating side fronds (1–2 px wide, length 1–3) in `0x356C2E` / `0x4A8C3A`.
- **TallGrass** — short tuft, rows 9–15 only: scattered vertical 1×3 strands in `0x4FA035` / `0x69B040`. Bottom row densest, top sparse.
- **FlowerRed** — 1-px stem rows 8–15 col 8 in `0x355E29`; petal blob at rows 4–7 cols 6–10: outer petals `0xC04040`, centre `0x822323`.
- **FlowerYellow** — same shape; petals `0xE8C440`, centre `0x9E7A1A`.
- **FlowerBlue** — same shape; petals `0x5C7CC8`, centre `0x2F3F7A`.

`buildAtlasTexture` calls them after the existing painters and **excludes** the seven sprite tiles from the `extrudeTile` loop (extruding transparent borders bleeds the canvas-clear back into the content area).

## 3. Mesher (`mesher.ts`)

After the existing `if (!def || def.transparent) continue;` line, branch:

```ts
if (def.renderShape === "cross") {
  emitCrossSprite(pos, def, lightData, /* mesh accumulators */);
  continue; // skip the 6-face cube path for this voxel
}
```

The cube path then runs unchanged for non-cross blocks.

`emitCrossSprite` produces two crossed quads centred on the cell. Each quad is a 1×1 vertical rectangle whose footprint is a diagonal of the cell's xz square:

- **Quad A** (NW↔SE diagonal). Four corners:
  - `(x+0, y+0, z+0)` bottom-NW
  - `(x+1, y+0, z+1)` bottom-SE
  - `(x+1, y+1, z+1)` top-SE
  - `(x+0, y+1, z+0)` top-NW
- **Quad B** (NE↔SW diagonal). Four corners:
  - `(x+1, y+0, z+0)` bottom-NE
  - `(x+0, y+0, z+1)` bottom-SW
  - `(x+0, y+1, z+1)` top-SW
  - `(x+1, y+1, z+0)` top-NE

UV uses the block's `tiles.side` slot, mapped so:

```
u0 → "first" bottom corner   u1 → "second" bottom corner
v1 (bottom of tile)          v0 (top of tile)
```

i.e. each quad gets `[(u0,v1), (u1,v1), (u1,v0), (u0,v0)]` in corner order above.

Per-quad normal: any horizontal vector perpendicular to the diagonal works for Lambert lighting (e.g. `(1,0,-1)/√2` for quad A, `(1,0,1)/√2` for quad B). Visibility from both sides is provided by the material's `side: DoubleSide` (see §4) — we emit each quad's 4 vertices once with a single index winding.

Per-vertex colour: `vec3(1,1,1)` scaled by the cell's light level (look up `lightData[chunkIndex(x,y,z)]` directly — the cell itself is the air-side). No AO. No directional shading.

Out-of-bounds neighbour handling and the existing AO maths do not apply to cross sprites.

## 4. Material (`world.ts`)

```ts
this.material = new THREE.MeshLambertMaterial({
  vertexColors: true,
  map: this.atlasTexture,
  alphaTest: 0.5,
  side: THREE.DoubleSide, // for cross sprites; cube faces still cull via index winding
});
```

`alphaTest: 0.5` discards fragments with α < 0.5. Cube tiles are α = 1.0 throughout so they remain unchanged. `side: DoubleSide` is needed because the second-winding trick alone won't fix Lambert lighting on the back face — Three.js needs `DoubleSide` to compute the back-face normal correctly. Cube faces are not affected because the cube mesher already culls hidden faces, and back faces of visible cube faces are not generated (so DoubleSide costs nothing for them).

## 5. Generation pass (`chunk.ts`, `biomes.ts`)

### Biome definition extension

Add to `BiomeDef`:

```ts
/** Density of decorative surface plants (0..1, multiplied by global slider). */
decorationDensity: number;
/** Weighted decoration choices. Empty array = no decorations. */
decorations: ReadonlyArray<{ block: number; weight: number }>;
```

Defaults per biome:

| Biome | `decorationDensity` | Decorations (weights) |
|---|---|---|
| Ocean | 0 | `[]` |
| Beach | 0 | `[]` |
| Desert | 0.04 | DeadBush 1.0 |
| Savanna | 0.18 | Bush 0.4, TallGrass 0.5, FlowerYellow 0.1 |
| Plains | 0.22 | TallGrass 0.5, FlowerRed 0.15, FlowerYellow 0.20, FlowerBlue 0.15 |
| Forest | 0.20 | TallGrass 0.4, Fern 0.2, Bush 0.3, FlowerRed 0.1 |
| BirchForest | 0.20 | TallGrass 0.4, Fern 0.3, FlowerYellow 0.15, FlowerBlue 0.15 |
| Taiga | 0.22 | Fern 0.6, TallGrass 0.3, Bush 0.1 |
| Tundra | 0.04 | TallGrass 0.7, FlowerBlue 0.3 |
| Mountains | 0.10 | TallGrass 0.6, FlowerYellow 0.4 |

The "Medium" feel from brainstorming corresponds to `globalDensity = 1.0`; `0.0` disables, `2.0–3.0` produces lush meadows.

### Placement pass

Runs **after** the existing tree/cactus stage 2 in `chunk.ts`. Independent noise seed `seed + 16`. Pseudocode:

```
if (!params.vegetation.enabled) skip pass entirely

decoNoise = createNoise(seed + 16)

for lz in [1..CHUNK_SIZE-2]:
  for lx in [1..CHUNK_SIZE-2]:
    colIdx = lz * CHUNK_SIZE + lx
    biome = biomes[colIdx]
    biomeDef = BIOME_DEFS[biome]
    if biomeDef.decorations.length === 0: continue
    if heights[colIdx] <= waterLevel: continue
    if treeMask[colIdx]: continue

    surfaceLocal = floor(heights[colIdx]) - worldYOff
    if surfaceLocal < 0 or surfaceLocal >= CHUNK_SIZE - 1: continue
    surfBlock = data[chunkIndex(lx, surfaceLocal, lz)]
    if surfBlock !== biomeDef.surfaceBlock: continue
    aboveIdx = chunkIndex(lx, surfaceLocal + 1, lz)
    if data[aboveIdx] !== Block.Air: continue

    decoVal = (decoNoise.perlin2D(wx / 1.7, wz / 1.7) + 1) * 0.5
    threshold = biomeDef.decorationDensity * params.vegetation.globalDensity
    if decoVal >= threshold: continue

    block = pickWeighted(biomeDef.decorations, hash(wx, wz))
    data[aboveIdx] = block
```

`pickWeighted` is a deterministic helper that walks the cumulative weight using a 32-bit integer hash of `(wx, wz)` so the same world coords always yield the same plant.

### Tree-density coupling

Multiply biome `treeDensity` by `params.vegetation.treeDensity` in stage 1 of the existing tree pass. (Single-line change.)

## 6. Params + UI

### `generationParams.ts`

```ts
export interface VegetationParams {
  enabled: boolean;
  globalDensity: number; // 0..3, default 1
  treeDensity: number;   // 0..3, default 1
}

export interface GenerationParams {
  // ...existing...
  vegetation: VegetationParams;
}

export const DEFAULT_PARAMS: GenerationParams = {
  // ...existing...
  vegetation: { enabled: true, globalDensity: 1.0, treeDensity: 1.0 },
};
```

### `debugPanel.ts`

Add to `SECTIONS`:

```ts
{
  id: "vegetation", label: "Vegetation", paramsKey: "vegetation", expanded: false,
  toggle: { key: "enabled", label: "Enabled" },
  sliders: [
    { key: "globalDensity", label: "Decoration Density", min: 0, max: 3, step: 0.05, decimals: 2 },
    { key: "treeDensity",   label: "Tree Density Mult.", min: 0, max: 3, step: 0.05, decimals: 2 },
  ],
},
```

Also add `vegetation: { ...DEFAULT_PARAMS.vegetation, ...(raw.vegetation ?? {}) }` to the preset-load merge (around line 615) so existing saved presets without the field still load.

## Determinism and chunk boundaries

Decoration placement uses a 2D noise field plus a 2D coordinate hash — both purely functions of world `(wx, wz)`. There is no cross-chunk leakage because:

- Each decoration occupies exactly one cell, placed directly above the surface in the same chunk that owns the surface block.
- Surface heights at chunk boundaries are already deterministic (heights are recomputed identically in any chunk that needs them — see existing erosion margin pass).
- The tree-mask conflict test reads only this chunk's mask; trees that span chunk boundaries already use the cross-chunk leaf-painting trick and never overlap a decoration cell because the tree footprint reserves the column.

No regeneration of neighbour chunks is needed.

## Edge cases

- **Surface in the chunk above** — column owned by current chunk's surface but `surfaceLocal >= CHUNK_SIZE - 1` is skipped (decoration wouldn't fit). The chunk above won't generate a decoration there either because its biome surface block isn't present. Result: no decoration. Acceptable rarity.
- **Snow-capped mountain peaks** — biome surface for Mountains is `Stone`, but the chunk's snow-cap pass overwrites it to `Snow` for high peaks. The placement pass tests against `biomeDef.surfaceBlock` (`Stone`), so snowy peaks naturally get no decorations.
- **Aquifer-flooded surfaces** — the existing "surface block under water → sub-surface" pass converts grass to dirt before the decoration pass runs. Decoration pass checks `surfBlock === biomeDef.surfaceBlock` so flooded grass is correctly skipped.
- **Cactus columns** — desert biome's existing cactus check uses the same surface position; the cell above is occupied, so the `data[aboveIdx] !== Block.Air` check skips them.

## Testing plan

Manual / visual only (the project has no automated test suite).

1. **Build & run** — `cd 07-advanced-terrain && npm run dev`.
2. **Visual scan** — fly over Plains, Forest, Desert, Taiga, Tundra. Verify:
   - Plants stand upright on top of the surface block.
   - Sprites have crisp alpha edges (no white halo, no black smudge).
   - Plants visible from both sides; lit by sky and emissive blocks.
   - Player walks through plants without collision.
3. **Density slider** — drag `Decoration Density` from 0 → 3, regenerate; confirm thinning to nothing then over-saturation.
4. **Tree density slider** — same; confirm trees thin/multiply independently.
5. **Disable toggle** — turn off vegetation, regenerate; confirm zero plants but trees/cacti unchanged.
6. **Preset load** — load an existing preset (saved without vegetation field); confirm no crash and defaults applied.
7. **Chunk seams** — fly along a biome boundary; confirm no decoration "lines" or gaps along chunk edges.
8. **Cross-section shadows** — stand near plants under different lighting (cave, twilight); confirm shading roughly matches surroundings.

## Risks

- **Alpha sorting** — `alphaTest` discard avoids the depth-sort problem; we deliberately do **not** set `transparent: true` on the material, so plants get standard depth-write/depth-test and sort correctly against everything else.
- **Mipmap bleed on sprites** — sprites are excluded from `extrudeTile`, but the GPU will still mipmap the alpha channel. At distance, the silhouette may shrink. Mitigation: sprites are short and small in the viewport at distance; if visible artifacts appear, future work is to disable mipmapping per-tile (not feasible with a single CanvasTexture) or move sprites to a separate non-mipped texture (deferred).
- **`DoubleSide` cost** — adds back-face shading for every cube quad too. Cube quads are already culled by visibility check, so the only back faces drawn are those facing away from the camera and not occluded — typically a small fraction. Monitor frame rate; if regression appears, switch sprites to a separate mesh + material.
