/**
 * Block definitions — expanded for biome variety.
 *
 * New blocks: Cactus, Red Sand, Ice, Packed Ice,
 * Oak/Birch/Spruce wood and leaves for biome-specific trees.
 */

export const Block = {
  Air:          0,
  Grass:        1,
  Dirt:         2,
  Stone:        3,
  DeepStone:    4,
  Sand:         5,
  Water:        6,
  Snow:         7,
  Coal:         8,
  Iron:         9,
  OakWood:     10,
  OakLeaves:   11,
  BirchWood:   12,
  BirchLeaves: 13,
  SpruceWood:  14,
  SpruceLeaves:15,
  Cactus:      16,
  RedSand:     17,
  Ice:         18,
  Gravel:      19,
  Sandstone:   20,
  SnowBrick:   21,
  OakPlanks:   22,
  Cobblestone: 23,
  Glass:       24,
  Lava:        25,
  Glowstone:   26,
  Bedrock:     27,
  Bush:         28,
  DeadBush:     29,
  Fern:         30,
  TallGrass:    31,
  FlowerRed:    32,
  FlowerYellow: 33,
  FlowerBlue:   34,
  Moss:         35,
} as const;

// ── Atlas layout ──────────────────────────────────────────────────────────────
export const ATLAS_COLS      = 8;
export const ATLAS_ROWS      = 8;
export const ATLAS_TILE_SIZE   = 16; // px of drawable content per tile
// Keep each atlas slot power-of-two sized so GPU-generated mip levels remain
// aligned to tile boundaries instead of bleeding neighbouring slots together.
export const ATLAS_TILE_PAD    = 8;  // 8-px extruded border around each tile slot
export const ATLAS_TILE_PADDED = 32; // 16 content + 8 pad on each side

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
  Bush:         31,
  DeadBush:     32,
  Fern:         33,
  TallGrass:    34,
  FlowerRed:    35,
  FlowerYellow: 36,
  FlowerBlue:   37,
  Moss:         38,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

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
  [Block.Bedrock]: {
    name: "Bedrock", color: 0x2A2A2A, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Cobblestone, side: TILE_IDS.Cobblestone, bottom: TILE_IDS.Cobblestone },
  },
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
  [Block.Moss]: {
    name: "Moss", color: 0x4F8B3C, solid: true, transparent: false, lightEmit: 0,
    tiles: { top: TILE_IDS.Moss, side: TILE_IDS.Moss, bottom: TILE_IDS.Moss },
  },
};
