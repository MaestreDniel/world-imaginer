import { Block } from "./blocks";
import { createNoise } from "./perlin";

/**
 * Chunk-based world generation.
 *
 * The world is divided into vertical columns of tiles called "chunks".
 * Each chunk is CHUNK_W tiles wide and WORLD_H tiles tall. Chunks are
 * generated on demand as the camera moves — this is what makes the
 * world "infinite" horizontally.
 *
 * Key insight: noise functions are deterministic. Given the same seed
 * and world coordinates, we always get the same terrain. So chunks can
 * be generated independently and in any order — no need to generate
 * left-to-right. This is the same principle Minecraft uses.
 */

export const CHUNK_W = 32;
export const WORLD_H = 256;

export interface WorldConfig {
  seed: number;
  waterLevel: number;   // Y coordinate of the water table
  surfaceY: number;     // Base surface Y (from top)
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 42,
  waterLevel: 82,
  surfaceY: 80,
};

export type Chunk = Uint8Array[]; // WORLD_H rows of CHUNK_W columns

/**
 * Generate a single chunk at the given chunk-X index.
 *
 * The chunk index maps to world coordinates: chunkX=0 covers columns 0..31,
 * chunkX=1 covers 32..63, chunkX=-1 covers -32..-1, etc. Negative chunks
 * work because Perlin noise accepts any float coordinate.
 */
export function generateChunk(chunkX: number, config: WorldConfig): Chunk {
  const { seed, waterLevel, surfaceY } = config;
  const noise = createNoise(seed);
  const caveNoise = createNoise(seed + 1);
  const oreNoise = createNoise(seed + 2);
  const entranceNoise = createNoise(seed + 3);
  const treeNoise = createNoise(seed + 4);

  const chunk: Chunk = Array.from({ length: WORLD_H }, () => new Uint8Array(CHUNK_W));

  // World-space X offset for this chunk
  const worldXOffset = chunkX * CHUNK_W;

  // Generate surface heights for each column
  const surfaceHeights = new Float64Array(CHUNK_W);
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = worldXOffset + lx;
    const n = noise.fbm(wx / 80, 0, 5, 0.5, 2.0);
    surfaceHeights[lx] = surfaceY + n * 25;
  }

  // Fill blocks
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = worldXOffset + lx;
    const surface = Math.floor(surfaceHeights[lx]);

    for (let y = 0; y < WORLD_H; y++) {
      if (y < surface) {
        chunk[y][lx] = Block.Air;
        continue;
      }

      const depth = y - surface;
      const layerVar = noise.fbm(wx / 40, y / 40, 3, 0.5, 2.0) * 5;

      // Material layers
      if (depth < 5 + layerVar) {
        chunk[y][lx] = Block.Dirt;
      } else if (depth < 40 + layerVar) {
        chunk[y][lx] = Block.Stone;
      } else {
        chunk[y][lx] = Block.DeepStone;
      }

      // Caves (skip surface block)
      if (depth > 1) {
        const caveVal = caveNoise.fbm(wx / 25, y / 25, 4, 0.5, 2.0);
        if (caveVal > 0.35) {
          chunk[y][lx] = Block.Air;
        }
      }

      // Ore veins — small-scale noise pockets inside stone
      if (chunk[y][lx] === Block.Stone || chunk[y][lx] === Block.DeepStone) {
        const oreVal = oreNoise.fbm(wx / 8, y / 8, 2, 0.5, 2.0);
        if (oreVal > 0.55 && depth > 15) {
          chunk[y][lx] = Block.Iron;
        } else if (oreVal > 0.5 && depth > 8) {
          chunk[y][lx] = Block.Coal;
        }
      }
    }
  }

  // Near-surface cave erosion — a second, lower-threshold noise pass
  // that only affects the shallow zone. This creates irregular pockets
  // that sometimes break through the surface, replacing the old
  // rectangular entrance shafts with organic shapes.
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = worldXOffset + lx;
    const surface = Math.floor(surfaceHeights[lx]);

    for (let dy = 0; dy <= 15; dy++) {
      const y = surface + dy;
      if (y >= WORLD_H) break;

      // Use a separate noise sample with a smaller scale for rougher edges.
      // Lower the threshold near the surface so some openings breach it.
      const erosion = entranceNoise.fbm(wx / 12, y / 12, 3, 0.6, 2.0);
      const threshold = 0.25 + dy * 0.015; // easier to carve near surface
      if (erosion > threshold) {
        chunk[y][lx] = Block.Air;
      }
    }
  }

  // Surface decoration
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = worldXOffset + lx;
    // Find topmost solid
    let topY = -1;
    for (let y = 0; y < WORLD_H; y++) {
      if (chunk[y][lx] !== Block.Air && chunk[y][lx] !== Block.Water) {
        topY = y;
        break;
      }
    }
    if (topY < 0) continue;

    // Snow on peaks
    if (topY < surfaceY - 15) {
      chunk[topY][lx] = Block.Snow;
    }
    // Sand near water
    else if (Math.abs(topY - waterLevel) < 3) {
      chunk[topY][lx] = Block.Sand;
      if (topY + 1 < WORLD_H && chunk[topY + 1][lx] === Block.Dirt) {
        chunk[topY + 1][lx] = Block.Sand;
      }
    }
    // Grass
    else if (topY < waterLevel) {
      chunk[topY][lx] = Block.Grass;
    }

    // Trees — place on grass tiles, noise-driven selection
    if (chunk[topY][lx] === Block.Grass) {
      const treeVal = treeNoise.perlin2D(wx / 3, 0);
      if (treeVal > 0.4 && topY > 5) {
        const trunkH = 4 + Math.floor(Math.abs(treeNoise.perlin2D(wx, 1)) * 3);
        // Trunk
        for (let dy = 1; dy <= trunkH; dy++) {
          const ty = topY - dy;
          if (ty < 0) break;
          chunk[ty][lx] = Block.Wood;
        }
        // Canopy (diamond shape)
        const canopyTop = topY - trunkH;
        const canopyR = 2;
        for (let dy = -canopyR; dy <= 1; dy++) {
          const cy = canopyTop + dy;
          if (cy < 0) continue;
          const rowW = canopyR - Math.abs(dy) + 1;
          for (let dx = -rowW; dx <= rowW; dx++) {
            const cx = lx + dx;
            if (cx < 0 || cx >= CHUNK_W) continue;
            if (chunk[cy][cx] === Block.Air) {
              chunk[cy][cx] = Block.Leaves;
            }
          }
        }
      }
    }
  }

  // Water fill — flood from top
  const visited = Array.from({ length: WORLD_H }, () => new Uint8Array(CHUNK_W));
  const queue: [number, number][] = [];

  for (let lx = 0; lx < CHUNK_W; lx++) {
    if (chunk[0][lx] === Block.Air) {
      queue.push([lx, 0]);
      visited[0][lx] = 1;
    }
  }

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    if (cy >= waterLevel && chunk[cy][cx] === Block.Air) {
      chunk[cy][cx] = Block.Water;
    }

    const neighbors: [number, number][] = [
      [cx - 1, cy], [cx + 1, cy],
      [cx, cy - 1], [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= CHUNK_W || ny < 0 || ny >= WORLD_H) continue;
      if (visited[ny][nx]) continue;
      if (chunk[ny][nx] === Block.Air) {
        visited[ny][nx] = 1;
        queue.push([nx, ny]);
      }
    }
  }

  return chunk;
}
