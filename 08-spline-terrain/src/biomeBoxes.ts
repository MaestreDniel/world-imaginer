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
 * Registries themselves live in `biomes.ts` to avoid a circular import:
 * defining them here would force this file to import biome-id values
 * before `biomes.ts` finishes initializing them.
 */

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
