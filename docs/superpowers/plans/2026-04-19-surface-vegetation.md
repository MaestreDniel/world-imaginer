# Surface Vegetation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add biome-aware non-solid surface decorations (bushes, dead bushes, ferns, tall grass, three flower colours) rendered as cross-quad sprites, with a debug-panel density slider.

**Architecture:** Seven new blocks share a new `renderShape: "cross"` mode; the mesher branches on shape and emits two crossed double-sided quads per sprite cell. Placement runs as a new pass in `chunk.ts` after the existing tree pass, driven by per-biome decoration tables and a global density multiplier exposed in the debug panel.

**Tech Stack:** TypeScript, Three.js, Vite. Project: `07-advanced-terrain`. No test framework — verification is `npm run build` (type-check) and `npm run dev` (visual).

**Spec:** [`docs/superpowers/specs/2026-04-19-surface-vegetation-design.md`](../specs/2026-04-19-surface-vegetation-design.md)

---

## File map

- **Modify** `07-advanced-terrain/src/blocks.ts` — new block IDs, tile IDs, `RenderShape` type, `BlockDef.renderShape`, 7 new `BLOCK_DEFS` entries.
- **Modify** `07-advanced-terrain/src/textureAtlas.ts` — `drawSpriteTile` helper, 7 sprite painters, exclude sprites from `extrudeTile` loop.
- **Modify** `07-advanced-terrain/src/mesher.ts` — branch on `renderShape`, new `emitCrossSprite` helper.
- **Modify** `07-advanced-terrain/src/world.ts` — add `alphaTest` and `side: DoubleSide` to shared material.
- **Modify** `07-advanced-terrain/src/generationParams.ts` — `VegetationParams` interface, default values.
- **Modify** `07-advanced-terrain/src/biomes.ts` — `BiomeDef.decorations`, `BiomeDef.decorationDensity` and per-biome defaults.
- **Modify** `07-advanced-terrain/src/chunk.ts` — wire `treeDensity` multiplier; add decoration placement pass after tree pass.
- **Modify** `07-advanced-terrain/src/debugPanel.ts` — `Vegetation` section, preset-load merge for `vegetation` field.

All work happens in `07-advanced-terrain/`. Run commands from inside that directory.

---

## Task 1 — Block defs and tile IDs

Adds the 7 new block IDs, tile IDs, the `RenderShape` type, and the `renderShape` field on `BlockDef`. Adds `BLOCK_DEFS` entries for the 7 decoration blocks. After this task the build still passes; nothing yet renders.

**Files:**
- Modify: `07-advanced-terrain/src/blocks.ts`

- [ ] **Step 1: Add block IDs**

In `07-advanced-terrain/src/blocks.ts`, replace the closing of the `Block` const object — insert these lines just before the final `} as const;`:

```ts
  Bush:         28,
  DeadBush:     29,
  Fern:         30,
  TallGrass:    31,
  FlowerRed:    32,
  FlowerYellow: 33,
  FlowerBlue:   34,
```

- [ ] **Step 2: Add tile IDs**

In the same file, insert these lines just before the final `} as const;` of the `TILE_IDS` object:

```ts
  Bush:         31,
  DeadBush:     32,
  Fern:         33,
  TallGrass:    34,
  FlowerRed:    35,
  FlowerYellow: 36,
  FlowerBlue:   37,
```

- [ ] **Step 3: Add `RenderShape` type and extend `BlockDef`**

Replace the `BlockDef` interface block:

```ts
export type RenderShape = "cube" | "cross";

export interface BlockDef {
  name: string;
  color: number;
  solid: boolean;
  transparent: boolean;
  lightEmit: number;  // 0 = non-emissive; 1–15 = emits that light level
  tiles: { top: number; side: number; bottom: number };
  /** Geometry mode. "cube" emits 6 cube faces (default); "cross" emits two crossed quads. */
  renderShape?: RenderShape;
}
```

- [ ] **Step 4: Add `BLOCK_DEFS` entries for the 7 decorations**

Insert these 7 entries inside `BLOCK_DEFS`, just before the closing `};`:

```ts
  [Block.Bush]: {
    name: "Bush", color: 0x4A7C3A, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.Bush, side: TILE_IDS.Bush, bottom: TILE_IDS.Bush },
  },
  [Block.DeadBush]: {
    name: "Dead Bush", color: 0x8C6A3A, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.DeadBush, side: TILE_IDS.DeadBush, bottom: TILE_IDS.DeadBush },
  },
  [Block.Fern]: {
    name: "Fern", color: 0x356C2E, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.Fern, side: TILE_IDS.Fern, bottom: TILE_IDS.Fern },
  },
  [Block.TallGrass]: {
    name: "Tall Grass", color: 0x69B040, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.TallGrass, side: TILE_IDS.TallGrass, bottom: TILE_IDS.TallGrass },
  },
  [Block.FlowerRed]: {
    name: "Red Flower", color: 0xC04040, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.FlowerRed, side: TILE_IDS.FlowerRed, bottom: TILE_IDS.FlowerRed },
  },
  [Block.FlowerYellow]: {
    name: "Yellow Flower", color: 0xE8C440, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.FlowerYellow, side: TILE_IDS.FlowerYellow, bottom: TILE_IDS.FlowerYellow },
  },
  [Block.FlowerBlue]: {
    name: "Blue Flower", color: 0x5C7CC8, solid: false, transparent: true, lightEmit: 0,
    renderShape: "cross",
    tiles: { top: TILE_IDS.FlowerBlue, side: TILE_IDS.FlowerBlue, bottom: TILE_IDS.FlowerBlue },
  },
```

- [ ] **Step 5: Type-check**

Run from `07-advanced-terrain/`:

```bash
npm run build
```

Expected: build succeeds (TypeScript emits no errors). Vite-bundled `dist/` is created.

- [ ] **Step 6: Commit**

```bash
git add 07-advanced-terrain/src/blocks.ts
git commit -m "feat(07): add decoration blocks and renderShape field"
```

---

## Task 2 — Atlas sprite painters

Adds the `drawSpriteTile` helper and 7 procedural sprite painters. Excludes sprite tiles from `extrudeTile` (extrusion bleeds the canvas-clear into the content area for alpha-cut sprites).

**Files:**
- Modify: `07-advanced-terrain/src/textureAtlas.ts`

- [ ] **Step 1: Add `drawSpriteTile` helper**

Insert this helper after `drawWoodBark` and before the `// ── Public API` comment in `textureAtlas.ts`:

```ts
/**
 * Clear a tile slot to transparent (alpha = 0) and run a painter that
 * draws opaque pixels for an alpha-cut sprite. Used by all cross-shape
 * vegetation sprites — never for cube tiles, whose pixels must remain α=255.
 */
function drawSpriteTile(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  draw: (ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number) => void,
  rngSeed: number,
): void {
  const x0 = tileX(col);
  const y0 = tileY(row);
  ctx.clearRect(x0, y0, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
  const rng = makeLcg(rngSeed);
  draw(ctx, x0, y0, rng);
}

/** Paint a single opaque pixel at (px, py) within the tile content area. */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}
```

- [ ] **Step 2: Add the 7 sprite painters**

Insert these painter functions immediately after the helpers from Step 1:

```ts
function drawBush(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const cx = 8, cy = 11, r = 4.5;
  const palette = ["#355E29", "#4A7C3A", "#6BA34D"];
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      // Slightly noisy edge: skip ~25% of border pixels
      if (d > r - 0.8 && rng() < 0.25) continue;
      const c = palette[(rng() * palette.length) | 0];
      px(ctx, x0 + cx + dx, y0 + cy + dy, c);
    }
  }
  // A few darker shadow pixels in the lower half
  for (let i = 0; i < 6; i++) {
    px(ctx, x0 + 5 + ((rng() * 7) | 0), y0 + 12 + ((rng() * 3) | 0), "#23401C");
  }
}

function drawDeadBush(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const palette = ["#6F4A1F", "#8C6A3A", "#5A3A18"];
  // 6 thin twigs from the bottom centre
  for (let i = 0; i < 6; i++) {
    const startX = 6 + ((rng() * 5) | 0);
    const startY = 14;
    const endX = 4 + ((rng() * 9) | 0);
    const endY = 4 + ((rng() * 6) | 0);
    const c = palette[(rng() * palette.length) | 0];
    // Draw a 1-px line from start to end
    const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const xx = Math.round(startX + (endX - startX) * t);
      const yy = Math.round(startY + (endY - startY) * t);
      px(ctx, x0 + xx, y0 + yy, c);
    }
  }
}

function drawFern(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const stemX = 8;
  const stem = "#356C2E";
  const frond = "#4A8C3A";
  // Vertical stem from y=2 to y=15
  for (let y = 2; y <= 15; y++) px(ctx, x0 + stemX, y0 + y, stem);
  // Side fronds at alternating heights
  for (let y = 4; y <= 14; y += 2) {
    const len = 1 + ((rng() * 3) | 0);
    const sideRight = (y & 1) === 0;
    for (let i = 1; i <= len; i++) {
      const xx = stemX + (sideRight ? i : -i);
      // Fronds taper diagonally upward away from the stem
      const yy = y - ((i / 2) | 0);
      if (xx >= 0 && xx < 16 && yy >= 0 && yy < 16) {
        px(ctx, x0 + xx, y0 + yy, frond);
      }
    }
    // Mirror on the other side as well
    for (let i = 1; i <= len; i++) {
      const xx = stemX + (sideRight ? -i : i);
      const yy = y - ((i / 2) | 0);
      if (xx >= 0 && xx < 16 && yy >= 0 && yy < 16) {
        px(ctx, x0 + xx, y0 + yy, frond);
      }
    }
  }
}

function drawTallGrass(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const palette = ["#4FA035", "#69B040", "#82C455"];
  // 8–10 vertical strands in the bottom half
  const count = 8 + ((rng() * 3) | 0);
  for (let i = 0; i < count; i++) {
    const sx = 1 + ((rng() * 14) | 0);
    const top = 9 + ((rng() * 3) | 0);
    const c = palette[(rng() * palette.length) | 0];
    for (let y = top; y <= 15; y++) px(ctx, x0 + sx, y0 + y, c);
  }
}

function drawFlower(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number,
  petalColor: string, centerColor: string,
): void {
  // Stem
  const stem = "#355E29";
  for (let y = 8; y <= 15; y++) px(ctx, x0 + 8, y0 + y, stem);
  // Two leaves on the stem
  px(ctx, x0 + 7, y0 + 11, stem);
  px(ctx, x0 + 9, y0 + 13, stem);
  // 3×3 petal blob centred at (8, 5), with a 1-px centre
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      px(ctx, x0 + 8 + dx, y0 + 5 + dy, petalColor);
    }
  }
  // Four extra petal pixels in cardinal positions for a flower look
  px(ctx, x0 + 8, y0 + 3, petalColor);
  px(ctx, x0 + 8, y0 + 7, petalColor);
  px(ctx, x0 + 6, y0 + 5, petalColor);
  px(ctx, x0 + 10, y0 + 5, petalColor);
  // Centre pixel
  px(ctx, x0 + 8, y0 + 5, centerColor);
}
```

- [ ] **Step 3: Call painters from `buildAtlasTexture` and exclude sprites from extrusion**

Locate the block in `buildAtlasTexture` that says:

```ts
  drawWoodEnd(ctx, TILE_IDS.SpruceEnd,   0x3E2723);
  drawWoodBark(ctx, TILE_IDS.SpruceBark, 0x3E2723);

  // Extrude every non-Air tile so mipmap averaging never samples empty canvas.
  const allTileIds = Object.values(TILE_IDS).filter(id => id !== TILE_IDS.Air);
  for (const id of allTileIds) {
    extrudeTile(ctx, tc(id), tr(id));
  }
```

Replace it with:

```ts
  drawWoodEnd(ctx, TILE_IDS.SpruceEnd,   0x3E2723);
  drawWoodBark(ctx, TILE_IDS.SpruceBark, 0x3E2723);

  // ── Cross-sprite vegetation tiles (alpha-cut) ───────────────────────────────
  drawSpriteTile(ctx, tc(TILE_IDS.Bush),         tr(TILE_IDS.Bush),         drawBush,      TILE_IDS.Bush + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.DeadBush),     tr(TILE_IDS.DeadBush),     drawDeadBush,  TILE_IDS.DeadBush + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.Fern),         tr(TILE_IDS.Fern),         drawFern,      TILE_IDS.Fern + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.TallGrass),    tr(TILE_IDS.TallGrass),    drawTallGrass, TILE_IDS.TallGrass + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.FlowerRed),    tr(TILE_IDS.FlowerRed),
    (c, x, y) => drawFlower(c, x, y, "#C04040", "#822323"),
    TILE_IDS.FlowerRed + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.FlowerYellow), tr(TILE_IDS.FlowerYellow),
    (c, x, y) => drawFlower(c, x, y, "#E8C440", "#9E7A1A"),
    TILE_IDS.FlowerYellow + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.FlowerBlue),   tr(TILE_IDS.FlowerBlue),
    (c, x, y) => drawFlower(c, x, y, "#5C7CC8", "#2F3F7A"),
    TILE_IDS.FlowerBlue + 4000);

  // Extrude every non-Air, non-sprite tile so mipmap averaging never samples
  // empty canvas. Sprite tiles are intentionally skipped — extruding their
  // alpha-zero borders would bleed the canvas-clear back into the content.
  const SPRITE_TILE_IDS = new Set<number>([
    TILE_IDS.Bush, TILE_IDS.DeadBush, TILE_IDS.Fern, TILE_IDS.TallGrass,
    TILE_IDS.FlowerRed, TILE_IDS.FlowerYellow, TILE_IDS.FlowerBlue,
  ]);
  const allTileIds = Object.values(TILE_IDS).filter(
    id => id !== TILE_IDS.Air && !SPRITE_TILE_IDS.has(id),
  );
  for (const id of allTileIds) {
    extrudeTile(ctx, tc(id), tr(id));
  }
```

- [ ] **Step 4: Type-check**

Run from `07-advanced-terrain/`:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Visual check**

Run `npm run dev` and open the dev URL. The world will not yet show plants (placement pass not added), but the game should still render normally with no console errors. Atlas tiles exist but are invisible because nothing references them as actual blocks yet.

Stop the dev server (Ctrl-C) once verified.

- [ ] **Step 6: Commit**

```bash
git add 07-advanced-terrain/src/textureAtlas.ts
git commit -m "feat(07): atlas painters for vegetation sprites"
```

---

## Task 3 — Cross-sprite mesher branch

Branches the per-voxel mesher loop on `def.renderShape`. Cross-shape blocks emit two crossed quads instead of running the cube-face path.

**Files:**
- Modify: `07-advanced-terrain/src/mesher.ts`

- [ ] **Step 1: Update `buildChunkMesh` to detect cross blocks early**

Open `07-advanced-terrain/src/mesher.ts`. The current per-axis loop calls `data[chunkIndex(...)]` once for every face; we need to pre-process cross blocks separately so they emit exactly twice (once per crossed quad), not 6 times.

Add a new pass at the top of `buildChunkMesh`, immediately before the existing `for (const [axis, dir] of faces)` loop. Insert:

```ts
  // ── Pass 1: cross-shape sprites (vegetation) ────────────────────────────────
  // Walk the grid once and emit two crossed double-sided quads per sprite cell.
  // The cube path below skips these blocks naturally because they're transparent.
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const block = data[chunkIndex(x, y, z)];
        const def = BLOCK_DEFS[block];
        if (!def || def.renderShape !== "cross") continue;

        const tileIdx = def.tiles.side;
        const tCol = tileIdx % ATLAS_COLS;
        const tRow = (tileIdx / ATLAS_COLS) | 0;
        const atlasW = ATLAS_COLS * ATLAS_TILE_PADDED;
        const atlasH = ATLAS_ROWS * ATLAS_TILE_PADDED;
        const htU = 0.5 / atlasW;
        const htV = 0.5 / atlasH;
        const u0 = (tCol * ATLAS_TILE_PADDED + ATLAS_TILE_PAD) / atlasW + htU;
        const u1 = (tCol * ATLAS_TILE_PADDED + ATLAS_TILE_PAD + ATLAS_TILE_SIZE) / atlasW - htU;
        const v0 = (tRow * ATLAS_TILE_PADDED + ATLAS_TILE_PAD) / atlasH + htV;
        const v1 = (tRow * ATLAS_TILE_PADDED + ATLAS_TILE_PAD + ATLAS_TILE_SIZE) / atlasH - htV;

        // Light from this cell (sprite occupies an air voxel that retained its light value).
        let lightLevel = 15;
        if (lightData) lightLevel = Math.max(lightData[chunkIndex(x, y, z)], def.lightEmit);
        const lightFactor = 0.2 + (lightLevel / 15) * 0.8;
        const r = lightFactor, g = lightFactor, b = lightFactor;

        // Two quads, NW↔SE and NE↔SW. Material uses side: DoubleSide so
        // a single winding renders both faces.
        const quads: Array<{ corners: [number, number, number][]; nx: number; nz: number }> = [
          {
            corners: [
              [x + 0, y + 0, z + 0],
              [x + 1, y + 0, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 0, y + 1, z + 0],
            ],
            nx:  Math.SQRT1_2, nz: -Math.SQRT1_2,
          },
          {
            corners: [
              [x + 1, y + 0, z + 0],
              [x + 0, y + 0, z + 1],
              [x + 0, y + 1, z + 1],
              [x + 1, y + 1, z + 0],
            ],
            nx:  Math.SQRT1_2, nz:  Math.SQRT1_2,
          },
        ];

        for (const q of quads) {
          const vi = positions.length / 3;
          const uvc: [number, number][] = [
            [u0, v1], [u1, v1], [u1, v0], [u0, v0],
          ];
          for (let k = 0; k < 4; k++) {
            positions.push(q.corners[k][0], q.corners[k][1], q.corners[k][2]);
            normals.push(q.nx, 0, q.nz);
            colors.push(r, g, b);
            uvs.push(uvc[k][0], uvc[k][1]);
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        }
      }
    }
  }
```

- [ ] **Step 2: Verify cube path still skips cross blocks**

The cube path begins with:

```ts
const block = data[chunkIndex(pos[0], pos[1], pos[2])];
const def   = BLOCK_DEFS[block];
if (!def || def.transparent) continue;
```

All cross-shape blocks have `transparent: true` (set in Task 1), so this guard already excludes them. No change needed.

- [ ] **Step 3: Type-check**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/mesher.ts
git commit -m "feat(07): mesher emits crossed quads for cross-shape blocks"
```

---

## Task 4 — Material alpha cutout

Updates the shared `MeshLambertMaterial` so transparent sprite pixels are discarded and back faces are lit correctly.

**Files:**
- Modify: `07-advanced-terrain/src/world.ts`

- [ ] **Step 1: Update material constructor**

Open `07-advanced-terrain/src/world.ts`. Find the line:

```ts
this.material = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.atlasTexture });
```

Replace it with:

```ts
this.material = new THREE.MeshLambertMaterial({
  vertexColors: true,
  map: this.atlasTexture,
  alphaTest: 0.5,
  side: THREE.DoubleSide,
});
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Visual check (no plants yet, but verify nothing broke)**

Run `npm run dev` and confirm:
- The world renders normally.
- Grass, dirt, water, leaves, etc. all look unchanged (no missing chunks, no z-fighting, no holes in leaves — leaves use opaque tiles so `alphaTest` is a no-op for them).
- Frame rate is comparable to before (DoubleSide on cube faces costs nothing because only visible faces are emitted).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/world.ts
git commit -m "feat(07): enable alpha cutout and double-sided rendering"
```

---

## Task 5 — Vegetation params

Adds the `VegetationParams` interface and a default value to `GenerationParams`.

**Files:**
- Modify: `07-advanced-terrain/src/generationParams.ts`

- [ ] **Step 1: Add `VegetationParams` interface**

In `07-advanced-terrain/src/generationParams.ts`, insert after the `OreParams` interface (around line 67):

```ts
export interface VegetationParams {
  enabled: boolean;
  /** Multiplies every biome's decorationDensity. 0 = no decorations, 1 = default, 3 = lush. */
  globalDensity: number;
  /** Multiplies every biome's treeDensity. 0 = no trees, 1 = default, 3 = thick forest. */
  treeDensity: number;
}
```

- [ ] **Step 2: Add field to `GenerationParams`**

Replace the `GenerationParams` interface block:

```ts
export interface GenerationParams {
  terrain: TerrainParams;
  erosion: ErosionParams;
  caves: CaveParams;
  aquifers: AquiferParams;
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
  vegetation: VegetationParams;
}
```

- [ ] **Step 3: Add defaults**

In `DEFAULT_PARAMS`, insert this block immediately before the final closing `};`:

```ts
  vegetation: {
    enabled: true,
    globalDensity: 1.0,
    treeDensity: 1.0,
  },
```

- [ ] **Step 4: Type-check**

```bash
npm run build
```

Expected: build succeeds (TypeScript will not yet flag missing reads because the field has a default everywhere it's accessed via `DEFAULT_PARAMS`).

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/generationParams.ts
git commit -m "feat(07): add vegetation generation params"
```

---

## Task 6 — Biome decoration tables

Adds `decorationDensity` and `decorations` to `BiomeDef`, with per-biome defaults.

**Files:**
- Modify: `07-advanced-terrain/src/biomes.ts`

- [ ] **Step 1: Extend `BiomeDef` interface**

Open `07-advanced-terrain/src/biomes.ts`. Find the `BiomeDef` interface block and replace it:

```ts
export interface DecorationChoice {
  block: number;
  weight: number;
}

export interface BiomeDef {
  name: string;
  surfaceBlock: number;
  subSurfaceBlock: number;
  /** Multiplier for terrain height amplitude (0.3 = flat, 2.0 = mountainous) */
  heightScale: number;
  /** Offset added to base height */
  heightOffset: number;
  /** Tree type to place, or null for no trees */
  treeWood: number | null;
  treeLeaves: number | null;
  /** Chance of tree per eligible column (0-1) */
  treeDensity: number;
  /** Special feature: cactus placement */
  cactus: boolean;
  /** Probability cap for surface decorations (0-1, multiplied by global slider). */
  decorationDensity: number;
  /** Weighted decoration choices. Empty = no decorations for this biome. */
  decorations: ReadonlyArray<DecorationChoice>;
}
```

- [ ] **Step 2: Add per-biome defaults**

Replace the entire `BIOME_DEFS` object:

```ts
export const BIOME_DEFS: Record<number, BiomeDef> = {
  [Biome.Ocean]: {
    name: "Ocean",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.Sand,
    heightScale: 0.3,
    heightOffset: -8,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
    decorationDensity: 0, decorations: [],
  },
  [Biome.Beach]: {
    name: "Beach",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.Sand,
    heightScale: 0.2,
    heightOffset: -2,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
    decorationDensity: 0, decorations: [],
  },
  [Biome.Desert]: {
    name: "Desert",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.RedSand,
    heightScale: 0.3,
    heightOffset: 7,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: true,
    decorationDensity: 0.04,
    decorations: [{ block: Block.DeadBush, weight: 1.0 }],
  },
  [Biome.Savanna]: {
    name: "Savanna",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.4,
    heightOffset: 6,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.10, cactus: false,
    decorationDensity: 0.18,
    decorations: [
      { block: Block.Bush,         weight: 0.4 },
      { block: Block.TallGrass,    weight: 0.5 },
      { block: Block.FlowerYellow, weight: 0.1 },
    ],
  },
  [Biome.Plains]: {
    name: "Plains",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.2,
    heightOffset: 5,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.15, cactus: false,
    decorationDensity: 0.22,
    decorations: [
      { block: Block.TallGrass,    weight: 0.50 },
      { block: Block.FlowerRed,    weight: 0.15 },
      { block: Block.FlowerYellow, weight: 0.20 },
      { block: Block.FlowerBlue,   weight: 0.15 },
    ],
  },
  [Biome.Forest]: {
    name: "Forest",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.6,
    heightOffset: 4,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.35, cactus: false,
    decorationDensity: 0.20,
    decorations: [
      { block: Block.TallGrass, weight: 0.4 },
      { block: Block.Fern,      weight: 0.2 },
      { block: Block.Bush,      weight: 0.3 },
      { block: Block.FlowerRed, weight: 0.1 },
    ],
  },
  [Biome.BirchForest]: {
    name: "Birch Forest",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.6,
    heightOffset: 4,
    treeWood: Block.BirchWood, treeLeaves: Block.BirchLeaves, treeDensity: 0.25, cactus: false,
    decorationDensity: 0.20,
    decorations: [
      { block: Block.TallGrass,    weight: 0.40 },
      { block: Block.Fern,         weight: 0.30 },
      { block: Block.FlowerYellow, weight: 0.15 },
      { block: Block.FlowerBlue,   weight: 0.15 },
    ],
  },
  [Biome.Taiga]: {
    name: "Taiga",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.4,
    heightOffset: 3,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.30, cactus: false,
    decorationDensity: 0.22,
    decorations: [
      { block: Block.Fern,      weight: 0.6 },
      { block: Block.TallGrass, weight: 0.3 },
      { block: Block.Bush,      weight: 0.1 },
    ],
  },
  [Biome.Tundra]: {
    name: "Tundra",
    surfaceBlock: Block.Snow,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.2,
    heightOffset: 6,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.03, cactus: false,
    decorationDensity: 0.04,
    decorations: [
      { block: Block.TallGrass,  weight: 0.7 },
      { block: Block.FlowerBlue, weight: 0.3 },
    ],
  },
  [Biome.Mountains]: {
    name: "Mountains",
    surfaceBlock: Block.Stone,
    subSurfaceBlock: Block.Stone,
    heightScale: 2.0,
    heightOffset: 10,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.10, cactus: false,
    decorationDensity: 0.10,
    decorations: [
      { block: Block.TallGrass,    weight: 0.6 },
      { block: Block.FlowerYellow, weight: 0.4 },
    ],
  },
};
```

- [ ] **Step 3: Type-check**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/biomes.ts
git commit -m "feat(07): per-biome decoration tables"
```

---

## Task 7 — Decoration placement pass and tree-density coupling

Hooks `params.vegetation.treeDensity` into the existing tree pass and adds a new decoration placement pass after it.

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

- [ ] **Step 1: Apply tree-density multiplier in stage 1 of the tree pass**

Open `07-advanced-terrain/src/chunk.ts`. Find the line in the tree-mask stage 1 loop:

```ts
      if (normalised >= biomeDef.treeDensity) continue;
```

Replace with:

```ts
      if (normalised >= biomeDef.treeDensity * config.params.vegetation.treeDensity) continue;
```

- [ ] **Step 2: Apply tree-density multiplier in cactus placement**

In the same file, find the cactus block (inside stage 2):

```ts
      // Cactus (desert) — no tree biomes overlap, so no mask needed.
      if (biomeDef.cactus) {
        const treeVal = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
        const normalised = (treeVal + 1) * 0.5;
        if (normalised < 0.04 && surfaceLocal >= 0) {
          placeCactus(data, lx, surfaceLocal, lz);
        }
        continue;
      }
```

Replace with:

```ts
      // Cactus (desert) — no tree biomes overlap, so no mask needed.
      if (biomeDef.cactus) {
        const treeVal = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
        const normalised = (treeVal + 1) * 0.5;
        if (normalised < 0.04 * config.params.vegetation.treeDensity && surfaceLocal >= 0) {
          placeCactus(data, lx, surfaceLocal, lz);
        }
        continue;
      }
```

- [ ] **Step 3: Add decoration placement pass after the tree pass**

Locate the end of the stage-2 tree loop (the closing `}` of the outer `for (let lz = 1; lz < CHUNK_SIZE - 1; lz++)`). Immediately after that closing `}` and before the `// Large structure placement` comment, insert:

```ts
  // ── Surface decorations (vegetation) ─────────────────────────────────────
  // Non-solid cross-sprite blocks: bushes, dead bushes, ferns, tall grass,
  // and flowers. Placement is deterministic per (wx, wz) and respects the
  // tree mask so plants never appear under tree trunks.
  if (config.params.vegetation.enabled) {
    const decoNoise = createNoise(seed + 16);
    const globalDensity = config.params.vegetation.globalDensity;

    for (let lz = 1; lz < CHUNK_SIZE - 1; lz++) {
      for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
        const colIdx = lz * CHUNK_SIZE + lx;
        const biomeDef = BIOME_DEFS[biomes[colIdx]];
        if (biomeDef.decorations.length === 0) continue;
        if (heights[colIdx] <= waterLevel) continue;
        if (treeMask[colIdx]) continue;

        const surfaceLocal = Math.floor(heights[colIdx]) - worldYOff;
        if (surfaceLocal < 0 || surfaceLocal >= CHUNK_SIZE - 1) continue;
        const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
        if (surfBlock !== biomeDef.surfaceBlock) continue;
        const aboveIdx = chunkIndex(lx, surfaceLocal + 1, lz);
        if (data[aboveIdx] !== Block.Air) continue;

        const wx = worldXOff + lx;
        const wz = worldZOff + lz;
        const decoVal = (decoNoise.perlin2D(wx / 1.7, wz / 1.7) + 1) * 0.5;
        const threshold = biomeDef.decorationDensity * globalDensity;
        if (decoVal >= threshold) continue;

        // Deterministic weighted pick by hashing world coords.
        let totalWeight = 0;
        for (const c of biomeDef.decorations) totalWeight += c.weight;
        const hash = ((wx * 374761393) ^ (wz * 668265263)) >>> 0;
        const r = ((hash % 100000) / 100000) * totalWeight;
        let acc = 0;
        let chosen: number = biomeDef.decorations[0].block;
        for (const c of biomeDef.decorations) {
          acc += c.weight;
          if (r < acc) { chosen = c.block; break; }
        }

        data[aboveIdx] = chosen;
      }
    }
  }
```

- [ ] **Step 4: Type-check**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Visual check**

Run `npm run dev`. Fly over different biomes and verify:
- Plains has visible grass tufts and three flower colours.
- Desert has scattered dead bushes (sparse and brown).
- Forest, Birch Forest, Taiga have ferns / bushes / tall grass.
- Tundra has very sparse plants.
- Ocean / Beach are empty.
- No plants under tree trunks or in flooded cells.
- Walking into a plant passes through it (no collision).

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat(07): biome-aware vegetation placement pass"
```

---

## Task 8 — Debug panel section

Adds a `Vegetation` section to the debug panel and ensures preset-load merging supplies defaults for older saved presets.

**Files:**
- Modify: `07-advanced-terrain/src/debugPanel.ts`

- [ ] **Step 1: Add `Vegetation` section to `SECTIONS`**

Open `07-advanced-terrain/src/debugPanel.ts`. Insert this section into the `SECTIONS` array, immediately after the `ores` section (around line 105):

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

- [ ] **Step 2: Add preset-load merge for `vegetation`**

Locate the preset-load merge block (around line 615) that looks like:

```ts
            caves:    { ...DEFAULT_PARAMS.caves,    ...(raw.caves    ?? {}) },
            aquifers: { ...DEFAULT_PARAMS.aquifers, ...(raw.aquifers ?? {}) },
            ...
            ores:     { ...DEFAULT_PARAMS.ores,     ...(raw.ores     ?? {}) },
```

Insert immediately after the `ores:` line:

```ts
            vegetation: { ...DEFAULT_PARAMS.vegetation, ...(raw.vegetation ?? {}) },
```

- [ ] **Step 3: Type-check**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Visual check**

Run `npm run dev`. Open the debug panel:
- Confirm a new `Vegetation` section is present with the `Enabled` toggle and two sliders.
- Toggle `Enabled` off, click apply / regenerate; confirm zero plants appear (trees and cacti unaffected).
- Toggle `Enabled` on, set `Decoration Density` to `3`, regenerate; confirm a lush meadow.
- Set `Tree Density Mult.` to `0`, regenerate; confirm trees are gone but plants and cacti remain.
- Set `Tree Density Mult.` to `3`, regenerate; confirm dense forests.
- Save and reload a preset to confirm vegetation params persist.
- Open an existing built-in preset (e.g. "Cave Heavy") to confirm it still loads with default vegetation.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/debugPanel.ts
git commit -m "feat(07): vegetation section in debug panel"
```

---

## Task 9 — End-to-end verification

Final visual sweep to verify the spec's testing plan against the integrated build.

**Files:** none (verification only).

- [ ] **Step 1: Run dev server**

```bash
cd 07-advanced-terrain
npm run dev
```

- [ ] **Step 2: Walk through the spec testing checklist**

Confirm each of the following from the spec's testing plan:

1. Plants stand upright on top of the surface block.
2. Sprites have crisp alpha edges (no white halo, no black smudge).
3. Plants are visible from both sides; lit by sky and emissive blocks.
4. Player walks through plants without collision.
5. `Decoration Density` slider scales density from 0 → 3 sensibly.
6. `Tree Density Mult.` scales trees independently.
7. `Enabled` toggle removes all decorations without affecting trees/cacti.
8. Loading an old preset doesn't crash; defaults apply to the new vegetation field.
9. Chunk seams: no visible decoration "lines" or gaps along chunk boundaries.
10. Plants in shaded areas (e.g. under tree canopy nearby, in a cave entry) shade roughly with their surroundings.

- [ ] **Step 3: Final build check**

Stop the dev server, then:

```bash
npm run build
```

Expected: build succeeds with no warnings.

- [ ] **Step 4: Final commit (only if any tweak was needed during verification)**

If everything worked on first try, skip. Otherwise:

```bash
git add -A
git commit -m "fix(07): vegetation polish from end-to-end verification"
```
