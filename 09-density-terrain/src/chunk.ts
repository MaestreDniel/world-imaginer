import { Block, BLOCK_DEFS } from "./blocks";
import { createNoise } from "./perlin";
import {
  createBiomeSampler, BIOME_DEFS, Biome, classifyBiome, computeBlendedGrassColors,
  type BiomeId,
  CAVE_BIOME_DEFS, type CaveBiomeId, CAVE_REGISTRY,
} from "./biomes";
import { pickBiome, type ClimatePoint } from "./biomeBoxes";
import { createTerrainShaper } from "./terrainShape";
import { placeOakTree, placeSpruceTree, placeBirchTree, placeCactus, placePyramid, placeIgloo, placeHouse } from "./structures";
import { erode } from "./erosion";
import { type GenerationParams, DEFAULT_PARAMS, toErosionConfig } from "./generationParams";
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
  if (config.params.useDensityPipeline) {
    return generateChunkDensity(chunkX, chunkY, chunkZ, config);
  }
  return generateChunkLegacy(chunkX, chunkY, chunkZ, config);
}

function generateChunkLegacy(
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

  const colTemp     = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colHumid    = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colContinent= new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colErosion  = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const colPV       = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);

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
  //
  // Pad equals maxLifetime: the smallest halo such that every droplet
  // whose trajectory could reach this chunk's interior is fully simulated
  // here. Combined with world-deterministic droplet spawning in erode(),
  // this means neighbouring chunks share the droplets that affect their
  // common seam, eliminating the chunk-grid artifact when erosion is on.
  if (config.params.erosion.enabled) {
    const ERODE_PAD = config.params.erosion.maxLifetime;
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

    // Run erosion. Droplets are spawned per *world* cell, so the same world
    // location gets the same droplet trajectory regardless of which chunk's
    // pad covers it — neighbouring pads' overlap region produces identical
    // contributions on both sides of the seam.
    erode(
      paddedMap, padSize,
      worldXOff - ERODE_PAD, worldZOff - ERODE_PAD,
      toErosionConfig(config.params.erosion),
      seed,
    );

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
          if (biome === Biome.Tundra || biome === Biome.Taiga || biome === Biome.FrozenOcean) {
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
            if (carve) {
              block = Block.Air;
              // Paint cave-biome floor: when this newly-air cell sits
              // directly above a solid cell within the same chunk, classify
              // the cave biome and overwrite that solid cell with the
              // biome's floorBlock. (Cross-chunk floors at ly=0 are skipped
              // — minor cosmetic seam, acceptable for this spec.)
              if (ly > 0) {
                const belowIdx = chunkIndex(lx, ly - 1, lz);
                const below = data[belowIdx];
                if (below !== Block.Air && below !== Block.Water) {
                  const point: ClimatePoint = {
                    temperature:  colTemp[colIdx],
                    humidity:     colHumid[colIdx],
                    continent:    colContinent[colIdx],
                    erosion:      colErosion[colIdx],
                    peaksValleys: colPV[colIdx],
                    depthBlocks:  surfaceH - wy,
                  };
                  const caveId: CaveBiomeId = pickBiome(point, CAVE_REGISTRY, config.params.biomePicker);
                  data[belowIdx] = CAVE_BIOME_DEFS[caveId].floorBlock;
                }
              }
            }
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
  // Poisson-disk slot selection in world space:
  //   1. Build a candidate map (chunk + halo) of cells whose tree noise passes
  //      a generous global threshold.
  //   2. A candidate "wins" iff its priority hash beats every candidate
  //      neighbour in the 3×3 footprint. Decisions are deterministic per
  //      (wx, wz, seed), independent of chunk boundaries — no chunk-grid
  //      dead strips.
  //   3. Trunks at chunk-border halo positions are evaluated and painted from
  //      this chunk too, so canopies that cross an X/Z boundary render
  //      seamlessly. makeSetter clips writes outside [0, CHUNK_SIZE).
  const MAX_TREE_REACH = 10;
  const CANOPY_HALO = 2;       // max canopy radius for any tree species
  const POISSON_RADIUS = 1;    // 3×3 spacing footprint
  const NOISE_HALO = CANOPY_HALO + POISSON_RADIUS; // 3 — covers neighbour lookups for halo trunks
  const NOISE_SIDE = CHUNK_SIZE + 2 * NOISE_HALO;
  const candidate = new Uint8Array(NOISE_SIDE * NOISE_SIDE);

  // Generous candidate pool sized for the densest biome (forest ≈ 0.35).
  // Per-biome thinning below restores original density ratios.
  const userVeg = config.params.vegetation.treeDensity;
  const GLOBAL_TREE_DENSITY = 0.40;

  for (let lz = -NOISE_HALO; lz < CHUNK_SIZE + NOISE_HALO; lz++) {
    for (let lx = -NOISE_HALO; lx < CHUNK_SIZE + NOISE_HALO; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
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

  // Decoupled hash for biome-acceptance roll → [0, 1).
  function unitHash(wx: number, wz: number): number {
    let h = (Math.imul(wx | 0, 73856093) ^ Math.imul(wz | 0, 19349663) ^ Math.imul(seed | 0, 83492791)) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }

  function isSelected(lx: number, lz: number): boolean {
    const cIdx = (lz + NOISE_HALO) * NOISE_SIDE + (lx + NOISE_HALO);
    if (!candidate[cIdx]) return false;
    const wx = worldXOff + lx;
    const wz = worldZOff + lz;
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

  const treeMask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = -CANOPY_HALO; lz < CHUNK_SIZE + CANOPY_HALO; lz++) {
    for (let lx = -CANOPY_HALO; lx < CHUNK_SIZE + CANOPY_HALO; lx++) {
      if (!isSelected(lx, lz)) continue;

      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const inChunk = (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE);

      let biomeId: number;
      let surfaceH: number;
      if (inChunk) {
        const colIdx = lz * CHUNK_SIZE + lx;
        biomeId = biomes[colIdx];
        surfaceH = heights[colIdx];
      } else {
        // Mirror the in-chunk pipeline exactly: classify biome using un-carved
        // height (matches lines 87-94), then apply river carving for surfaceH
        // (matches lines 110-128). Erosion is per-chunk and intentionally skipped.
        const sample = terrainShaper.sampleClimate(wx, wz);
        const baseH = terrainShaper.heightFromClimate(sample);
        const { temp, humid } = tempHumidSampler(wx, wz);
        biomeId = classifyBiome(
          sample.continentalness, sample.erosion, sample.peaksValleys,
          temp, humid, config.params.biomePicker,
        );
        surfaceH = baseH;
        const v = riverNoise.voronoi2D(wx / rivers.voronoiScale, wz / rivers.voronoiScale);
        const edgeDist = v.f2 - v.f1;
        if (edgeDist < rivers.edgeThreshold && surfaceH > waterLevel - 2) {
          const carveStrength = (1 - edgeDist / rivers.edgeThreshold);
          const maxCarve = rivers.maxCarveDepth * carveStrength * carveStrength;
          surfaceH = Math.max(waterLevel - 2, surfaceH - maxCarve);
        }
      }
      const biomeDef = BIOME_DEFS[biomeId];

      if (surfaceH <= waterLevel) continue;
      // Deterministic rejection of mountain peaks where the surface becomes snow
      // (matches the snow-cap rule in the voxel-fill pass). Both in-chunk and
      // halo paths must agree on rejection so cross-chunk canopies are seamless.
      if (biomeId === Biome.Mountains && surfaceH > 30) continue;
      const surfaceLocal = Math.floor(surfaceH) - worldYOff;

      // Cactus path — 1×1, no canopy spillover, only handled when in this chunk.
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

      if (surfaceLocal >= CHUNK_SIZE) continue;          // canopy entirely above us
      if (surfaceLocal + MAX_TREE_REACH < 0) continue;   // canopy ends below us

      // Minecraft-style anchor: convert grass under the trunk to dirt, and
      // patch cave holes at the surface so trunks never float over voids.
      // Snow-surface biomes (Tundra) keep snow under the trunk and patch
      // voids with snow rather than incongruous dirt.
      // Only the chunk owning the trunk performs this; halo neighbours don't.
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

function generateChunkDensity(
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
      columnFields[idx] = offsetFactor.fieldsFromClimate(sample);
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

  // ── 2. Coarse density grid + trilerp → solid mask ─────────────────
  const solid = fillChunkDensity(chunkX, chunkY, chunkZ, offsetFactor, density, columnFields);

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

  const { grassColors } = computeBlendedGrassColors(
    wxOff, wzOff, CHUNK_SIZE,
    tempHumidSampler,
    (lx, lz) => biomes[lz * CHUNK_SIZE + lx] as BiomeId,
  );

  return { data, grassColors, heightMap: heights };
}
