/**
 * Block definitions for the tilemap world.
 *
 * Each block has a unique ID, display name, color, and physical properties.
 * The `solid` flag controls whether the block is walkable/collidable and
 * whether water can flow through it.
 */

export interface BlockDef {
  id: number;
  name: string;
  color: string;
  solid: boolean;
}

export const Block = {
  Air:       0,
  Grass:     1,
  Dirt:      2,
  Stone:     3,
  DeepStone: 4,
  Sand:      5,
  Water:     6,
  Snow:      7,
  Wood:      8,
  Leaves:    9,
  Coal:     10,
  Iron:     11,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export const BLOCK_DEFS: Record<number, BlockDef> = {
  [Block.Air]:       { id: 0,  name: "Air",        color: "#7EC8E3", solid: false },
  [Block.Grass]:     { id: 1,  name: "Grass",      color: "#4CAF50", solid: true },
  [Block.Dirt]:      { id: 2,  name: "Dirt",        color: "#8B5E3C", solid: true },
  [Block.Stone]:     { id: 3,  name: "Stone",       color: "#808080", solid: true },
  [Block.DeepStone]: { id: 4,  name: "Deep Stone",  color: "#505050", solid: true },
  [Block.Sand]:      { id: 5,  name: "Sand",        color: "#EDC9AF", solid: true },
  [Block.Water]:     { id: 6,  name: "Water",       color: "#2196F3", solid: false },
  [Block.Snow]:      { id: 7,  name: "Snow",        color: "#F0F0F0", solid: true },
  [Block.Wood]:      { id: 8,  name: "Wood",        color: "#6D4C2A", solid: true },
  [Block.Leaves]:    { id: 9,  name: "Leaves",      color: "#2E7D32", solid: true },
  [Block.Coal]:      { id: 10, name: "Coal",        color: "#333333", solid: true },
  [Block.Iron]:      { id: 11, name: "Iron",        color: "#C19A6B", solid: true },
};
