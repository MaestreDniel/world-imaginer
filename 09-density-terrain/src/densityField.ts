import { createNoise } from "./perlin";
import type { OffsetFactorSampler, ColumnFields } from "./offsetFactor";
import type { GenerationParams } from "./generationParams";

export interface DensitySampler {
  /** Sample density at world (wx, wy, wz). Solid iff return >= 0. */
  sampleDensity(wx: number, wy: number, wz: number): number;
  /** Same, but with an already-computed column-fields value (avoids redundant 2D work). */
  densityFromFields(fields: ColumnFields, wx: number, wy: number, wz: number): number;
}

export function createDensitySampler(
  seed: number,
  params: GenerationParams,
  offsetFactor: OffsetFactorSampler,
  waterLevel: number,
): DensitySampler {
  const jaggedNoise = createNoise(seed + 30);
  const caveNoiseA  = createNoise(seed + 31);
  const caveNoiseB  = createNoise(seed + 32);
  const d = params.density;

  function caveStrength(wy: number): number {
    // 0 above sea level, 1 at sea level - caveDepthRange, 0 below bedrock
    const minHeight = params.extent.minHeight;
    if (wy >= waterLevel) return 0;
    if (wy <= minHeight + 4) return 0;
    const depth = waterLevel - wy;
    const ramp = Math.min(1, depth / d.caveDepthRange);
    const bedrockFalloff = Math.min(1, (wy - minHeight - 4) / 8);
    return ramp * bedrockFalloff;
  }

  function densityFromFields(
    fields: ColumnFields,
    wx: number,
    wy: number,
    wz: number,
  ): number {
    const { offset, factor, jaggedness } = fields;

    const base = (offset - wy) * factor;

    const dy = Math.abs(wy - offset);
    const envelope = Math.max(0, 1 - dy / d.jaggedFalloff);
    const jagged = jaggedness * envelope * jaggedNoise.fbm3D(
      wx / d.jaggedScale, wy / d.jaggedScale, wz / d.jaggedScale,
      d.jaggedOctaves, 0.5, 2.0,
    );

    // Cave term needs to scale with |base| so it can overpower the depth-based
    // positive density at any depth. Without this scaling, caves never carve
    // anything because cs * m * factor (max ~0.16) is dwarfed by base (which
    // grows linearly with depth — `factor × depth_below_offset`).
    let density = base + jagged;
    const cs = caveStrength(wy);
    if (cs > 0) {
      const n1 = caveNoiseA.fbm3D(wx / d.caveScale, wy / d.caveScale, wz / d.caveScale, 2, 0.5, 2.0);
      const n2 = caveNoiseB.fbm3D(wx / d.caveScale, wy / d.caveScale, wz / d.caveScale, 2, 0.5, 2.0);
      const inside = Math.max(0, d.caveThreshold - Math.max(Math.abs(n1), Math.abs(n2)));
      if (inside > 0) {
        // carveFraction ∈ [0, 1]: 1 means tunnel core (full carve), 0 means just
        // outside the threshold. Multiplied by 1.6 so even partial-strength tunnels
        // can flip the sign — produces a soft halo of "near-air" around carved
        // tunnel cores rather than a hard threshold ring.
        const carveFraction = cs * (inside / d.caveThreshold);
        density -= Math.abs(base) * carveFraction * 1.6;
      }
    }

    return density;
  }

  function sampleDensity(wx: number, wy: number, wz: number): number {
    return densityFromFields(offsetFactor.fieldsAt(wx, wz), wx, wy, wz);
  }

  return { sampleDensity, densityFromFields };
}
