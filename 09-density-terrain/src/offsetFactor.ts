import { createClimateSampler, type ClimateSample } from "./climate";
import { evalSpline, evalAnchored } from "./splines";
import { createNoise } from "./perlin";
import type { GenerationParams } from "./generationParams";

export interface ColumnFields {
  offset: number;
  factor: number;
  jaggedness: number;
  /** [0..1] mountain-climate gate: 0 = not mountainous, 1 = full mountain. */
  spireMask: number;
}

export interface OffsetFactorSampler {
  sampleClimate(wx: number, wz: number): ClimateSample;
  fieldsFromClimate(sample: ClimateSample, wx: number, wz: number): ColumnFields;
  fieldsAt(wx: number, wz: number): ColumnFields;
  /** Soft surface y at (wx, wz) — equals offset, the y where ground "wants to be". */
  offsetAt(wx: number, wz: number): number;
}

// Independent 2D noise that perturbs offset away from the continent spline,
// so column-scale height isn't a direct function of continentalness. The
// trilerp corner grid is too coarse for the 3D jagged term to produce
// peaks/valleys at column scale on its own — this 2D term carries that load.
// Scaled by erosionDamp (not PV) so even low-PV columns get height variation
// in low-erosion (mountainous) regions.
const HEIGHT_PERTURB_SCALE = 180;
const HEIGHT_PERTURB_AMP   = 80;

// Mountain spire perturbation: a smaller-scale, larger-amplitude 2D noise
// gated by a "mountainous climate" mask (low erosion + high continentalness).
// Adds tall narrow peaks ON TOP of the regular height perturbation in
// climates that produce Mountains/Windswept biomes. Done from climate (not
// biome) so it's seamless across chunks.
const SPIRE_SCALE   = 90;
const SPIRE_AMP     = 60;

export function createOffsetFactorSampler(
  seed: number,
  params: GenerationParams,
): OffsetFactorSampler {
  const sampleClimate = createClimateSampler(seed, params.climate);
  const heightPerturbNoise = createNoise(seed + 40);
  const spireNoise = createNoise(seed + 41);
  const shape = params.shape.shape;
  const { factorMin, factorMax } = params.density;

  function fieldsFromClimate(sample: ClimateSample, wx: number, wz: number): ColumnFields {
    const { continentalness, erosion, peaksValleys } = sample;

    // continent spline → primary offset
    const offsetBase = evalSpline(shape.continent, continentalness);

    // erosionByContinent → adds to offset
    const eroAdj = evalAnchored(shape.erosionByContinent, continentalness, erosion);

    // pvByErosion → adds to offset
    const pvAdj = evalAnchored(shape.pvByErosion, erosion, peaksValleys);

    // jaggedness: amplitude of the 3D noise term that gets added to density.
    // Has a floor (0.3) so any uneroded column has *some* 3D bumpiness even
    // when PV is small; |peaksValleys| pushes it higher in mountain regions.
    // The whole thing is gated by erosionDamp so eroded plains stay flat.
    // JAGGED_GAIN scales it to compete with `base = (offset - wy) * factor`
    // — without enough gain, the 3D noise can't flip the sign at the surface
    // band and the trilerp produces a smooth heightmap.
    const JAGGED_GAIN = 25;
    const erosionDamp = Math.max(0, 1 - (erosion * 0.5 + 0.5));
    const pvAmp = (0.3 + Math.abs(peaksValleys) * 3) * erosionDamp;

    // 2D height perturbation: shifts offset by up to ±HEIGHT_PERTURB_AMP,
    // scaled by erosionDamp so eroded plains stay flat and uneroded regions
    // get column-scale peaks and valleys regardless of PV value.
    const heightPerturb = heightPerturbNoise.fbm2D(
      wx / HEIGHT_PERTURB_SCALE, wz / HEIGHT_PERTURB_SCALE,
      4, 0.5, 2.0,
    ) * HEIGHT_PERTURB_AMP * erosionDamp;

    // Mountain spire mask: smoothstep over (continentalness > 0.15, erosion < -0.1).
    // Roughly aligns with the Mountains / Windswept / StonyPeaks biome boxes
    // without depending on biome classification (which lives in chunk.ts).
    const continentMask = Math.max(0, Math.min(1, (continentalness - 0.15) / 0.25));
    const erosionMask   = Math.max(0, Math.min(1, (-erosion - 0.1)         / 0.4 ));
    const spireMask     = continentMask * erosionMask;
    const spirePerturb = spireNoise.fbm2D(
      wx / SPIRE_SCALE, wz / SPIRE_SCALE,
      3, 0.55, 2.2,
    ) * SPIRE_AMP * spireMask;

    const offset = offsetBase + eroAdj * 0.4 + pvAdj * 0.2 + heightPerturb + spirePerturb;

    // factor: high when erosion is low (sharp cliffs / mountains)
    // erosion in ~[-1, 1]; map -1 → factorMax, 1 → factorMin
    const factorRaw = factorMax + (factorMin - factorMax) * (erosion * 0.5 + 0.5);
    const factor = Math.max(factorMin, Math.min(factorMax, factorRaw));

    const jaggedness = pvAmp * JAGGED_GAIN;

    // TEMP debug: print one in ~10000 columns
    if (Math.random() < 0.0001) {
      console.log(`[09 debug] cont=${continentalness.toFixed(2)} ero=${erosion.toFixed(2)} pv=${peaksValleys.toFixed(2)} | base=${offsetBase.toFixed(1)} perturb=${heightPerturb.toFixed(1)} spire=${spirePerturb.toFixed(1)}(mask=${spireMask.toFixed(2)}) → offset=${offset.toFixed(1)}, factor=${factor.toFixed(2)}, jagged=${jaggedness.toFixed(1)}`);
    }

    return { offset, factor, jaggedness, spireMask };
  }

  function fieldsAt(wx: number, wz: number): ColumnFields {
    return fieldsFromClimate(sampleClimate(wx, wz), wx, wz);
  }

  function offsetAt(wx: number, wz: number): number {
    return fieldsAt(wx, wz).offset;
  }

  return { sampleClimate, fieldsFromClimate, fieldsAt, offsetAt };
}
