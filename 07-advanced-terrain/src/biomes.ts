import { Block } from "./blocks";
import { createNoise } from "./perlin";
import { type BiomeParams, DEFAULT_PARAMS } from "./generationParams";

/**
 * Grass color gradient — maps (temperature, humidity) to a packed 0xRRGGBB color.
 *
 * Uses bilinear interpolation across four corner colors:
 *   Hot+Dry  → sandy yellow-brown
 *   Hot+Wet  → bright warm green
 *   Cold+Dry → muted grey-green
 *   Cold+Wet → dark teal/turquoise green
 *
 * Temperature and humidity noise values range roughly from -0.5 to 0.5.
 * They are normalized to 0..1 for interpolation.
 */

// Corner colors as [R, G, B] in 0..255
const GRASS_HOT_DRY:  [number, number, number] = [160, 135,  75]; // sandy yellow-brown
const GRASS_HOT_WET:  [number, number, number] = [100, 180,  50]; // bright warm green
const GRASS_COLD_DRY: [number, number, number] = [120, 140, 110]; // muted grey-green
const GRASS_COLD_WET: [number, number, number] = [ 50, 140, 120]; // dark teal/turquoise

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map climate values to a packed 0xRRGGBB grass color.
 * @param temp  Temperature noise value (roughly -0.5 to 0.5)
 * @param humid Humidity noise value (roughly -0.5 to 0.5)
 */
export function grassColorFromClimate(temp: number, humid: number): number {
  const t = clamp01(temp + 0.5);   // 0 = cold, 1 = hot
  const h = clamp01(humid + 0.5);  // 0 = dry,  1 = wet

  const r = Math.round(lerp(
    lerp(GRASS_COLD_DRY[0], GRASS_COLD_WET[0], h),
    lerp(GRASS_HOT_DRY[0],  GRASS_HOT_WET[0],  h),
    t,
  ));
  const g = Math.round(lerp(
    lerp(GRASS_COLD_DRY[1], GRASS_COLD_WET[1], h),
    lerp(GRASS_HOT_DRY[1],  GRASS_HOT_WET[1],  h),
    t,
  ));
  const b = Math.round(lerp(
    lerp(GRASS_COLD_DRY[2], GRASS_COLD_WET[2], h),
    lerp(GRASS_HOT_DRY[2],  GRASS_HOT_WET[2],  h),
    t,
  ));

  return (r << 16) | (g << 8) | b;
}

/**
 * Biome system — the key new concept in this project.
 *
 * Real terrain isn't uniform: deserts, forests, tundra, and mountains
 * each have distinct block palettes, vegetation, and terrain shape.
 * Minecraft achieves this by sampling two independent noise fields
 * — temperature and humidity — and using them as coordinates in a
 * biome lookup table.
 *
 * How it works:
 * 1. Sample temperature noise at (x, z). Hot → desert, cold → tundra.
 * 2. Sample humidity noise at (x, z). Dry → desert/plains, wet → forest/swamp.
 * 3. The (temperature, humidity) pair maps to a biome via thresholds.
 * 4. Each biome defines its surface block, sub-surface, terrain amplitude,
 *    and which tree types (if any) can spawn.
 *
 * The noise fields use a very large scale (~300) so biomes span
 * hundreds of blocks — you walk through gradual transitions.
 */

export interface BiomeDef {
  name: string;
  surfaceBlock: number;
  subSurfaceBlock: number;
  /** Multiplier for terrain height amplitude (0.3 = flat, 2.0 = mountainous) */
  heightScale: number;
  /** Offset added to base height */
  heightOffset: number;
  /** Tree type to place, or null for no trees */
  treeWood: number | null;
  treeLeaves: number | null;
  /** Chance of tree per eligible column (0-1) */
  treeDensity: number;
  /** Special feature: cactus placement */
  cactus: boolean;
}

export const Biome = {
  Ocean:     0,
  Beach:     1,
  Desert:    2,
  Savanna:   3,
  Plains:    4,
  Forest:    5,
  BirchForest: 6,
  Taiga:     7,
  Tundra:    8,
  Mountains: 9,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_DEFS: Record<number, BiomeDef> = {
  [Biome.Ocean]: {
    name: "Ocean",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.Sand,
    heightScale: 0.3,
    heightOffset: -8,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
  },
  [Biome.Beach]: {
    name: "Beach",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.Sand,
    heightScale: 0.2,
    heightOffset: -2,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
  },
  [Biome.Desert]: {
    name: "Desert",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.RedSand,
    heightScale: 0.5,
    heightOffset: 0,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: true,
  },
  [Biome.Savanna]: {
    name: "Savanna",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.6,
    heightOffset: 0,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.02, cactus: false,
  },
  [Biome.Plains]: {
    name: "Plains",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.5,
    heightOffset: 0,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.03, cactus: false,
  },
  [Biome.Forest]: {
    name: "Forest",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.7,
    heightOffset: 2,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.15, cactus: false,
  },
  [Biome.BirchForest]: {
    name: "Birch Forest",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.6,
    heightOffset: 1,
    treeWood: Block.BirchWood, treeLeaves: Block.BirchLeaves, treeDensity: 0.12, cactus: false,
  },
  [Biome.Taiga]: {
    name: "Taiga",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.8,
    heightOffset: 3,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.18, cactus: false,
  },
  [Biome.Tundra]: {
    name: "Tundra",
    surfaceBlock: Block.Snow,
    subSurfaceBlock: Block.Dirt,
    heightScale: 0.4,
    heightOffset: 0,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.02, cactus: false,
  },
  [Biome.Mountains]: {
    name: "Mountains",
    surfaceBlock: Block.Stone,
    subSurfaceBlock: Block.Stone,
    heightScale: 2.0,
    heightOffset: 10,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.04, cactus: false,
  },
};

/**
 * Pre-computed grass color for each biome, based on a representative
 * (temperature, humidity) midpoint derived from the biome threshold grid.
 *
 * Biomes that don't use Grass as surfaceBlock still have a color here
 * so the blending math in computeBlendedBiomeParams works uniformly.
 */
export const BIOME_GRASS_COLORS: Record<number, number> = {
  [Biome.Ocean]:       grassColorFromClimate( 0.0,  0.0),
  [Biome.Beach]:       grassColorFromClimate( 0.0,  0.0),
  [Biome.Desert]:      grassColorFromClimate( 0.35, -0.2),   // hot, dry
  [Biome.Savanna]:     grassColorFromClimate( 0.35,  0.3),   // hot, humid
  [Biome.Plains]:      grassColorFromClimate( 0.0,  -0.3),   // mild, dry-ish
  [Biome.Forest]:      grassColorFromClimate( 0.0,   0.35),  // mild, humid
  [Biome.BirchForest]: grassColorFromClimate( 0.0,   0.05),  // mild, moderate
  [Biome.Taiga]:       grassColorFromClimate(-0.3,   0.2),   // cold, humid
  [Biome.Tundra]:      grassColorFromClimate(-0.3,  -0.15),  // cold, dry
  [Biome.Mountains]:   grassColorFromClimate(-0.1,   0.0),   // cool, neutral
};

/**
 * Create a biome sampler for a given seed.
 *
 * Returns a function that maps world (x, z) to a biome ID.
 * Temperature and humidity are sampled at large scale (300 blocks)
 * and mapped to biomes via a simple threshold grid.
 */
export function createBiomeSampler(seed: number, biomeParams: BiomeParams = DEFAULT_PARAMS.biomes) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  function sampleNoise(wx: number, wz: number) {
    // Voronoi F2-F1 at large scale produces organic continent edges.
    // F2-F1 → 0 at cell boundaries (coastlines), large in cell interiors.
    const v = continentNoise.voronoi2D(wx / biomeParams.continentScale, wz / biomeParams.continentScale);
    const edgeDist = v.f2 - v.f1; // 0 at boundary, ~0.5+ in interior

    // Map to continent value: interior → land (positive), edge → coast/ocean (negative)
    // fBm perturbation breaks up straight Voronoi edges
    const perturbation = continentNoise.fbm2D(wx / 200, wz / 200, 3, 0.5, 2.0) * 0.15;
    const continent = (edgeDist - 0.25) * 2.0 + perturbation;
    const temp = tempNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);
    const humid = humidNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);
    return { continent, temp, humid };
  }

  function biomeFromNoise(continent: number, temp: number, humid: number): BiomeId {
    if (continent < biomeParams.oceanThreshold) return Biome.Ocean;
    if (continent < biomeParams.beachThreshold) return Biome.Beach;
    if (continent > biomeParams.mountainThreshold) return Biome.Mountains;

    if (temp > 0.2) {
      return humid > 0.15 ? Biome.Savanna : Biome.Desert;
    } else if (temp > -0.15) {
      if (humid > 0.2) return Biome.Forest;
      if (humid > -0.1) return Biome.BirchForest;
      return Biome.Plains;
    } else {
      return humid > 0.05 ? Biome.Taiga : Biome.Tundra;
    }
  }

  return function getBiome(wx: number, wz: number): BiomeId {
    const { continent, temp, humid } = sampleNoise(wx, wz);
    return biomeFromNoise(continent, temp, humid);
  };
}

/**
 * Biome blending — the key addition in project 06.
 *
 * Without blending, adjacent columns in different biomes can have
 * wildly different heights (e.g. Mountains heightScale=2.0 next to
 * Plains heightScale=0.5), creating vertical cliff walls.
 *
 * The fix: for each column, sample biomes in a small radius and
 * average their heightScale and heightOffset. This produces smooth
 * gradients at biome boundaries while preserving local noise detail.
 *
 * Only height parameters are blended — surface block selection stays
 * discrete (uses the dominant biome in the kernel) so you get smooth
 * slopes with clean block transitions.
 */
export const BLEND_RADIUS = 4;

const BIOME_COUNT = Object.keys(Biome).length;

export function computeBlendedBiomeParams(
  worldXOff: number,
  worldZOff: number,
  chunkSize: number,
  getBiome: (wx: number, wz: number) => BiomeId,
): {
  blendedScales: Float64Array;
  blendedOffsets: Float64Array;
  dominantBiomes: Uint8Array;
  grassColors: Uint32Array;
} {
  const padSize = chunkSize + 2 * BLEND_RADIUS;
  const paddedBiomes = new Uint8Array(padSize * padSize);

  // Fill padded grid with biome IDs
  for (let pz = 0; pz < padSize; pz++) {
    for (let px = 0; px < padSize; px++) {
      paddedBiomes[pz * padSize + px] = getBiome(
        worldXOff - BLEND_RADIUS + px,
        worldZOff - BLEND_RADIUS + pz,
      );
    }
  }

  const kernelSize = 2 * BLEND_RADIUS + 1;
  const kernelArea = kernelSize * kernelSize;
  const blendedScales = new Float64Array(chunkSize * chunkSize);
  const blendedOffsets = new Float64Array(chunkSize * chunkSize);
  const dominantBiomes = new Uint8Array(chunkSize * chunkSize);
  const grassColors = new Uint32Array(chunkSize * chunkSize);
  const biomeCounts = new Uint8Array(BIOME_COUNT);

  for (let lz = 0; lz < chunkSize; lz++) {
    for (let lx = 0; lx < chunkSize; lx++) {
      let totalScale = 0;
      let totalOffset = 0;
      let totalR = 0, totalG = 0, totalB = 0;
      biomeCounts.fill(0);

      for (let kz = 0; kz < kernelSize; kz++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const biome = paddedBiomes[(lz + kz) * padSize + (lx + kx)];
          const def = BIOME_DEFS[biome];
          totalScale += def.heightScale;
          totalOffset += def.heightOffset;
          biomeCounts[biome]++;
          const gc = BIOME_GRASS_COLORS[biome];
          totalR += (gc >> 16) & 0xFF;
          totalG += (gc >>  8) & 0xFF;
          totalB +=  gc        & 0xFF;
        }
      }

      const idx = lz * chunkSize + lx;
      blendedScales[idx] = totalScale / kernelArea;
      blendedOffsets[idx] = totalOffset / kernelArea;

      // Blended grass color — weighted average across kernel
      const avgR = Math.round(totalR / kernelArea);
      const avgG = Math.round(totalG / kernelArea);
      const avgB = Math.round(totalB / kernelArea);
      grassColors[idx] = (avgR << 16) | (avgG << 8) | avgB;

      // Dominant biome = most frequent in kernel
      let maxCount = 0;
      let dominant = 0;
      for (let b = 0; b < BIOME_COUNT; b++) {
        if (biomeCounts[b] > maxCount) {
          maxCount = biomeCounts[b];
          dominant = b;
        }
      }
      dominantBiomes[idx] = dominant;
    }
  }

  return { blendedScales, blendedOffsets, dominantBiomes, grassColors };
}

export interface BiomeDebugInfo {
  biome: BiomeId;
  temperature: number;
  humidity: number;
  continent: number;
}

/**
 * Create a debug sampler that returns raw noise values alongside the biome.
 * Used by the debug overlay — not called during chunk generation.
 */
export function createBiomeDebugSampler(seed: number, biomeParams: BiomeParams = DEFAULT_PARAMS.biomes) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  return function getBiomeDebug(wx: number, wz: number): BiomeDebugInfo {
    const v = continentNoise.voronoi2D(wx / biomeParams.continentScale, wz / biomeParams.continentScale);
    const edgeDist = v.f2 - v.f1;
    const perturbation = continentNoise.fbm2D(wx / 200, wz / 200, 3, 0.5, 2.0) * 0.15;
    const continent = (edgeDist - 0.25) * 2.0 + perturbation;
    const temperature = tempNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);
    const humidity = humidNoise.fbm2D(wx / biomeParams.tempHumidityScale, wz / biomeParams.tempHumidityScale, 4, 0.5, 2.0);

    let biome: BiomeId;
    if (continent < biomeParams.oceanThreshold) biome = Biome.Ocean;
    else if (continent < biomeParams.beachThreshold) biome = Biome.Beach;
    else if (continent > biomeParams.mountainThreshold) biome = Biome.Mountains;
    else if (temperature > 0.2) biome = humidity > 0.15 ? Biome.Savanna : Biome.Desert;
    else if (temperature > -0.15) {
      if (humidity > 0.2) biome = Biome.Forest;
      else if (humidity > -0.1) biome = Biome.BirchForest;
      else biome = Biome.Plains;
    } else {
      biome = humidity > 0.05 ? Biome.Taiga : Biome.Tundra;
    }

    return { biome, temperature, humidity, continent };
  };
}
