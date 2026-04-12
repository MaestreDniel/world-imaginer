import { type ErosionConfig, DEFAULT_EROSION } from "./erosion";

// ── Terrain noise ──────────────────────────────────────────────────
export interface TerrainParams {
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  warpStrength: number;
  warpIterations: number;
  heightMultiplier: number;
}

export interface CaveParams {
  scale: number;
  octaves: number;
  threshold: number;
  surfaceErosionScale: number;
  surfaceErosionThreshold: number;
  surfaceErosionDepth: number;
}

export interface AquiferParams {
  /** Master toggle for aquifer/lake generation. */
  enabled: boolean;
  /** Scale of the 3D presence field. Larger = sparser lake regions. */
  presenceScale: number;
  /** Threshold on presence field; only cells above this have a local water table. Higher = rarer. */
  presenceThreshold: number;
  /** Scale of the 2D local water-surface height field. */
  levelScale: number;
  /** Vertical wobble amplitude of the local water surface. */
  levelAmplitude: number;
  /** Baseline Y offset of the local water surface (relative to global waterLevel). */
  levelOffset: number;
}

export interface RiverParams {
  voronoiScale: number;
  edgeThreshold: number;
  maxCarveDepth: number;
}

export interface BiomeParams {
  tempHumidityScale: number;
  continentScale: number;
  oceanThreshold: number;
  beachThreshold: number;
  mountainThreshold: number;
}

export interface OreParams {
  scale: number;
  ironThreshold: number;
  ironMinDepth: number;
  coalThreshold: number;
}

export interface ErosionParams {
  enabled: boolean;
  droplets: number;
  erosionRate: number;
  depositionRate: number;
  inertia: number;
  maxLifetime: number;
  evaporationRate: number;
  gravity: number;
}

export interface GenerationParams {
  terrain: TerrainParams;
  erosion: ErosionParams;
  caves: CaveParams;
  aquifers: AquiferParams;
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
}

export const DEFAULT_PARAMS: GenerationParams = {
  terrain: {
    scale: 115,
    octaves: 6,
    persistence: 0.5,
    lacunarity: 1.7,
    warpStrength: 2.4,
    warpIterations: 1,
    heightMultiplier: 55,
  },
  erosion: {
    enabled: false,
    droplets: 50,
    erosionRate: 0.15,
    depositionRate: 0.26,
    inertia: 0.3,
    maxLifetime: 48,
    evaporationRate: 0.02,
    gravity: 10,
  },
  caves: {
    scale: 30,
    octaves: 3,
    threshold: 0.45,
    surfaceErosionScale: 16,
    surfaceErosionThreshold: 0.38,
    surfaceErosionDepth: 8,
  },
  aquifers: {
    enabled: true,
    presenceScale: 160,
    presenceThreshold: 0.35,
    levelScale: 80,
    levelAmplitude: 8,
    levelOffset: 2,
  },
  rivers: {
    voronoiScale: 220,
    edgeThreshold: 0.15,
    maxCarveDepth: 8,
  },
  biomes: {
    tempHumidityScale: 480,
    continentScale: 850,
    oceanThreshold: -0.21,
    beachThreshold: -0.11,
    mountainThreshold: 0.8,
  },
  ores: {
    scale: 6,
    ironThreshold: 0.55,
    ironMinDepth: 15,
    coalThreshold: 0.50,
  },
};

/** Convert ErosionParams to the full ErosionConfig expected by erode(). */
export function toErosionConfig(ep: ErosionParams): ErosionConfig {
  return {
    droplets: ep.droplets,
    maxLifetime: ep.maxLifetime,
    inertia: ep.inertia,
    erosionRate: ep.erosionRate,
    depositionRate: ep.depositionRate,
    evaporationRate: ep.evaporationRate,
    gravity: ep.gravity,
    minSlope: DEFAULT_EROSION.minSlope,
    erosionRadius: DEFAULT_EROSION.erosionRadius,
  };
}

/** Deep-clone params (all plain objects, no methods). */
export function cloneParams(p: GenerationParams): GenerationParams {
  return JSON.parse(JSON.stringify(p));
}
