/**
 * 6D climate-box biome picker.
 *
 * Each biome declares an inclusive box on six axes: five climate fields
 * (temperature, humidity, continentalness, erosion, peaks & valleys) in
 * range [-1, +1], plus a normalized depth axis. The picker scores every
 * biome's box with a weighted-squared-overshoot fitness function and
 * returns the biome with the smallest score.
 *
 * Surface and cave biomes use separate registries with the same picker.
 */

import { Biome, CaveBiome, type BiomeId, type CaveBiomeId } from "./biomes";

export const Axis = {
  Temperature:  0,
  Humidity:     1,
  Continent:    2,
  Erosion:      3,
  PeaksValleys: 4,
  Depth:        5,
} as const;
export type AxisIdx = typeof Axis[keyof typeof Axis];

/**
 * A 6D inclusive box. The five climate axes use noise-output range
 * [-1, +1]. Depth uses *normalized* units after dividing the raw depth
 * (in blocks below surface) by depthScale, so all axes are comparable
 * before weighting.
 */
export interface BiomeBox {
  temperature:  [number, number];
  humidity:     [number, number];
  continent:    [number, number];
  erosion:      [number, number];
  peaksValleys: [number, number];
  depth:        [number, number];
}

export interface BiomeBoxEntry<Id extends number> {
  id: Id;
  box: BiomeBox;
}

export interface GlobalAxisWeights {
  temperature:  number;
  humidity:     number;
  continent:    number;
  erosion:      number;
  peaksValleys: number;
  depth:        number;
}

export interface BiomePickerParams {
  weights: GlobalAxisWeights;
  /** Divide raw depth (blocks below surface) by this to get the value
   *  matched against the box's depth range. */
  depthScale: number;
}

export interface ClimatePoint {
  temperature:  number;
  humidity:     number;
  continent:    number;
  erosion:      number;
  peaksValleys: number;
  /** Raw depth in blocks (positive = below surface). The picker
   *  normalizes internally using depthScale. */
  depthBlocks:  number;
}

export const DEFAULT_AXIS_WEIGHTS: GlobalAxisWeights = {
  temperature:  1.0,
  humidity:     1.0,
  continent:    1.5,
  erosion:      1.0,
  peaksValleys: 0.7,
  depth:        1.0,
};

export const DEFAULT_BIOME_PICKER: BiomePickerParams = {
  weights:    { ...DEFAULT_AXIS_WEIGHTS },
  depthScale: 64,
};

function axisDistance(value: number, range: [number, number]): number {
  if (value < range[0]) return range[0] - value;
  if (value > range[1]) return value - range[1];
  return 0;
}

/**
 * Sum of weighted-squared per-axis overshoots. A point inside the box
 * on every axis scores 0 (always wins). A point outside scores the sum
 * of squared, weighted overshoot distances.
 */
export function fitness(
  point: ClimatePoint,
  box: BiomeBox,
  w: GlobalAxisWeights,
  depthScale: number,
): number {
  const dT = axisDistance(point.temperature,             box.temperature)  * w.temperature;
  const dH = axisDistance(point.humidity,                box.humidity)     * w.humidity;
  const dC = axisDistance(point.continent,               box.continent)    * w.continent;
  const dE = axisDistance(point.erosion,                 box.erosion)      * w.erosion;
  const dP = axisDistance(point.peaksValleys,            box.peaksValleys) * w.peaksValleys;
  const dD = axisDistance(point.depthBlocks / depthScale, box.depth)       * w.depth;
  return dT*dT + dH*dH + dC*dC + dE*dE + dP*dP + dD*dD;
}

/**
 * Linear scan: returns the id of the registry entry with minimum
 * fitness. Strict `<` means earlier entries win ties, so registry
 * order is part of the design.
 */
export function pickBiome<Id extends number>(
  point: ClimatePoint,
  registry: ReadonlyArray<BiomeBoxEntry<Id>>,
  params: BiomePickerParams,
): Id {
  let bestId    = registry[0].id;
  let bestScore = fitness(point, registry[0].box, params.weights, params.depthScale);
  for (let i = 1; i < registry.length; i++) {
    const score = fitness(point, registry[i].box, params.weights, params.depthScale);
    if (score < bestScore) { bestScore = score; bestId = registry[i].id; }
  }
  return bestId;
}

/**
 * Surface biome registry. Order matters for tie-breaking (earlier wins).
 * Most specific first (FrozenOcean before Ocean), most general last
 * (the temperate matrix replacement).
 *
 * The five climate axes use [-1, +1]. Depth uses normalized units
 * (raw blocks ÷ depthScale=64). Surface biomes use depth band
 * [-0.1, +0.1] (≈ surface ± 6 blocks).
 */
export const SURFACE_REGISTRY: ReadonlyArray<BiomeBoxEntry<BiomeId>> = [
  { id: Biome.FrozenOcean, box: {
      temperature: [-1.0, -0.3], humidity: [-1, 1],
      continent:   [-1, -0.25],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Ocean, box: {
      temperature: [-1, 1],      humidity: [-1, 1],
      continent:   [-1, -0.25],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Beach, box: {
      temperature: [-1, 1],          humidity: [-1, 1],
      continent:   [-0.25, -0.05],   erosion:  [-1, 1], peaksValleys: [-1, 0],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.StonyPeaks, box: {
      temperature: [-1, 0.2],   humidity: [-1, 1],
      continent:   [ 0.4, 1],   erosion:  [-1, -0.5], peaksValleys: [ 0.3, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Mountains, box: {
      temperature: [-1, 1],     humidity: [-1, 1],
      continent:   [ 0.2, 1],   erosion:  [-1, -0.4], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.WindsweptHills, box: {
      temperature: [-1, 1],     humidity: [-1, 1],
      continent:   [ 0.0, 1],   erosion:  [-0.6, -0.2], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Desert, box: {
      temperature: [ 0.2, 1],   humidity: [-1, 0.15],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Savanna, box: {
      temperature: [ 0.2, 1],   humidity: [ 0.15, 1],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Forest, box: {
      temperature: [-0.15, 0.2], humidity: [ 0.2, 1],
      continent:   [-0.05, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.BirchForest, box: {
      temperature: [-0.15, 0.2], humidity: [-0.1, 0.2],
      continent:   [-0.05, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Plains, box: {
      temperature: [-0.15, 0.2], humidity: [-1, -0.1],
      continent:   [-0.05, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Taiga, box: {
      temperature: [-1, -0.15], humidity: [ 0.05, 1],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
  { id: Biome.Tundra, box: {
      temperature: [-1, -0.15], humidity: [-1, 0.05],
      continent:   [-0.05, 1],  erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [-0.1, 0.1],
  }},
];

/**
 * Cave biome registry. Runs once per carved cave voxel. Order matters
 * for tie-breaking; LushCaves first so warm + humid + deep voxels pick
 * it over the Stone default.
 *
 * Cave biomes use depth band [0.1, 1.0] (≈ 6 blocks below surface and
 * deeper).
 */
export const CAVE_REGISTRY: ReadonlyArray<BiomeBoxEntry<CaveBiomeId>> = [
  { id: CaveBiome.LushCaves, box: {
      temperature: [ 0.0, 1],   humidity: [ 0.2, 1],
      continent:   [-0.2, 1],   erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [ 0.1, 1.0],
  }},
  { id: CaveBiome.Stone, box: {
      temperature: [-1, 1], humidity: [-1, 1],
      continent:   [-1, 1], erosion:  [-1, 1], peaksValleys: [-1, 1],
      depth:       [ 0.1, 1.0],
  }},
];
