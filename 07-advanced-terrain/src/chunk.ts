import { Block, BLOCK_DEFS } from "./blocks";
import { createNoise } from "./perlin";
import { createBiomeSampler, BIOME_DEFS, Biome, computeBlendedBiomeParams } from "./biomes";
import { placeOakTree, placeSpruceTree, placeBirchTree, placeCactus, placePyramid, placeIgloo, placeHouse } from "./structures";
import { erode } from "./erosion";
import { type GenerationParams, DEFAULT_PARAMS, toErosionConfig } from "./generationParams";

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
  params: GenerationParams;
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 42,
  waterLevel: 0,
  baseHeight: 0,
  params: DEFAULT_PARAMS,
};

export type ChunkData = Uint8Array;

export interface ChunkResult {
  data: ChunkData;
  grassColors: Uint32Array;
}

export function chunkIndex(x: number, y: number, z: number): number {
  return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
}

export function generateChunk(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  config: WorldConfig,
): ChunkResult {
  const { seed, waterLevel, baseHeight } = config;
  const noise = createNoise(seed);
  const caveNoise = createNoise(seed + 1);
  const oreNoise = createNoise(seed + 2);
  const treeNoise = createNoise(seed + 3);
  const lavaNoise      = createNoise(seed + 4);
  const glowstoneNoise = createNoise(seed + 8);
  const getBiome = createBiomeSampler(seed, config.params.biomes);

  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const worldXOff = chunkX * CHUNK_SIZE;
  const worldYOff = chunkY * CHUNK_SIZE;
  const worldZOff = chunkZ * CHUNK_SIZE;

  // Biome blending: compute averaged heightScale/heightOffset over a 9x9
  // kernel per column. The dominant biome is used for block selection.
  const { blendedScales, blendedOffsets, dominantBiomes, grassColors } = computeBlendedBiomeParams(
    worldXOff, worldZOff, CHUNK_SIZE, getBiome,
  );

  const biomes = dominantBiomes;
  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);

  const { terrain } = config.params;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const idx = lz * CHUNK_SIZE + lx;

      const baseNoise = noise.warpedFbm2D(
        wx / terrain.scale, wz / terrain.scale,
        terrain.octaves, terrain.persistence, terrain.lacunarity,
        terrain.warpStrength,
        terrain.warpIterations,
      );
      heights[idx] = baseHeight + blendedOffsets[idx] + baseNoise * terrain.heightMultiplier * blendedScales[idx];
    }
  }

  // ── River channels from Voronoi edges ────────────────────────────
  // Voronoi F2-F1 → 0 at cell boundaries. We use this to carve
  // river-like channels into the terrain. Only below a depth threshold
  // so rivers don't cut through mountain peaks.
  const { rivers } = config.params;
  const riverNoise = createNoise(seed + 7);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const idx = lz * CHUNK_SIZE + lx;

      const v = riverNoise.voronoi2D(wx / rivers.voronoiScale, wz / rivers.voronoiScale);
      const edgeDist = v.f2 - v.f1;

      if (edgeDist < rivers.edgeThreshold) {
        const carveStrength = (1 - edgeDist / rivers.edgeThreshold);
        const currentHeight = heights[idx];
        if (currentHeight > waterLevel - 2) {
          const maxCarve = rivers.maxCarveDepth * carveStrength * carveStrength;
          heights[idx] = Math.max(waterLevel - 2, currentHeight - maxCarve);
        }
      }
    }
  }

  // ── Erosion pass ─────────────────────────────────────────────────
  // Generate a padded heightmap, run erosion on it, then copy
  // the inner region back to heights[].
  if (config.params.erosion.enabled) {
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
            wx / terrain.scale, wz / terrain.scale,
            terrain.octaves, terrain.persistence, terrain.lacunarity,
            terrain.warpStrength, terrain.warpIterations,
          );
          paddedMap[pz * padSize + px] = baseHeight + marginDef.heightOffset
            + marginNoise * terrain.heightMultiplier * marginDef.heightScale;
        }
      }
    }

    // Run erosion
    erode(paddedMap, padSize, toErosionConfig(config.params.erosion),
      seed + chunkX * 73856093 + chunkZ * 19349663);

    // Copy eroded heights back
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        heights[lz * CHUNK_SIZE + lx] = paddedMap[(lz + ERODE_PAD) * padSize + (lx + ERODE_PAD)];
      }
    }
  }

  // Fill voxels
  const { caves } = config.params;
  const { ores } = config.params;
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
          const caveVal = caveNoise.fbm3D(wx / caves.scale, wy / caves.scale, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const threshold = depth < 8 ? caves.threshold - 0.03 + (depth - 2) * 0.005 : caves.threshold;
          if (caveVal > threshold) {
            block = wy <= waterLevel ? Block.Water : Block.Air;
          }
        }

        // Ores
        if (block === Block.Stone || block === Block.DeepStone) {
          const oreVal = oreNoise.fbm3D(wx / ores.scale, wy / ores.scale, wz / ores.scale, 2, 0.5, 2.0);
          if (oreVal > ores.ironThreshold && depth > ores.ironMinDepth) {
            block = Block.Iron;
          } else if (oreVal > ores.coalThreshold && depth > 8) {
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

      for (let dy = 0; dy <= caves.surfaceErosionDepth; dy++) {
        const ly = surfaceLocal - dy;
        if (ly < 0 || ly >= CHUNK_SIZE) continue;
        const wy = worldYOff + ly;
        if (wy <= waterLevel) continue;

        const erosion = erosionNoise.fbm3D(
          wx / caves.surfaceErosionScale, wy / caves.surfaceErosionScale, wz / caves.surfaceErosionScale,
          3, 0.5, 2.0,
        );
        const threshold = caves.surfaceErosionThreshold + dy * 0.02;
        if (erosion > threshold) {
          data[chunkIndex(lx, ly, lz)] = Block.Air;
        }
      }
    }
  }

  // ── Lava placement (deep chunks only) ────────────────────────────────────
  // Replace cave air with lava in chunks at world Y ≤ -1.
  if (chunkY <= -1) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
          const wx = worldXOff + lx;
          const wz = worldZOff + lz;
          const n = lavaNoise.perlin2D(wx / 20, wz / 20);
          if (n > 0.7) data[chunkIndex(lx, ly, lz)] = Block.Lava;
        }
      }
    }
  }

  // ── Glowstone placement (cave ceilings, all depths) ───────────────────────
  // Replace cave air that has a solid block directly above it (ceiling).
  for (let ly = 0; ly < CHUNK_SIZE - 1; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
        const above = data[chunkIndex(lx, ly + 1, lz)];
        const aboveDef = BLOCK_DEFS[above];
        if (!aboveDef || aboveDef.transparent) continue; // no solid ceiling
        const wx = worldXOff + lx;
        const wz = worldZOff + lz;
        const n = glowstoneNoise.perlin2D(wx / 15, wz / 15);
        if (n > 0.65) data[chunkIndex(lx, ly, lz)] = Block.Glowstone;
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
    if (centerBiome === Biome.Desert && structVal > 0.4) {
      placePyramid(data, centerLx, centerSurfLocal, centerLz);
    }
    // Igloo in tundra (~25% of tundra chunks)
    else if (centerBiome === Biome.Tundra && structVal > 0.55) {
      placeIgloo(data, centerLx, centerSurfLocal, centerLz);
    }
    // Village houses in plains/savanna (~20% of chunks)
    else if ((centerBiome === Biome.Plains || centerBiome === Biome.Savanna) && structVal > 0.35) {
      placeHouse(data, centerLx, centerSurfLocal, centerLz);
      // Often place a second house nearby
      if (structVal > 0.4 && centerLx + 10 < CHUNK_SIZE - 1 && centerLz + 8 < CHUNK_SIZE - 1) {
        placeHouse(data, centerLx + 8, centerSurfLocal, centerLz + 6);
      }
    }
  }

  return { data, grassColors };
}
