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

  /**
   * Cave strength as a function of y AND the column's surface offset.
   *
   * The previous version gated caves by global sea level, which is wrong with
   * mountainous columns where offset can be y=80 — the eligible cave zone
   * collapsed to a tiny band near sea level even though the column's actual
   * underground extends from y=80 down to bedrock. Cave strength is now
   * relative to the column's surface (offset), so any underground voxel can
   * potentially be a cave.
   *
   * Returns 0 outside the underground range, ramps to 1 at depth=caveDepthRange
   * below the surface, falls back to 0 in the 8 voxels above bedrock.
   */
  function caveStrength(wy: number, offset: number): number {
    const minHeight = params.extent.minHeight;
    const depthBelowSurface = offset - wy;
    if (depthBelowSurface < 4) return 0;     // protect surface band
    if (wy <= minHeight + 4) return 0;        // protect bedrock band
    const ramp = Math.min(1, (depthBelowSurface - 4) / d.caveDepthRange);
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
    const cs = caveStrength(wy, offset);
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
