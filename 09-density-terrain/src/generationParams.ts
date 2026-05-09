import { type ErosionConfig, DEFAULT_EROSION } from "./erosion";
import { type ClimateParams, DEFAULT_CLIMATE } from "./climate";
import { type TerrainShape, DEFAULT_TERRAIN_SHAPE } from "./splines";
import { type BiomePickerParams, DEFAULT_BIOME_PICKER } from "./biomeBoxes";

export interface CaveParams {
  /** Noise scale for tunnel sizing (larger = wider features). */
  scale: number;
  /** Number of fBm octaves. */
  octaves: number;
  /** Y-axis stretch factor: >1 elongates noise vertically → tunnels prefer horizontal. */
  verticalStretch: number;
  /** Base threshold |n|<t near the surface. Smaller = rarer surface openings. */
  thresholdBase: number;
  /** Maximum threshold at depth. Larger = wider deep networks. */
  thresholdMax: number;
  /** Per-block growth of threshold with depth. */
  depthGain: number;
  /** Minimum depth below the surface before caves can carve. Protects top blocks. */
  minDepth: number;
  /** Depth below which a verticality check filters horizontal near-surface tunnels. */
  entryDepth: number;
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
}

export interface OreParams {
  scale: number;
  ironThreshold: number;
  ironMinDepth: number;
  coalThreshold: number;
}

export interface DensityParams {
  /** fBm3D frequency divisor for the jaggedness term. Larger = smoother peaks. */
  jaggedScale: number;
  /** Vertical falloff for the jaggedness envelope around offset(x,z). */
  jaggedFalloff: number;
  /** fBm octaves for the jaggedness noise. */
  jaggedOctaves: number;
  /** fBm3D frequency divisor for the cave noises. */
  caveScale: number;
  /** Threshold for cave intersection (|n| < t inside tunnels, mapped to caveMask). */
  caveThreshold: number;
  /** Cave term reaches full strength `caveDepthRange` voxels below sea level. */
  caveDepthRange: number;
  /** Lower clamp on factor(x,z). */
  factorMin: number;
  /** Upper clamp on factor(x,z). */
  factorMax: number;
}

export interface VegetationParams {
  enabled: boolean;
  /** Multiplies every biome's decorationDensity. 0 = no decorations, 1 = default, 3 = lush. */
  globalDensity: number;
  /** Multiplies every biome's treeDensity. 0 = no trees, 1 = default, 3 = thick forest. */
  treeDensity: number;
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

export interface WorldExtentParams {
  minHeight: number;
  maxHeight: number;
}

export interface TerrainShapeParams {
  shape: TerrainShape;
}

export interface GenerationParams {
  climate: ClimateParams;
  shape: TerrainShapeParams;
  biomePicker: BiomePickerParams;
  extent: WorldExtentParams;
  erosion: ErosionParams;
  caves: CaveParams;
  aquifers: AquiferParams;
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
  vegetation: VegetationParams;
  density: DensityParams;
  /** When true, chunk.ts uses the 3D density pipeline; when false, the legacy heightmap pipeline. */
  useDensityPipeline: boolean;
}

export const DEFAULT_PARAMS: GenerationParams = {
  climate: DEFAULT_CLIMATE,
  shape: {
    shape: DEFAULT_TERRAIN_SHAPE,
  },
  biomePicker: {
    weights:    { ...DEFAULT_BIOME_PICKER.weights },
    depthScale: DEFAULT_BIOME_PICKER.depthScale,
  },
  extent: {
    minHeight: -16,
    maxHeight: 104,
  },
  erosion: {
    enabled: true,
    droplets: 15,
    erosionRate: 0.06,
    depositionRate: 0.2,
    inertia: 0.57,
    maxLifetime: 10,
    evaporationRate: 0.06,
    gravity: 20,
  },
  caves: {
    scale: 60,
    octaves: 2,
    verticalStretch: 2.5,
    thresholdBase: 0.015,
    thresholdMax: 0.1,
    depthGain: 0.008,
    minDepth: 0,
    entryDepth: 6,
  },
  aquifers: {
    enabled: false,
    presenceScale: 160,
    presenceThreshold: 0.35,
    levelScale: 800,
    levelAmplitude: 15,
    levelOffset: 0,
  },
  rivers: {
    voronoiScale: 240,
    edgeThreshold: 0.1,
    maxCarveDepth: 5,
  },
  biomes: {
    tempHumidityScale: 480,
  },
  ores: {
    scale: 6,
    ironThreshold: 0.55,
    ironMinDepth: 15,
    coalThreshold: 0.50,
  },
  vegetation: {
    enabled: true,
    globalDensity: 1.0,
    treeDensity: 1.0,
  },
  density: {
    jaggedScale: 80,
    jaggedFalloff: 24,
    jaggedOctaves: 3,
    caveScale: 60,
    caveThreshold: 0.08,
    caveDepthRange: 32,
    factorMin: 0.5,
    factorMax: 6.0,
  },
  useDensityPipeline: false,
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
