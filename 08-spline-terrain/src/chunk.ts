import { Block, BLOCK_DEFS } from "./blocks";
import { createNoise } from "./perlin";
import {
  createBiomeSampler, BIOME_DEFS, Biome, classifyBiome, computeBlendedGrassColors,
  type BiomeId,
} from "./biomes";
import { createTerrainShaper } from "./terrainShape";
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
  heightMap: Float64Array;
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
  const caveNoiseB = createNoise(seed + 9);
  const oreNoise = createNoise(seed + 2);
  const treeNoise = createNoise(seed + 3);
  const lavaNoise      = createNoise(seed + 4);
  const glowstoneNoise = createNoise(seed + 8);
  const aquiferPresenceNoise = createNoise(seed + 13);
  const aquiferLevelNoise    = createNoise(seed + 14);
  const bedrockNoise         = createNoise(seed + 15);
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const worldXOff = chunkX * CHUNK_SIZE;
  const worldYOff = chunkY * CHUNK_SIZE;
  const worldZOff = chunkZ * CHUNK_SIZE;

  // Climate + spline pipeline replaces biome-driven heights.
  const terrainShaper = createTerrainShaper(seed, config.params);
  const tempHumidSampler = createBiomeSampler(seed, config.params.biomes);

  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
  const biomes  = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const idx = lz * CHUNK_SIZE + lx;
      const sample = terrainShaper.sampleClimate(wx, wz);
      const h = terrainShaper.heightFromClimate(sample);
      heights[idx] = h;
      const { temp, humid } = tempHumidSampler(wx, wz);
      biomes[idx] = classifyBiome(
        sample.continentalness, sample.erosion, temp, humid,
        h, waterLevel, config.params.shape.biomeClimate,
      );
    }
  }

  const { grassColors } = computeBlendedGrassColors(
    worldXOff, worldZOff, CHUNK_SIZE,
    tempHumidSampler,
    (lx, lz) => biomes[lz * CHUNK_SIZE + lx] as BiomeId,
  );

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
          paddedMap[pz * padSize + px] = terrainShaper.heightAt(wx, wz);
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

        // 3D caves — intersecting-noise tubes.
        // Two independent fbm3D fields, each thresholded as |n|<t, define 2D
        // iso-surfaces; their intersection is a 1D curve → winding tunnel.
        // verticalStretch > 1 makes y vary faster than xz, so ∂n/∂y is large
        // and iso-surfaces are near-horizontal slabs → horizontal tunnels.
        // Depth-biased threshold: tight near surface (few openings), wider deep.
        // Near the surface (depth < entryDepth) we also require the voxel one
        // step up to be in the tunnel: this means the tunnel extends vertically
        // through the surface, so entries become clean shafts instead of long
        // horizontal gashes parallel to the surface.
        if (depth >= caves.minDepth) {
          const yScaled = (wy * caves.verticalStretch) / caves.scale;
          const n1 = caveNoise.fbm3D(wx / caves.scale, yScaled, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const n2 = caveNoiseB.fbm3D(wx / caves.scale, yScaled, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const t = Math.min(caves.thresholdMax, caves.thresholdBase + depth * caves.depthGain);
          if (Math.abs(n1) < t && Math.abs(n2) < t) {
            let carve = true;
            if (depth < caves.entryDepth) {
              const yScaledUp = ((wy + 1) * caves.verticalStretch) / caves.scale;
              const n1Up = caveNoise.fbm3D(wx / caves.scale, yScaledUp, wz / caves.scale, caves.octaves, 0.5, 2.0);
              const n2Up = caveNoiseB.fbm3D(wx / caves.scale, yScaledUp, wz / caves.scale, caves.octaves, 0.5, 2.0);
              if (Math.abs(n1Up) >= t || Math.abs(n2Up) >= t) carve = false;
            }
            if (carve) block = Block.Air;
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

  // ── Aquifer / lake pass ──────────────────────────────────────────
  // A low-frequency 3D presence field marks regions that have a local
  // water table; a 2D level field gives that region a smoothly-varying
  // local water surface height. Any Air cell inside such a region at or
  // below the local surface becomes Water — this produces both flooded
  // cave aquifers underground and surface ponds that sit above the
  // global ocean water level.
  const { aquifers } = config.params;
  if (aquifers.enabled) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = worldZOff + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = worldXOff + lx;
        const colIdx = lz * CHUNK_SIZE + lx;
        // Skip ocean columns — aquifers only form on land
        if (heights[colIdx] <= waterLevel) continue;

        // Column-constant local water surface. Computed once per column
        // and floored to an integer so lakes have flat surfaces.
        const rawLevel = waterLevel + aquifers.levelOffset
          + aquiferLevelNoise.fbm2D(
              wx / aquifers.levelScale,
              wz / aquifers.levelScale,
              2, 0.5, 2.0,
            ) * aquifers.levelAmplitude;
        const localSurface = Math.floor(rawLevel);

        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const wy = worldYOff + ly;
          const voxIdx = chunkIndex(lx, ly, lz);
          if (data[voxIdx] !== Block.Air) continue;
          if (wy > localSurface) continue;

          const presence = aquiferPresenceNoise.fbm3D(
            wx / aquifers.presenceScale,
            wy / (aquifers.presenceScale * 2),
            wz / aquifers.presenceScale,
            2, 0.5, 2.0,
          );
          if (presence <= aquifers.presenceThreshold) continue;

          data[voxIdx] = Block.Water;
        }
      }
    }
  }

  // Surface blocks directly under water become sub-surface (grass → dirt,
  // etc). Fixes the eyesore of seeing grass through flooded cave mouths,
  // aquifer-formed lakes, and river channels.
  for (let ly = CHUNK_SIZE - 1; ly >= 1; ly--) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (data[chunkIndex(lx, ly, lz)] !== Block.Water) continue;
        const belowIdx = chunkIndex(lx, ly - 1, lz);
        const biomeDef = BIOME_DEFS[biomes[lz * CHUNK_SIZE + lx]];
        if (data[belowIdx] === biomeDef.surfaceBlock) {
          data[belowIdx] = biomeDef.subSurfaceBlock;
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

  // ── Bedrock floor ────────────────────────────────────────────────
  // Absolute impassable bottom: wy = BEDROCK_BOTTOM is 100% bedrock,
  // wy up to BEDROCK_BOTTOM+2 is stochastically bedrock (jagged top).
  // Runs last so it overrides caves, aquifers, lava, and glowstone.
  const BEDROCK_BOTTOM = config.params.extent.minHeight;
  const BEDROCK_FUZZY_HEIGHT = 2;
  if (worldYOff <= BEDROCK_BOTTOM + BEDROCK_FUZZY_HEIGHT && worldYOff + CHUNK_SIZE > BEDROCK_BOTTOM) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const wy = worldYOff + ly;
      if (wy < BEDROCK_BOTTOM || wy > BEDROCK_BOTTOM + BEDROCK_FUZZY_HEIGHT) continue;
      const rowAbove = wy - BEDROCK_BOTTOM;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (rowAbove === 0) {
            data[chunkIndex(lx, ly, lz)] = Block.Bedrock;
          } else {
            const wx = worldXOff + lx;
            const wz = worldZOff + lz;
            const n = bedrockNoise.perlin2D((wx + rowAbove * 13) / 3, (wz + rowAbove * 17) / 3);
            const threshold = -0.66 + rowAbove * 0.5;
            if (n > threshold) data[chunkIndex(lx, ly, lz)] = Block.Bedrock;
          }
        }
      }
    }
  }

  // Structure placement pass — vegetation
  //
  // Two-stage tree placement:
  //   Stage 1 builds a treeMask from pure noise/height data (no data[] reads),
  //   applying a ≥1-block spacing rule so adjacent trunks get rejected. Because
  //   stage 1 is data-free, this chunk and the chunk above compute identical
  //   masks, keeping cross-chunk canopy painting consistent.
  //   Stage 2 places trees where the mask allows and cacti as before. Each chunk
  //   also paints leaves for trees whose surface sits in the chunk directly
  //   below, so canopies that cross a chunk Y boundary still render.
  const MAX_TREE_REACH = 10;
  const treeMask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  // ── Stage 1: decide tree-bearing columns with spacing ────────────
  for (let lz = 3; lz < CHUNK_SIZE - 3; lz++) {
    for (let lx = 3; lx < CHUNK_SIZE - 3; lx++) {
      const colIdx = lz * CHUNK_SIZE + lx;
      const biomeDef = BIOME_DEFS[biomes[colIdx]];
      if (biomeDef.treeWood === null || biomeDef.treeLeaves === null) continue;
      if (heights[colIdx] <= waterLevel) continue;

      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const treeVal = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
      const normalised = (treeVal + 1) * 0.5;
      if (normalised >= biomeDef.treeDensity * config.params.vegetation.treeDensity) continue;

      // Reject if any already-decided neighbour tree sits in the 3×3 footprint.
      let conflict = false;
      for (let dz = -1; dz <= 1 && !conflict; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (treeMask[(lz + dz) * CHUNK_SIZE + (lx + dx)]) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) continue;

      treeMask[colIdx] = 1;
    }
  }

  // ── Stage 2: paint trees and cacti ───────────────────────────────
  for (let lz = 1; lz < CHUNK_SIZE - 1; lz++) {
    for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const colIdx = lz * CHUNK_SIZE + lx;
      const biome = biomes[colIdx];
      const biomeDef = BIOME_DEFS[biome];
      const surfaceH = heights[colIdx];

      if (surfaceH <= waterLevel) continue;

      const surfaceLocal = Math.floor(surfaceH) - worldYOff;
      if (surfaceLocal >= CHUNK_SIZE) continue;          // tree entirely above us
      if (surfaceLocal + MAX_TREE_REACH < 0) continue;   // tree ends below us

      // Surface-block check only runs when the surface cell is in this chunk.
      // Cross-chunk leaf painting trusts deterministic noise.
      if (surfaceLocal >= 0) {
        if (surfaceLocal < 4 || surfaceLocal >= CHUNK_SIZE - 1) continue;
        const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
        if (surfBlock !== biomeDef.surfaceBlock) continue;
      }

      // Cactus (desert) — no tree biomes overlap, so no mask needed.
      if (biomeDef.cactus) {
        const treeVal = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
        const normalised = (treeVal + 1) * 0.5;
        if (normalised < 0.04 * config.params.vegetation.treeDensity && surfaceLocal >= 0) {
          placeCactus(data, lx, surfaceLocal, lz);
        }
        continue;
      }

      if (!treeMask[colIdx]) continue;

      const wood = biomeDef.treeWood!;
      const leaves = biomeDef.treeLeaves!;
      if (wood === Block.SpruceWood) {
        placeSpruceTree(data, lx, surfaceLocal, lz, wood, leaves);
      } else if (wood === Block.BirchWood) {
        placeBirchTree(data, lx, surfaceLocal, lz, wood, leaves);
      } else {
        placeOakTree(data, lx, surfaceLocal, lz, wood, leaves);
      }
    }
  }

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
    // Pyramid in desert (changing the value increases or decreases the frequency of structures)
    if (centerBiome === Biome.Desert && structVal > 0.7) {
      placePyramid(data, centerLx, centerSurfLocal, centerLz);
    }
    // Igloo in tundra
    else if (centerBiome === Biome.Tundra && structVal > 0.55) {
      placeIgloo(data, centerLx, centerSurfLocal, centerLz);
    }
    // Village houses in plains/savanna
    else if ((centerBiome === Biome.Plains || centerBiome === Biome.Savanna) && structVal > 0.6) {
      placeHouse(data, centerLx, centerSurfLocal, centerLz);
      // Often place a second house nearby
      if (structVal > 0.4 && centerLx + 10 < CHUNK_SIZE - 1 && centerLz + 8 < CHUNK_SIZE - 1) {
        placeHouse(data, centerLx + 8, centerSurfLocal, centerLz + 6);
      }
    }
  }

  return { data, grassColors, heightMap: heights };
}
