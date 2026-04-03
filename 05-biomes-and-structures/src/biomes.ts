import { Block } from "./blocks";
import { createNoise } from "./perlin";

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
    surfaceBlock: Block.DeadGrass,
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
 * Create a biome sampler for a given seed.
 *
 * Returns a function that maps world (x, z) to a biome ID.
 * Temperature and humidity are sampled at large scale (300 blocks)
 * and mapped to biomes via a simple threshold grid.
 */
export function createBiomeSampler(seed: number) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  function sampleNoise(wx: number, wz: number) {
    const continent = continentNoise.fbm2D(wx / 400, wz / 400, 3, 0.5, 2.0);
    const temp = tempNoise.fbm2D(wx / 300, wz / 300, 4, 0.5, 2.0);
    const humid = humidNoise.fbm2D(wx / 300, wz / 300, 4, 0.5, 2.0);
    return { continent, temp, humid };
  }

  function biomeFromNoise(continent: number, temp: number, humid: number): BiomeId {
    if (continent < -0.3) return Biome.Ocean;
    if (continent < -0.15) return Biome.Beach;
    if (continent > 0.45) return Biome.Mountains;

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
export function createBiomeDebugSampler(seed: number) {
  const tempNoise = createNoise(seed + 10);
  const humidNoise = createNoise(seed + 11);
  const continentNoise = createNoise(seed + 12);

  return function getBiomeDebug(wx: number, wz: number): BiomeDebugInfo {
    const continent = continentNoise.fbm2D(wx / 400, wz / 400, 3, 0.5, 2.0);
    const temperature = tempNoise.fbm2D(wx / 300, wz / 300, 4, 0.5, 2.0);
    const humidity = humidNoise.fbm2D(wx / 300, wz / 300, 4, 0.5, 2.0);

    let biome: BiomeId;
    if (continent < -0.3) biome = Biome.Ocean;
    else if (continent < -0.15) biome = Biome.Beach;
    else if (continent > 0.45) biome = Biome.Mountains;
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
