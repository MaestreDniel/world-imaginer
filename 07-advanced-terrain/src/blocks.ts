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
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export interface BlockDef {
  name: string;
  color: number;
  solid: boolean;
  transparent: boolean;
  lightEmit: number;  // 0 = non-emissive; 1–15 = emits that light level
}

export const BLOCK_DEFS: Record<number, BlockDef> = {
  [Block.Air]:          { name: "Air",           color: 0x7EC8E3, solid: false, transparent: true,  lightEmit: 0 },
  [Block.Grass]:        { name: "Grass",         color: 0x4CAF50, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Dirt]:         { name: "Dirt",          color: 0x8B5E3C, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Stone]:        { name: "Stone",         color: 0x808080, solid: true,  transparent: false, lightEmit: 0 },
  [Block.DeepStone]:    { name: "Deep Stone",    color: 0x505050, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Sand]:         { name: "Sand",          color: 0xEDC9AF, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Water]:        { name: "Water",         color: 0x2196F3, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Snow]:         { name: "Snow",          color: 0xF0F0F0, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Coal]:         { name: "Coal",          color: 0x333333, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Iron]:         { name: "Iron",          color: 0xC19A6B, solid: true,  transparent: false, lightEmit: 0 },
  [Block.OakWood]:      { name: "Oak Wood",      color: 0x6D4C2A, solid: true,  transparent: false, lightEmit: 0 },
  [Block.OakLeaves]:    { name: "Oak Leaves",    color: 0x2E7D32, solid: true,  transparent: false, lightEmit: 0 },
  [Block.BirchWood]:    { name: "Birch Wood",    color: 0xD4C9A8, solid: true,  transparent: false, lightEmit: 0 },
  [Block.BirchLeaves]:  { name: "Birch Leaves",  color: 0x6DBF4B, solid: true,  transparent: false, lightEmit: 0 },
  [Block.SpruceWood]:   { name: "Spruce Wood",   color: 0x3E2723, solid: true,  transparent: false, lightEmit: 0 },
  [Block.SpruceLeaves]: { name: "Spruce Leaves", color: 0x1B5E20, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Cactus]:       { name: "Cactus",        color: 0x388E3C, solid: true,  transparent: false, lightEmit: 0 },
  [Block.RedSand]:      { name: "Red Sand",      color: 0xC97044, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Ice]:          { name: "Ice",           color: 0xB3E5FC, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Gravel]:       { name: "Gravel",        color: 0x9E9E9E, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Sandstone]:    { name: "Sandstone",     color: 0xD4B483, solid: true,  transparent: false, lightEmit: 0 },
  [Block.SnowBrick]:    { name: "Snow Brick",    color: 0xDCE8EC, solid: true,  transparent: false, lightEmit: 0 },
  [Block.OakPlanks]:    { name: "Oak Planks",    color: 0xBC8F5E, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Cobblestone]:  { name: "Cobblestone",   color: 0x6B6B6B, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Glass]:        { name: "Glass",         color: 0xCCE8F0, solid: true,  transparent: false, lightEmit: 0 },
  [Block.Lava]:         { name: "Lava",          color: 0xFF6600, solid: true,  transparent: false, lightEmit: 15 },
  [Block.Glowstone]:    { name: "Glowstone",     color: 0xFFDD44, solid: true,  transparent: false, lightEmit: 15 },
};
