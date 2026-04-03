import { Block } from "./blocks";
import { createNoise } from "./perlin";
import { createBiomeSampler, BIOME_DEFS, Biome, computeBlendedBiomeParams } from "./biomes";
import { placeOakTree, placeSpruceTree, placeBirchTree, placeCactus, placePyramid, placeIgloo, placeHouse } from "./structures";
import { erode, DEFAULT_EROSION } from "./erosion";

/**
 * 3D chunk generation with biome-aware terrain and biome blending.
 *
 * Extends project 05's pipeline with:
 * 1. Biome blending — instead of sampling a single biome per column,
 *    height parameters (heightScale, heightOffset) are averaged over
 *    a 9x9 kernel. This eliminates vertical cliff walls at biome
 *    boundaries and produces smooth terrain transitions.
 * 2. Sea-level reference — water level and base height are both 0,
 *    so Y=0 is the ocean surface. Terrain extends above and below.
 */

export const CHUNK_SIZE = 16;

export interface WorldConfig {
  seed: number;
  waterLevel: number;
  baseHeight: number;
  enableErosion: boolean;
  erosionDroplets: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 42,
  waterLevel: 0,
  baseHeight: 0,
  enableErosion: true,
  erosionDroplets: 1500,
};

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
  const treeNoise = createNoise(seed + 3);
  const getBiome = createBiomeSampler(seed);

  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const worldXOff = chunkX * CHUNK_SIZE;
  const worldYOff = chunkY * CHUNK_SIZE;
  const worldZOff = chunkZ * CHUNK_SIZE;

  // Biome blending: compute averaged heightScale/heightOffset over a 9x9
  // kernel per column. The dominant biome is used for block selection.
  const { blendedScales, blendedOffsets, dominantBiomes } = computeBlendedBiomeParams(
    worldXOff, worldZOff, CHUNK_SIZE, getBiome,
  );

  const biomes = dominantBiomes;
  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const idx = lz * CHUNK_SIZE + lx;

      // Domain-warped fBm: produces dramatic cliff formations and organic shapes
      // warpStrength=3 + 1 iteration gives strong but not chaotic distortion
      const baseNoise = noise.warpedFbm2D(
        wx / 80, wz / 80,
        5, 0.5, 2.0,
        /* warpStrength */ 3.0,
        /* iterations */ 1,
      );
      heights[idx] = baseHeight + blendedOffsets[idx] + baseNoise * 20 * blendedScales[idx];
    }
  }

  // ── Erosion pass ─────────────────────────────────────────────────
  // Generate a padded heightmap, run erosion on it, then copy
  // the inner region back to heights[].
  if (config.enableErosion) {
    const ERODE_PAD = 8;
    const padSize = CHUNK_SIZE + 2 * ERODE_PAD;
    const paddedMap = new Float64Array(padSize * padSize);

    // Fill padded heightmap — recompute heights for the margin area
    for (let pz = 0; pz < padSize; pz++) {
      for (let px = 0; px < padSize; px++) {
        const wx = worldXOff - ERODE_PAD + px;
        const wz = worldZOff - ERODE_PAD + pz;

        // For cells inside the chunk, use precomputed values
        const lx = px - ERODE_PAD;
        const lz = pz - ERODE_PAD;
        if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
          paddedMap[pz * padSize + px] = heights[lz * CHUNK_SIZE + lx];
        } else {
          // Recompute for margin cells
          const marginBiome = getBiome(wx, wz);
          const marginDef = BIOME_DEFS[marginBiome];
          const marginNoise = noise.warpedFbm2D(
            wx / 80, wz / 80,
            5, 0.5, 2.0, 3.0, 1,
          );
          paddedMap[pz * padSize + px] = baseHeight + marginDef.heightOffset + marginNoise * 20 * marginDef.heightScale;
        }
      }
    }

    // Run erosion
    erode(paddedMap, padSize, {
      ...DEFAULT_EROSION,
      droplets: config.erosionDroplets,
    }, seed + chunkX * 73856093 + chunkZ * 19349663);

    // Copy eroded heights back
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        heights[lz * CHUNK_SIZE + lx] = paddedMap[(lz + ERODE_PAD) * padSize + (lx + ERODE_PAD)];
      }
    }
  }

  // Fill voxels
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = worldYOff + ly;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = worldXOff + lx;
        const wz = worldZOff + lz;
        const colIdx = lz * CHUNK_SIZE + lx;
        const surfaceH = heights[colIdx];
        const biome = biomes[colIdx];
        const biomeDef = BIOME_DEFS[biome];
        const voxIdx = chunkIndex(lx, ly, lz);

        if (wy > surfaceH) {
          data[voxIdx] = wy <= waterLevel ? Block.Water : Block.Air;
          continue;
        }

        const depth = surfaceH - wy;
        const layerVar = noise.fbm2D(wx / 40, wz / 40, 3, 0.5, 2.0) * 3;

        let block: number;
        if (depth < 1) {
          block = biomeDef.surfaceBlock;
        } else if (depth < 5 + layerVar) {
          block = biomeDef.subSurfaceBlock;
        } else if (depth < 30 + layerVar) {
          block = Block.Stone;
        } else {
          block = Block.DeepStone;
        }

        // Snow cap on mountain peaks
        if (biome === Biome.Mountains && depth < 1 && surfaceH > 30) {
          block = Block.Snow;
        }

        // Ice on water in cold biomes
        if (wy === waterLevel && data[voxIdx] === Block.Water) {
          if (biome === Biome.Tundra || biome === Biome.Taiga) {
            block = Block.Ice;
          }
        }

        // Gravel patches on ocean floor
        if (biome === Biome.Ocean && depth < 2) {
          const gravelVal = noise.perlin2D(wx / 8, wz / 8);
          if (gravelVal > 0.3) block = Block.Gravel;
        }

        // 3D caves — larger scale = wider tunnels, higher threshold = fewer caves
        // Threshold eases near surface so some caves open to the sky
        if (depth > 1) {
          const caveVal = caveNoise.fbm3D(wx / 30, wy / 30, wz / 30, 3, 0.5, 2.0);
          const threshold = depth < 8 ? 0.42 + (depth - 2) * 0.005 : 0.45;
          if (caveVal > threshold) {
            block = wy <= waterLevel ? Block.Water : Block.Air;
          }
        }

        // Ores
        if (block === Block.Stone || block === Block.DeepStone) {
          const oreVal = oreNoise.fbm3D(wx / 6, wy / 6, wz / 6, 2, 0.5, 2.0);
          if (oreVal > 0.55 && depth > 15) {
            block = Block.Iron;
          } else if (oreVal > 0.5 && depth > 8) {
            block = Block.Coal;
          }
        }

        data[voxIdx] = block;
      }
    }
  }

  // Surface cave erosion — carve irregular openings near the surface
  // using a separate noise field so caves sometimes breach the surface
  const erosionNoise = createNoise(seed + 5);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const surfaceH = heights[lz * CHUNK_SIZE + lx];
      const surfaceLocal = Math.floor(surfaceH) - worldYOff;

      for (let dy = 0; dy <= 8; dy++) {
        const ly = surfaceLocal - dy;
        if (ly < 0 || ly >= CHUNK_SIZE) continue;
        const wy = worldYOff + ly;
        if (wy <= waterLevel) continue;

        const erosion = erosionNoise.fbm3D(wx / 16, wy / 16, wz / 16, 3, 0.5, 2.0);
        const threshold = 0.38 + dy * 0.02;
        if (erosion > threshold) {
          data[chunkIndex(lx, ly, lz)] = Block.Air;
        }
      }
    }
  }

  // Structure placement pass — vegetation
  for (let lz = 1; lz < CHUNK_SIZE - 1; lz++) {
    for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const colIdx = lz * CHUNK_SIZE + lx;
      const biome = biomes[colIdx];
      const biomeDef = BIOME_DEFS[biome];
      const surfaceH = heights[colIdx];

      const surfaceLocal = Math.floor(surfaceH) - worldYOff;
      if (surfaceLocal < 4 || surfaceLocal >= CHUNK_SIZE - 1) continue;

      const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
      if (surfBlock !== biomeDef.surfaceBlock) continue;

      if (surfaceH <= waterLevel) continue;

      const treeVal = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
      const normalised = (treeVal + 1) * 0.5;

      if (biomeDef.cactus && normalised < 0.04) {
        placeCactus(data, lx, surfaceLocal, lz);
        continue;
      }

      if (biomeDef.treeWood !== null && biomeDef.treeLeaves !== null && normalised < biomeDef.treeDensity) {
        if (lx < 3 || lx >= CHUNK_SIZE - 3 || lz < 3 || lz >= CHUNK_SIZE - 3) continue;

        const wood = biomeDef.treeWood;
        const leaves = biomeDef.treeLeaves;

        if (wood === Block.SpruceWood) {
          placeSpruceTree(data, lx, surfaceLocal, lz, wood, leaves);
        } else if (wood === Block.BirchWood) {
          placeBirchTree(data, lx, surfaceLocal, lz, wood, leaves);
        } else {
          placeOakTree(data, lx, surfaceLocal, lz, wood, leaves);
        }
      }
    }
  }

  // Large structure placement — use noise at chunk scale so structures
  // are rare and deterministically placed. Only attempt near chunk center
  // so structures don't clip at boundaries.
  const structNoise = createNoise(seed + 6);
  const structVal = structNoise.perlin2D(chunkX * 1.17, chunkZ * 1.17);
  const centerLx = Math.floor(CHUNK_SIZE / 2);
  const centerLz = Math.floor(CHUNK_SIZE / 2);
  const centerColIdx = centerLz * CHUNK_SIZE + centerLx;
  const centerBiome = biomes[centerColIdx];
  const centerSurfaceH = heights[centerColIdx];
  const centerSurfLocal = Math.floor(centerSurfaceH) - worldYOff;

  if (centerSurfLocal >= 4 && centerSurfLocal < CHUNK_SIZE - 8 && centerSurfaceH > waterLevel) {
    // Pyramid in desert (~20% of desert chunks)
    if (centerBiome === Biome.Desert && structVal > 0.2) {
      placePyramid(data, centerLx, centerSurfLocal, centerLz);
    }
    // Igloo in tundra (~25% of tundra chunks)
    else if (centerBiome === Biome.Tundra && structVal > 0.15) {
      placeIgloo(data, centerLx, centerSurfLocal, centerLz);
    }
    // Village houses in plains/savanna (~20% of chunks)
    else if ((centerBiome === Biome.Plains || centerBiome === Biome.Savanna) && structVal > 0.2) {
      placeHouse(data, centerLx, centerSurfLocal, centerLz);
      // Often place a second house nearby
      if (structVal > 0.3 && centerLx + 10 < CHUNK_SIZE - 1 && centerLz + 8 < CHUNK_SIZE - 1) {
        placeHouse(data, centerLx + 8, centerSurfLocal, centerLz + 6);
      }
    }
  }

  return data;
}
