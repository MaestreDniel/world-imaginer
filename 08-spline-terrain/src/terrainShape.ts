import { createClimateSampler, type ClimateSample } from "./climate";
import { evalSpline, evalAnchored, type TerrainShape } from "./splines";
import type { GenerationParams } from "./generationParams";

export interface TerrainShaper {
  heightAt(wx: number, wz: number): number;
  /** Exposed so the chunk loop can call the biome classifier with the same sample. */
  sampleClimate(wx: number, wz: number): ClimateSample;
}

export function createTerrainShaper(seed: number, params: GenerationParams): TerrainShaper {
  const sampleClimate = createClimateSampler(seed, params.climate);
  const shape: TerrainShape = params.shape.shape;
  const { minHeight, maxHeight } = params.extent;

  function heightAt(wx: number, wz: number): number {
    const { continentalness, erosion, peaksValleys } = sampleClimate(wx, wz);
    const base    = evalSpline(shape.continent, continentalness);
    const eroAdj  = evalAnchored(shape.erosionByContinent, continentalness, erosion);
    const pvAdj   = evalAnchored(shape.pvByErosion, erosion, peaksValleys);
    const h = base + eroAdj + pvAdj;
    return h < minHeight ? minHeight : h > maxHeight ? maxHeight : h;
  }

  return { heightAt, sampleClimate };
}
