import { Block } from "./blocks";
import { createNoise } from "./perlin";

/**
 * 3D chunk generation.
 *
 * Each chunk is a cubic region of CHUNK_SIZE^3 voxels. The world is
 * divided into chunks along all three axes: (chunkX, chunkY, chunkZ).
 *
 * The terrain is generated in two passes:
 * 1. Heightmap — 2D fBm defines the surface height at each (x, z).
 *    Blocks below the surface are filled based on depth (grass/dirt/stone).
 * 2. Caves — 3D fBm carves tunnels through underground blocks. This is
 *    the natural extension of the 2D cave thresholding from project 03
 *    into three dimensions.
 */

export const CHUNK_SIZE = 32;

export interface WorldConfig {
  seed: number;
  waterLevel: number; // World-space Y below which water fills air
  baseHeight: number; // Average surface Y in world space
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 42,
  waterLevel: 30,
  baseHeight: 32,
};

/** Flat array of CHUNK_SIZE^3 block IDs, indexed [y * CHUNK_SIZE^2 + z * CHUNK_SIZE + x]. */
export type ChunkData = Uint8Array;

export function chunkIndex(x: number, y: number, z: number): number {
  return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
}

export function generateChunk(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  config: WorldConfig,
): ChunkData {
  const { seed, waterLevel, baseHeight } = config;
  const noise = createNoise(seed);
  const caveNoise = createNoise(seed + 1);
  const oreNoise = createNoise(seed + 2);

  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const worldXOff = chunkX * CHUNK_SIZE;
  const worldYOff = chunkY * CHUNK_SIZE;
  const worldZOff = chunkZ * CHUNK_SIZE;

  // Pre-compute surface heights for this chunk's XZ footprint
  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const h = noise.fbm2D(wx / 80, wz / 80, 5, 0.5, 2.0);
      heights[lz * CHUNK_SIZE + lx] = baseHeight + h * 20;
    }
  }

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = worldYOff + ly;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = worldXOff + lx;
        const wz = worldZOff + lz;
        const surfaceH = heights[lz * CHUNK_SIZE + lx];
        const idx = chunkIndex(lx, ly, lz);

        if (wy > surfaceH) {
          // Above surface — air or water
          data[idx] = wy <= waterLevel ? Block.Water : Block.Air;
          continue;
        }

        const depth = surfaceH - wy;

        // Material layers
        let block: number;
        const layerVar = noise.fbm2D(wx / 40, wz / 40, 3, 0.5, 2.0) * 3;
        if (depth < 1) {
          block = Block.Grass;
        } else if (depth < 5 + layerVar) {
          block = Block.Dirt;
        } else if (depth < 30 + layerVar) {
          block = Block.Stone;
        } else {
          block = Block.DeepStone;
        }

        // Sand near water level
        if (depth < 3 && Math.abs(surfaceH - waterLevel) < 2) {
          block = Block.Sand;
        }

        // Snow on high peaks
        if (depth < 1 && surfaceH < baseHeight - 12) {
          block = Block.Snow;
        }

        // 3D cave carving
        if (depth > 2) {
          const caveVal = caveNoise.fbm3D(wx / 20, wy / 20, wz / 20, 3, 0.5, 2.0);
          if (caveVal > 0.4) {
            block = wy <= waterLevel ? Block.Water : Block.Air;
          }
        }

        // Ore pockets
        if (block === Block.Stone || block === Block.DeepStone) {
          const oreVal = oreNoise.fbm3D(wx / 6, wy / 6, wz / 6, 2, 0.5, 2.0);
          if (oreVal > 0.55 && depth > 15) {
            block = Block.Iron;
          } else if (oreVal > 0.5 && depth > 8) {
            block = Block.Coal;
          }
        }

        data[idx] = block;
      }
    }
  }

  return data;
}
