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

export interface DecorationChoice {
  block: number;
  weight: number;
}

export interface BiomeDef {
  name: string;
  surfaceBlock: number;
  subSurfaceBlock: number;
  /** Tree type to place, or null for no trees */
  treeWood: number | null;
  treeLeaves: number | null;
  /** Chance of tree per eligible column (0-1) */
  treeDensity: number;
  /** Special feature: cactus placement */
  cactus: boolean;
  /** Probability cap for surface decorations (0-1, multiplied by global slider). */
  decorationDensity: number;
  /** Weighted decoration choices. Empty = no decorations for this biome. */
  decorations: ReadonlyArray<DecorationChoice>;
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
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
    decorationDensity: 0, decorations: [],
  },
  [Biome.Beach]: {
    name: "Beach",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.Sand,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: false,
    decorationDensity: 0, decorations: [],
  },
  [Biome.Desert]: {
    name: "Desert",
    surfaceBlock: Block.Sand,
    subSurfaceBlock: Block.RedSand,
    treeWood: null, treeLeaves: null, treeDensity: 0, cactus: true,
    decorationDensity: 0.04,
    decorations: [{ block: Block.DeadBush, weight: 1.0 }],
  },
  [Biome.Savanna]: {
    name: "Savanna",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.10, cactus: false,
    decorationDensity: 0.18,
    decorations: [
      { block: Block.Bush,         weight: 0.4 },
      { block: Block.TallGrass,    weight: 0.5 },
      { block: Block.FlowerYellow, weight: 0.1 },
    ],
  },
  [Biome.Plains]: {
    name: "Plains",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.15, cactus: false,
    decorationDensity: 0.22,
    decorations: [
      { block: Block.TallGrass,    weight: 0.50 },
      { block: Block.FlowerRed,    weight: 0.15 },
      { block: Block.FlowerYellow, weight: 0.20 },
      { block: Block.FlowerBlue,   weight: 0.15 },
    ],
  },
  [Biome.Forest]: {
    name: "Forest",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.OakWood, treeLeaves: Block.OakLeaves, treeDensity: 0.35, cactus: false,
    decorationDensity: 0.20,
    decorations: [
      { block: Block.TallGrass, weight: 0.4 },
      { block: Block.Fern,      weight: 0.2 },
      { block: Block.Bush,      weight: 0.3 },
      { block: Block.FlowerRed, weight: 0.1 },
    ],
  },
  [Biome.BirchForest]: {
    name: "Birch Forest",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.BirchWood, treeLeaves: Block.BirchLeaves, treeDensity: 0.25, cactus: false,
    decorationDensity: 0.20,
    decorations: [
      { block: Block.TallGrass,    weight: 0.40 },
      { block: Block.Fern,         weight: 0.30 },
      { block: Block.FlowerYellow, weight: 0.15 },
      { block: Block.FlowerBlue,   weight: 0.15 },
    ],
  },
  [Biome.Taiga]: {
    name: "Taiga",
    surfaceBlock: Block.Grass,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.30, cactus: false,
    decorationDensity: 0.22,
    decorations: [
      { block: Block.Fern,      weight: 0.6 },
      { block: Block.TallGrass, weight: 0.3 },
      { block: Block.Bush,      weight: 0.1 },
    ],
  },
  [Biome.Tundra]: {
    name: "Tundra",
    surfaceBlock: Block.Snow,
    subSurfaceBlock: Block.Dirt,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.03, cactus: false,
    decorationDensity: 0.04,
    decorations: [
      { block: Block.TallGrass,  weight: 0.7 },
      { block: Block.FlowerBlue, weight: 0.3 },
    ],
  },
  [Biome.Mountains]: {
    name: "Mountains",
    surfaceBlock: Block.Stone,
    subSurfaceBlock: Block.Stone,
    treeWood: Block.SpruceWood, treeLeaves: Block.SpruceLeaves, treeDensity: 0.10, cactus: false,
    decorationDensity: 0.10,
    decorations: [
      { block: Block.TallGrass,    weight: 0.6 },
      { block: Block.FlowerYellow, weight: 0.4 },
    ],
  },
};


export function createBiomeSampler(seed: number, biomeParams: BiomeParams = DEFAULT_PARAMS.biomes) {
  const tempNoise  = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);

  return function sampleTempHumid(wx: number, wz: number): { temp: number; humid: number } {
    const s = biomeParams.tempHumidityScale;
    return {
      temp:  tempNoise.fbm2D(wx / s, wz / s, 4, 0.5, 2.0),
      humid: humidNoise.fbm2D(wx / s, wz / s, 4, 0.5, 2.0),
    };
  };
}

function pickTempHumidBiome(temp: number, humid: number): BiomeId {
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

/**
 * Pick a biome using climate noise + the resulting height. Climate-field
 * overrides for Ocean / Beach / Mountains short-circuit; otherwise the
 * existing (temp, humid) matrix applies.
 */
export function classifyBiome(
  continentalness: number,
  erosion: number,
  temp: number,
  humid: number,
  height: number,
  waterLevel: number,
  t: { oceanContinentalness: number; coastContinentalness: number; beachBand: number; inlandContinentalness: number; mountainErosion: number },
): BiomeId {
  if (continentalness < t.oceanContinentalness) return Biome.Ocean;
  if (continentalness < t.coastContinentalness && height < waterLevel + t.beachBand) return Biome.Beach;
  if (continentalness > t.inlandContinentalness && erosion < t.mountainErosion) return Biome.Mountains;
  return pickTempHumidBiome(temp, humid);
}

export const BLEND_RADIUS = 4;

/**
 * Blended grass colors + dominant biome per column. Height is no longer
 * biome-driven, so only grass-color blending remains.
 */
export function computeBlendedGrassColors(
  worldXOff: number,
  worldZOff: number,
  chunkSize: number,
  getTempHumid: (wx: number, wz: number) => { temp: number; humid: number },
  getDominantBiome: (lx: number, lz: number) => BiomeId,
): {
  dominantBiomes: Uint8Array;
  grassColors: Uint32Array;
} {
  const padSize = chunkSize + 2 * BLEND_RADIUS;
  const paddedTemp  = new Float32Array(padSize * padSize);
  const paddedHumid = new Float32Array(padSize * padSize);

  for (let pz = 0; pz < padSize; pz++) {
    for (let px = 0; px < padSize; px++) {
      const { temp, humid } = getTempHumid(
        worldXOff - BLEND_RADIUS + px,
        worldZOff - BLEND_RADIUS + pz,
      );
      const idx = pz * padSize + px;
      paddedTemp[idx]  = temp;
      paddedHumid[idx] = humid;
    }
  }

  const kernelSize = 2 * BLEND_RADIUS + 1;
  const kernelArea = kernelSize * kernelSize;
  const dominantBiomes = new Uint8Array(chunkSize * chunkSize);
  const grassColors    = new Uint32Array(chunkSize * chunkSize);

  for (let lz = 0; lz < chunkSize; lz++) {
    for (let lx = 0; lx < chunkSize; lx++) {
      let totalR = 0, totalG = 0, totalB = 0;
      for (let kz = 0; kz < kernelSize; kz++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const pIdx = (lz + kz) * padSize + (lx + kx);
          const gc = grassColorFromClimate(paddedTemp[pIdx], paddedHumid[pIdx]);
          totalR += (gc >> 16) & 0xFF;
          totalG += (gc >>  8) & 0xFF;
          totalB +=  gc        & 0xFF;
        }
      }
      const idx = lz * chunkSize + lx;
      const avgR = Math.round(totalR / kernelArea);
      const avgG = Math.round(totalG / kernelArea);
      const avgB = Math.round(totalB / kernelArea);
      grassColors[idx] = (avgR << 16) | (avgG << 8) | avgB;
      dominantBiomes[idx] = getDominantBiome(lx, lz);
    }
  }

  return { dominantBiomes, grassColors };
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
