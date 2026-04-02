/**
 * 3D block definitions.
 *
 * Colors are specified as hex integers (0xRRGGBB) for direct use
 * with Three.js materials.
 */

export const Block = {
  Air:       0,
  Grass:     1,
  Dirt:      2,
  Stone:     3,
  DeepStone: 4,
  Sand:      5,
  Water:     6,
  Snow:      7,
  Coal:      8,
  Iron:      9,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export interface BlockDef {
  name: string;
  color: number;     // 0xRRGGBB
  solid: boolean;
  transparent: boolean;
}

export const BLOCK_DEFS: Record<number, BlockDef> = {
  [Block.Air]:       { name: "Air",        color: 0x7EC8E3, solid: false, transparent: true },
  [Block.Grass]:     { name: "Grass",      color: 0x4CAF50, solid: true,  transparent: false },
  [Block.Dirt]:      { name: "Dirt",       color: 0x8B5E3C, solid: true,  transparent: false },
  [Block.Stone]:     { name: "Stone",      color: 0x808080, solid: true,  transparent: false },
  [Block.DeepStone]: { name: "Deep Stone", color: 0x505050, solid: true,  transparent: false },
  [Block.Sand]:      { name: "Sand",       color: 0xEDC9AF, solid: true,  transparent: false },
  [Block.Water]:     { name: "Water",      color: 0x2196F3, solid: true,  transparent: false },
  [Block.Snow]:      { name: "Snow",       color: 0xF0F0F0, solid: true,  transparent: false },
  [Block.Coal]:      { name: "Coal",       color: 0x333333, solid: true,  transparent: false },
  [Block.Iron]:      { name: "Iron",       color: 0xC19A6B, solid: true,  transparent: false },
};
