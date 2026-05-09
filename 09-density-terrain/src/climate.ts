import { createNoise } from "./perlin";

/** Per-field fBm config. */
export interface ClimateFieldParams {
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
}

export interface ClimateParams {
  continentalness: ClimateFieldParams;
  erosion: ClimateFieldParams;
  peaksValleys: ClimateFieldParams;
}

export const DEFAULT_CLIMATE: ClimateParams = {
  continentalness: { scale: 1500, octaves: 3, persistence: 0.5, lacunarity: 2.0 },
  erosion:         { scale:  600, octaves: 3, persistence: 0.5, lacunarity: 2.0 },
  peaksValleys:    { scale:  180, octaves: 4, persistence: 0.5, lacunarity: 2.0 },
};

export interface ClimateSample {
  continentalness: number;  // ~[-1, 1]
  erosion: number;          // ~[-1, 1]
  peaksValleys: number;     // ~[-1, 1]
}

export function createClimateSampler(seed: number, params: ClimateParams) {
  const contNoise = createNoise(seed + 20);
  const eroNoise  = createNoise(seed + 21);
  const pvNoise   = createNoise(seed + 22);

  return function sample(wx: number, wz: number): ClimateSample {
    const c = params.continentalness;
    const e = params.erosion;
    const p = params.peaksValleys;
    return {
      continentalness: contNoise.fbm2D(wx / c.scale, wz / c.scale, c.octaves, c.persistence, c.lacunarity),
      erosion:         eroNoise.fbm2D (wx / e.scale, wz / e.scale, e.octaves, e.persistence, e.lacunarity),
      peaksValleys:    pvNoise.fbm2D  (wx / p.scale, wz / p.scale, p.octaves, p.persistence, p.lacunarity),
    };
  };
}
