import { createClimateSampler, type ClimateSample } from "./climate";
import { evalSpline, evalAnchored, type TerrainShape } from "./splines";
import type { GenerationParams } from "./generationParams";

export interface TerrainShaper {
  heightAt(wx: number, wz: number): number;
  /** Compute height from an already-sampled ClimateSample, avoiding redundant noise calls. */
  heightFromClimate(sample: ClimateSample): number;
  /** Exposed so the chunk loop can call the biome classifier with the same sample. */
  sampleClimate(wx: number, wz: number): ClimateSample;
}

export function createTerrainShaper(seed: number, params: GenerationParams): TerrainShaper {
  const sampleClimate = createClimateSampler(seed, params.climate);
  const shape: TerrainShape = params.shape.shape;
  const { minHeight, maxHeight } = params.extent;

  function heightFromClimate({ continentalness, erosion, peaksValleys }: ClimateSample): number {
    const base   = evalSpline(shape.continent, continentalness);
    const eroAdj = evalAnchored(shape.erosionByContinent, continentalness, erosion);
    const pvAdj  = evalAnchored(shape.pvByErosion, erosion, peaksValleys);
    const h = base + eroAdj + pvAdj;
    return h < minHeight ? minHeight : h > maxHeight ? maxHeight : h;
  }

  function heightAt(wx: number, wz: number): number {
    return heightFromClimate(sampleClimate(wx, wz));
  }

  return { heightAt, heightFromClimate, sampleClimate };
}
