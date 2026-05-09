import { createClimateSampler, type ClimateSample } from "./climate";
import { evalSpline, evalAnchored } from "./splines";
import type { GenerationParams } from "./generationParams";

export interface ColumnFields {
  offset: number;
  factor: number;
  jaggedness: number;
}

export interface OffsetFactorSampler {
  sampleClimate(wx: number, wz: number): ClimateSample;
  fieldsFromClimate(sample: ClimateSample): ColumnFields;
  fieldsAt(wx: number, wz: number): ColumnFields;
  /** Soft surface y at (wx, wz) — equals offset, the y where ground "wants to be". */
  offsetAt(wx: number, wz: number): number;
}

export function createOffsetFactorSampler(
  seed: number,
  params: GenerationParams,
): OffsetFactorSampler {
  const sampleClimate = createClimateSampler(seed, params.climate);
  const shape = params.shape.shape;
  const { factorMin, factorMax } = params.density;

  function fieldsFromClimate(sample: ClimateSample): ColumnFields {
    const { continentalness, erosion, peaksValleys } = sample;

    // continent spline → primary offset
    const offsetBase = evalSpline(shape.continent, continentalness);

    // erosionByContinent → adds to offset and contributes to factor
    const eroAdj = evalAnchored(shape.erosionByContinent, continentalness, erosion);

    // pvByErosion → adds to offset and contributes to jaggedness
    const pvAdj = evalAnchored(shape.pvByErosion, erosion, peaksValleys);

    const offset = offsetBase + eroAdj * 0.4 + pvAdj * 0.2;

    // factor: high when erosion is low (sharp cliffs / mountains)
    // erosion in ~[-1, 1]; map -1 → factorMax, 1 → factorMin
    const factorRaw = factorMax + (factorMin - factorMax) * (erosion * 0.5 + 0.5);
    const factor = Math.max(factorMin, Math.min(factorMax, factorRaw));

    // jaggedness: high when peaks-and-valleys is high AND erosion is low
    // pv in ~[-1, 1]; erosion shrinks amplitude when high
    const erosionDamp = Math.max(0, 1 - (erosion * 0.5 + 0.5));
    const jaggedness = Math.max(0, peaksValleys) * erosionDamp;

    return { offset, factor, jaggedness };
  }

  function fieldsAt(wx: number, wz: number): ColumnFields {
    return fieldsFromClimate(sampleClimate(wx, wz));
  }

  function offsetAt(wx: number, wz: number): number {
    return fieldsAt(wx, wz).offset;
  }

  return { sampleClimate, fieldsFromClimate, fieldsAt, offsetAt };
}
