import { createNoise } from "./perlin";

/**
 * Block types for the 2D terrain.
 *
 * The world is a grid of tiles, each with one of these types. The terrain
 * generator decides the type based on position relative to the surface,
 * noise thresholds for caves, and depth for material layers.
 */
export const enum Block {
  Sky = 0,
  Dirt = 1,
  Grass = 2,
  Stone = 3,
  Cave = 4,
  Water = 5,
  Sand = 6,
  Snow = 7,
  DeepStone = 8,
}

/** Color palette for each block type. */
export const BLOCK_COLORS: Record<number, string> = {
  [Block.Sky]:       "#7EC8E3",
  [Block.Dirt]:      "#8B5E3C",
  [Block.Grass]:     "#4CAF50",
  [Block.Stone]:     "#808080",
  [Block.Cave]:      "#1a1a2e",
  [Block.Water]:     "#2196F3",
  [Block.Sand]:      "#EDC9AF",
  [Block.Snow]:      "#F0F0F0",
  [Block.DeepStone]: "#505050",
};

export interface TerrainConfig {
  width: number;
  height: number;
  seed: number;
  /** Scale of the surface noise — larger = gentler hills */
  surfaceScale: number;
  /** How many tiles the surface varies above/below the midpoint */
  surfaceAmplitude: number;
  /** Scale of the cave noise */
  caveScale: number;
  /** Threshold for cave carving (0-1). Higher = more caves */
  caveThreshold: number;
  /** Water level as a fraction of world height (0 = top, 1 = bottom) */
  waterLevel: number;
}

export const DEFAULT_CONFIG: TerrainConfig = {
  width: 256,
  height: 128,
  seed: 42,
  surfaceScale: 80,
  surfaceAmplitude: 20,
  caveScale: 25,
  caveThreshold: 0.35,
  waterLevel: 0.45,
};

/**
 * Generate a 2D terrain grid.
 *
 * The generation pipeline:
 *
 * 1. **Surface profile**: Use 1D fBm (sample noise along x only) to create
 *    a height curve. This defines where the ground starts for each column.
 *    Terraria uses a similar approach — the surface is a noise-driven curve.
 *
 * 2. **Material layers**: Below the surface, assign block types based on
 *    depth. Shallow = dirt, deeper = stone, deepest = deep stone. The
 *    transition depths are also slightly perturbed by noise so layers
 *    aren't perfectly flat.
 *
 * 3. **Caves**: Sample 2D noise at each underground tile. If the noise
 *    value exceeds a threshold, carve out a cave. This creates organic,
 *    connected tunnel networks — the same technique Terraria uses.
 *
 * 4. **Surface details**: The topmost solid block in each column becomes
 *    grass. Columns near water level get sand instead. Areas above a
 *    snow line get snow.
 *
 * 5. **Water**: Any sky/cave block below the water level gets filled
 *    with water, creating lakes and flooded caves.
 */
export function generateTerrain(config: TerrainConfig): Uint8Array[] {
  const { width, height, seed, surfaceScale, surfaceAmplitude, caveScale, caveThreshold, waterLevel } = config;

  const noise = createNoise(seed);
  const caveNoise = createNoise(seed + 1);

  const grid: Uint8Array[] = Array.from({ length: height }, () => new Uint8Array(width));

  // Water line in tile coordinates
  const waterY = Math.floor(height * waterLevel);

  // Step 1: Generate surface heights
  const surfaceHeights = new Float64Array(width);
  const midY = height * 0.35; // Surface sits in upper third

  for (let x = 0; x < width; x++) {
    const n = noise.fbm(x / surfaceScale, 0, 5, 0.5, 2.0);
    surfaceHeights[x] = midY + n * surfaceAmplitude;
  }

  // Step 2 & 3: Fill grid
  for (let x = 0; x < width; x++) {
    const surfaceY = Math.floor(surfaceHeights[x]);

    for (let y = 0; y < height; y++) {
      if (y < surfaceY) {
        // Above ground
        grid[y][x] = Block.Sky;
        continue;
      }

      const depth = y - surfaceY;

      // Layer noise adds variation to layer boundaries
      const layerNoise = noise.fbm(x / 40, y / 40, 3, 0.5, 2.0) * 5;

      // Determine material by depth
      let block: Block;
      if (depth < 5 + layerNoise) {
        block = Block.Dirt;
      } else if (depth < 30 + layerNoise) {
        block = Block.Stone;
      } else {
        block = Block.DeepStone;
      }

      // Cave carving: sample 2D noise, carve if above threshold
      // Protect only the surface block itself (depth 0)
      if (depth > 1) {
        const caveVal = caveNoise.fbm(x / caveScale, y / caveScale, 4, 0.5, 2.0);
        if (caveVal > caveThreshold) {
          block = Block.Cave;
        }
      }

      grid[y][x] = block;
    }
  }

  // Step 3b: Carve entrance shafts that connect the surface to nearby caves.
  // Uses a separate noise channel to pick columns, then digs down from the
  // surface until hitting an existing cave or reaching a max depth.
  const entranceNoise = createNoise(seed + 2);
  const shaftMaxDepth = 4;
  for (let x = 0; x < width; x++) {
    const n = entranceNoise.perlin2D(x / 10, 0);
    // ~15% of columns get a shaft attempt
    if (n < 0.35) continue;

    const surfaceY = Math.floor(surfaceHeights[x]);
    // Dig downward from just below the surface
    for (let dy = 2; dy <= shaftMaxDepth; dy++) {
      const y = surfaceY + dy;
      if (y >= height) break;
      if (grid[y][x] === Block.Cave) break; // Connected — stop digging
      grid[y][x] = Block.Cave;
    }
  }

  // Step 4: Surface decoration pass
  for (let x = 0; x < width; x++) {
    // Find topmost solid block
    let topSolid = -1;
    for (let y = 0; y < height; y++) {
      if (grid[y][x] !== Block.Sky && grid[y][x] !== Block.Water) {
        topSolid = y;
        break;
      }
    }

    if (topSolid < 0) continue;

    const surfaceY = topSolid;

    // Snow on high peaks (above 25% of world height)
    if (surfaceY < height * 0.2) {
      grid[surfaceY][x] = Block.Snow;
    }
    // Sand near water level
    else if (Math.abs(surfaceY - waterY) < 3) {
      grid[surfaceY][x] = Block.Sand;
      if (surfaceY + 1 < height && grid[surfaceY + 1][x] === Block.Dirt) {
        grid[surfaceY + 1][x] = Block.Sand;
      }
    }
    // Normal grass
    else {
      grid[surfaceY][x] = Block.Grass;
    }
  }

  // Step 5: Fill water via flood-fill from the surface.
  // Only air (Sky) and cave blocks reachable from the open sky get water.
  // BFS seeds: every Sky tile in the top row, plus every Sky tile that sits
  // at or below the water level (surface lakes).
  const visited = Array.from({ length: height }, () => new Uint8Array(width));
  const queue: [number, number][] = [];

  // Seed: all sky tiles in the top row
  for (let x = 0; x < width; x++) {
    if (grid[0][x] === Block.Sky) {
      queue.push([x, 0]);
      visited[0][x] = 1;
    }
  }

  // BFS through connected Sky/Cave tiles — water can only flow down & sideways
  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;

    // Fill with water if at or below water level
    const block = grid[cy][cx];
    if (cy >= waterY && (block === Block.Sky || block === Block.Cave)) {
      grid[cy][cx] = Block.Water;
    }

    // Expand to 4-connected neighbors
    const neighbors: [number, number][] = [
      [cx - 1, cy], [cx + 1, cy],
      [cx, cy - 1], [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited[ny][nx]) continue;
      const nb = grid[ny][nx];
      if (nb === Block.Sky || nb === Block.Cave) {
        visited[ny][nx] = 1;
        queue.push([nx, ny]);
      }
    }
  }

  return grid;
}
