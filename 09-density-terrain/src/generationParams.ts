import { type ClimateParams, DEFAULT_CLIMATE } from "./climate";
import { type TerrainShape, DEFAULT_TERRAIN_SHAPE } from "./splines";
import { type BiomePickerParams, DEFAULT_BIOME_PICKER } from "./biomeBoxes";

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
  aquifers: AquiferParams;
  biomes: BiomeParams;
  ores: OreParams;
  vegetation: VegetationParams;
  density: DensityParams;
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
  aquifers: {
    enabled: false,
    presenceScale: 160,
    presenceThreshold: 0.35,
    levelScale: 800,
    levelAmplitude: 15,
    levelOffset: 0,
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
    // jaggedScale must be comparable to the trilerp corner spacing (CELL_X/Z=4,
    // CELL_Y=8) — otherwise neighboring corners read near-identical noise values
    // and the trilerp produces a smooth surface no matter how high the gain.
    // For overhangs/cliffs we want vertically-adjacent corners (8 voxels apart)
    // to be able to flip sign relative to base — that needs either small scale
    // or big amplitude. Pushing scale down to 12 gives ~67% of a noise period
    // between vertical corners.
    jaggedScale: 12,
    jaggedFalloff: 24,
    jaggedOctaves: 3,
    caveScale: 60,
    caveThreshold: 0.08,
    caveDepthRange: 32,
    factorMin: 0.4,
    factorMax: 2.0,
  },
};

/** Deep-clone params (all plain objects, no methods). */
export function cloneParams(p: GenerationParams): GenerationParams {
  return JSON.parse(JSON.stringify(p));
}
