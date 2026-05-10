import { Block, BLOCK_DEFS } from "./blocks";
import { createNoise } from "./perlin";
import {
  createBiomeSampler, BIOME_DEFS, Biome, classifyBiome, computeBlendedGrassColors,
  type BiomeId,
} from "./biomes";
import { placeOakTree, placeSpruceTree, placeBirchTree, placeCactus, placePyramid, placeIgloo, placeHouse } from "./structures";
import { type GenerationParams, DEFAULT_PARAMS } from "./generationParams";
import { createOffsetFactorSampler, type ColumnFields } from "./offsetFactor";
import { createDensitySampler } from "./densityField";
import { fillChunkDensity } from "./chunkDensity";

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
  const { seed, waterLevel } = config;
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const wxOff = chunkX * CHUNK_SIZE;
  const wyOff = chunkY * CHUNK_SIZE;
  const wzOff = chunkZ * CHUNK_SIZE;

  // Re-use the same seed offsets the legacy branch used so visual identity
  // (ore positions, gravel patches, etc.) stays consistent across the swap.
  const layerNoise  = createNoise(seed);
  const gravelNoise = createNoise(seed);

  // ── 1. Climate sampling (per column) ──────────────────────────────
  const offsetFactor = createOffsetFactorSampler(seed, config.params);
  const density = createDensitySampler(seed, config.params, offsetFactor, waterLevel);
  const tempHumidSampler = createBiomeSampler(seed, config.params.biomes);

  const columnFields: ColumnFields[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
  const colTemp     = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colHumid    = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colContinent= new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colErosion  = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colPV       = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const biomes      = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const idx = lz * CHUNK_SIZE + lx;
      const sample = offsetFactor.sampleClimate(wx, wz);
      columnFields[idx] = offsetFactor.fieldsFromClimate(sample, wx, wz);
      const { temp, humid } = tempHumidSampler(wx, wz);
      biomes[idx] = classifyBiome(
        sample.continentalness, sample.erosion, sample.peaksValleys,
        temp, humid, config.params.biomePicker,
      );
      colTemp[idx]      = temp;
      colHumid[idx]     = humid;
      colContinent[idx] = sample.continentalness;
      colErosion[idx]   = sample.erosion;
      colPV[idx]        = sample.peaksValleys;
    }
  }

  // ── 2. Per-column detail amplitude (biome.terrainDrama × jaggedness gate) ─
  // The per-voxel detail noise (in fillChunkDensity) is what produces overhangs
  // and surface texture. Scaling per column by biome lets us keep deserts/
  // plains smooth while mountains/windswept get the rocky chaos.
  const detailAmps = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
    const drama = BIOME_DEFS[biomes[i]].terrainDrama;
    // Mix biome drama with jaggedness so even within a "Mountains" biome,
    // the high-PV columns get more detail than the low-PV columns. Constant
    // 0.04 keeps the product in the [0, ~1] range typical for jaggedness.
    detailAmps[i] = drama * (0.5 + columnFields[i].jaggedness * 0.04);
  }

  // ── 3. Coarse density grid + trilerp → solid mask ─────────────────
  const solid = fillChunkDensity(chunkX, chunkY, chunkZ, seed, offsetFactor, density, columnFields, detailAmps);

  // ── 3. Voxelize: solid → block, with depth tracked top-down per column.
  const heights = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let i = 0; i < heights.length; i++) heights[i] = -Infinity;

  // Track "depth below highest solid in this chunk's column", needed for surface/sub-surface/stone tiers.
  // We iterate y top-down so air voxels reset depth, and the first solid voxel becomes the surface.
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const colIdx = lz * CHUNK_SIZE + lx;
      const biomeId = biomes[colIdx];
      const biomeDef = BIOME_DEFS[biomeId];
      // Per-column constants — hoisted out of the inner Y loop.
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const layerVar = layerNoise.fbm2D(wx / 40, wz / 40, 3, 0.5, 2.0) * 3;
      const gravelVal = gravelNoise.perlin2D(wx / 8, wz / 8);
      // `topmostSolidWy` records the highest solid y seen so far in this column.
      // Not reset on cave gaps — the snow-cap rule below uses the column-top, not
      // the local-stratum top, which is the intended behavior.
      let depth = -1; // -1 means "no solid seen yet in this column"
      let topmostSolidWy = -Infinity;
      for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
        const wy = wyOff + ly;
        const voxIdx = chunkIndex(lx, ly, lz);
        const isSolid = solid[voxIdx] === 1;
        if (!isSolid) {
          depth = -1;
          data[voxIdx] = wy <= waterLevel ? Block.Water : Block.Air;
          continue;
        }
        if (depth === -1) {
          depth = 0;
          if (topmostSolidWy === -Infinity) topmostSolidWy = wy;
          if (heights[colIdx] === -Infinity) heights[colIdx] = wy;
        }

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
        if (biomeId === Biome.Mountains && depth < 1 && topmostSolidWy > 30) {
          block = Block.Snow;
        }

        // Gravel patches on ocean floor
        if (biomeId === Biome.Ocean && depth < 2 && gravelVal > 0.3) {
          block = Block.Gravel;
        }

        // Ice on water at water level in cold biomes — handled in a later water-surface pass.

        data[voxIdx] = block;
        depth++;
      }
    }
  }

  // ── 4. Patch up: structures, vegetation ──
  // (Filled in by Task 8.)

  // ── Ores — re-pass over Stone/DeepStone voxels ────────────────────
  const oreNoise = createNoise(seed + 2);
  const { ores } = config.params;
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = wyOff + ly;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const voxIdx = chunkIndex(lx, ly, lz);
        const b = data[voxIdx];
        if (b !== Block.Stone && b !== Block.DeepStone) continue;
        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const colIdx = lz * CHUNK_SIZE + lx;
        const surfaceH = heights[colIdx];
        if (surfaceH === -Infinity) continue;
        const depth = surfaceH - wy;
        const oreVal = oreNoise.fbm3D(wx / ores.scale, wy / ores.scale, wz / ores.scale, 2, 0.5, 2.0);
        if (oreVal > ores.ironThreshold && depth > ores.ironMinDepth) {
          data[voxIdx] = Block.Iron;
        } else if (oreVal > ores.coalThreshold && depth > 8) {
          data[voxIdx] = Block.Coal;
        }
      }
    }
  }

  // ── Ice on water surface in cold biomes ───────────────────────────
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wy = waterLevel;
      if (wy < wyOff || wy >= wyOff + CHUNK_SIZE) continue;
      const ly = wy - wyOff;
      const voxIdx = chunkIndex(lx, ly, lz);
      if (data[voxIdx] !== Block.Water) continue;
      const biomeId = biomes[lz * CHUNK_SIZE + lx];
      if (biomeId === Biome.Tundra || biomeId === Biome.Taiga || biomeId === Biome.FrozenOcean) {
        data[voxIdx] = Block.Ice;
      }
    }
  }

  // ── Aquifers ──────────────────────────────────────────────────────
  const { aquifers } = config.params;
  if (aquifers.enabled) {
    const aquiferPresenceNoise = createNoise(seed + 13);
    const aquiferLevelNoise    = createNoise(seed + 14);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = wzOff + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = wxOff + lx;
        const colIdx = lz * CHUNK_SIZE + lx;
        if (heights[colIdx] !== -Infinity && heights[colIdx] <= waterLevel) continue;
        const rawLevel = waterLevel + aquifers.levelOffset
          + aquiferLevelNoise.fbm2D(
              wx / aquifers.levelScale,
              wz / aquifers.levelScale,
              2, 0.5, 2.0,
            ) * aquifers.levelAmplitude;
        const localSurface = Math.floor(rawLevel);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const wy = wyOff + ly;
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

  // Surface block under water → sub-surface (grass → dirt under ponds)
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

  // ── Lava (deep chunks only) ───────────────────────────────────────
  if (chunkY <= -1) {
    const lavaNoise = createNoise(seed + 4);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
          const wx = wxOff + lx;
          const wz = wzOff + lz;
          const n = lavaNoise.perlin2D(wx / 20, wz / 20);
          if (n > 0.7) data[chunkIndex(lx, ly, lz)] = Block.Lava;
        }
      }
    }
  }

  // ── Glowstone on cave ceilings ────────────────────────────────────
  const glowstoneNoise = createNoise(seed + 8);
  for (let ly = 0; ly < CHUNK_SIZE - 1; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (data[chunkIndex(lx, ly, lz)] !== Block.Air) continue;
        const above = data[chunkIndex(lx, ly + 1, lz)];
        const aboveDef = BLOCK_DEFS[above];
        if (!aboveDef || aboveDef.transparent) continue;
        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const n = glowstoneNoise.perlin2D(wx / 15, wz / 15);
        if (n > 0.65) data[chunkIndex(lx, ly, lz)] = Block.Glowstone;
      }
    }
  }

  // ── Bedrock floor ─────────────────────────────────────────────────
  const BEDROCK_BOTTOM = config.params.extent.minHeight;
  const BEDROCK_FUZZY_HEIGHT = 2;
  if (wyOff <= BEDROCK_BOTTOM + BEDROCK_FUZZY_HEIGHT && wyOff + CHUNK_SIZE > BEDROCK_BOTTOM) {
    const bedrockNoise = createNoise(seed + 15);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const wy = wyOff + ly;
      if (wy < BEDROCK_BOTTOM || wy > BEDROCK_BOTTOM + BEDROCK_FUZZY_HEIGHT) continue;
      const rowAbove = wy - BEDROCK_BOTTOM;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (rowAbove === 0) {
            data[chunkIndex(lx, ly, lz)] = Block.Bedrock;
          } else {
            const wx = wxOff + lx;
            const wz = wzOff + lz;
            const n = bedrockNoise.perlin2D((wx + rowAbove * 13) / 3, (wz + rowAbove * 17) / 3);
            const threshold = -0.66 + rowAbove * 0.5;
            if (n > threshold) data[chunkIndex(lx, ly, lz)] = Block.Bedrock;
          }
        }
      }
    }
  }

  const treeMask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  // ── Structure placement (single chunk-center attempt) ──────────────
  const structNoise = createNoise(seed + 6);
  const structVal = structNoise.perlin2D(chunkX * 1.17, chunkZ * 1.17);
  const centerLx = Math.floor(CHUNK_SIZE / 2);
  const centerLz = Math.floor(CHUNK_SIZE / 2);
  const centerColIdx = centerLz * CHUNK_SIZE + centerLx;
  const centerBiome = biomes[centerColIdx];
  const centerSurfaceH = heights[centerColIdx];
  if (centerSurfaceH !== -Infinity) {
    const centerSurfLocal = Math.floor(centerSurfaceH) - wyOff;
    if (centerSurfLocal >= 4 && centerSurfLocal < CHUNK_SIZE - 8 && centerSurfaceH > waterLevel) {
      if (centerBiome === Biome.Desert && structVal > 0.7) {
        placePyramid(data, centerLx, centerSurfLocal, centerLz);
      } else if (centerBiome === Biome.Tundra && structVal > 0.55) {
        placeIgloo(data, centerLx, centerSurfLocal, centerLz);
      } else if ((centerBiome === Biome.Plains || centerBiome === Biome.Savanna) && structVal > 0.6) {
        placeHouse(data, centerLx, centerSurfLocal, centerLz);
        if (structVal > 0.4 && centerLx + 10 < CHUNK_SIZE - 1 && centerLz + 8 < CHUNK_SIZE - 1) {
          placeHouse(data, centerLx + 8, centerSurfLocal, centerLz + 6);
        }
      }
    }
  }

  // ── Tree placement (soft-surface y for both in-chunk and halo) ─────
  const MAX_TREE_REACH = 10;
  const CANOPY_HALO = 2;
  const POISSON_RADIUS = 1;
  const NOISE_HALO = CANOPY_HALO + POISSON_RADIUS;
  const NOISE_SIDE = CHUNK_SIZE + 2 * NOISE_HALO;
  const treeNoise = createNoise(seed + 3);
  const candidate = new Uint8Array(NOISE_SIDE * NOISE_SIDE);
  const userVeg = config.params.vegetation.treeDensity;
  const GLOBAL_TREE_DENSITY = 0.40;

  for (let lz = -NOISE_HALO; lz < CHUNK_SIZE + NOISE_HALO; lz++) {
    for (let lx = -NOISE_HALO; lx < CHUNK_SIZE + NOISE_HALO; lx++) {
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const v = treeNoise.perlin2D(wx / 2.5, wz / 2.5);
      if ((v + 1) * 0.5 < GLOBAL_TREE_DENSITY) {
        candidate[(lz + NOISE_HALO) * NOISE_SIDE + (lx + NOISE_HALO)] = 1;
      }
    }
  }

  function priorityHash(wx: number, wz: number): number {
    let h = (Math.imul(wx | 0, 374761393) ^ Math.imul(wz | 0, 668265263) ^ Math.imul(seed | 0, 2654435761)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function unitHash(wx: number, wz: number): number {
    let h = (Math.imul(wx | 0, 73856093) ^ Math.imul(wz | 0, 19349663) ^ Math.imul(seed | 0, 83492791)) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }

  function isSelected(lx: number, lz: number): boolean {
    const cIdx = (lz + NOISE_HALO) * NOISE_SIDE + (lx + NOISE_HALO);
    if (!candidate[cIdx]) return false;
    const wx = wxOff + lx;
    const wz = wzOff + lz;
    const p = priorityHash(wx, wz);
    for (let dz = -POISSON_RADIUS; dz <= POISSON_RADIUS; dz++) {
      for (let dx = -POISSON_RADIUS; dx <= POISSON_RADIUS; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nIdx = (lz + dz + NOISE_HALO) * NOISE_SIDE + (lx + dx + NOISE_HALO);
        if (!candidate[nIdx]) continue;
        const np = priorityHash(wx + dx, wz + dz);
        if (np >= p) return false;
      }
    }
    return true;
  }

  for (let lz = -CANOPY_HALO; lz < CHUNK_SIZE + CANOPY_HALO; lz++) {
    for (let lx = -CANOPY_HALO; lx < CHUNK_SIZE + CANOPY_HALO; lx++) {
      if (!isSelected(lx, lz)) continue;
      const wx = wxOff + lx;
      const wz = wzOff + lz;
      const inChunk = (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE);

      // Soft-surface lookup for both in-chunk and halo (design §4).
      const softY = offsetFactor.offsetAt(wx, wz);
      const surfaceH = softY;

      let biomeId: number;
      if (inChunk) {
        biomeId = biomes[lz * CHUNK_SIZE + lx];
      } else {
        const sample = offsetFactor.sampleClimate(wx, wz);
        const { temp, humid } = tempHumidSampler(wx, wz);
        biomeId = classifyBiome(
          sample.continentalness, sample.erosion, sample.peaksValleys,
          temp, humid, config.params.biomePicker,
        );
      }
      const biomeDef = BIOME_DEFS[biomeId];

      if (surfaceH <= waterLevel) continue;
      if (biomeId === Biome.Mountains && surfaceH > 30) continue;
      const surfaceLocal = Math.floor(surfaceH) - wyOff;

      if (biomeDef.cactus) {
        if (!inChunk) continue;
        const accept = Math.min(1, (0.04 * userVeg) / GLOBAL_TREE_DENSITY);
        if (unitHash(wx, wz) >= accept) continue;
        if (surfaceLocal < 0 || surfaceLocal >= CHUNK_SIZE - 1) continue;
        const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
        if (surfBlock !== biomeDef.surfaceBlock) continue;
        placeCactus(data, lx, surfaceLocal, lz, wx, wz);
        treeMask[lz * CHUNK_SIZE + lx] = 1;
        continue;
      }

      if (biomeDef.treeWood === null || biomeDef.treeLeaves === null) continue;

      const accept = Math.min(1, (biomeDef.treeDensity * userVeg) / GLOBAL_TREE_DENSITY);
      if (unitHash(wx, wz) >= accept) continue;

      if (surfaceLocal >= CHUNK_SIZE) continue;
      if (surfaceLocal + MAX_TREE_REACH < 0) continue;

      if (inChunk && surfaceLocal >= 0 && surfaceLocal < CHUNK_SIZE) {
        const surfIdx = chunkIndex(lx, surfaceLocal, lz);
        const sb = data[surfIdx];
        if (sb === Block.Air) {
          data[surfIdx] = biomeDef.surfaceBlock === Block.Snow ? Block.Snow : biomeDef.subSurfaceBlock;
        } else if (sb === biomeDef.surfaceBlock && sb !== Block.Snow) {
          data[surfIdx] = biomeDef.subSurfaceBlock;
        }
      }

      const wood = biomeDef.treeWood;
      const leaves = biomeDef.treeLeaves;
      if (wood === Block.SpruceWood) {
        placeSpruceTree(data, lx, surfaceLocal, lz, wood, leaves, wx, wz);
      } else if (wood === Block.BirchWood) {
        placeBirchTree(data, lx, surfaceLocal, lz, wood, leaves, wx, wz);
      } else {
        placeOakTree(data, lx, surfaceLocal, lz, wood, leaves, wx, wz);
      }

      if (inChunk) treeMask[lz * CHUNK_SIZE + lx] = 1;
    }
  }

  // ── Surface decorations (flowers / tall grass / etc.) ──────────────
  if (config.params.vegetation.enabled) {
    const decoNoise = createNoise(seed + 16);
    const globalDensity = config.params.vegetation.globalDensity;
    for (let lz = 1; lz < CHUNK_SIZE - 1; lz++) {
      for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
        const colIdx = lz * CHUNK_SIZE + lx;
        const biomeDef = BIOME_DEFS[biomes[colIdx]];
        if (biomeDef.decorations.length === 0) continue;
        if (heights[colIdx] === -Infinity || heights[colIdx] <= waterLevel) continue;
        if (treeMask[colIdx]) continue;

        const surfaceLocal = Math.floor(heights[colIdx]) - wyOff;
        if (surfaceLocal < 0 || surfaceLocal >= CHUNK_SIZE - 1) continue;
        const surfBlock = data[chunkIndex(lx, surfaceLocal, lz)];
        if (surfBlock !== biomeDef.surfaceBlock) continue;
        const aboveIdx = chunkIndex(lx, surfaceLocal + 1, lz);
        if (data[aboveIdx] !== Block.Air) continue;

        const wx = wxOff + lx;
        const wz = wzOff + lz;
        const decoVal = (decoNoise.perlin2D(wx / 1.7, wz / 1.7) + 1) * 0.5;
        const threshold = biomeDef.decorationDensity * globalDensity;
        if (decoVal >= threshold) continue;

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

  const { grassColors } = computeBlendedGrassColors(
    wxOff, wzOff, CHUNK_SIZE,
    tempHumidSampler,
    (lx, lz) => biomes[lz * CHUNK_SIZE + lx] as BiomeId,
  );

  return { data, grassColors, heightMap: heights };
}
