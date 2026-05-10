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
  // 2D noise that picks rare columns where the cave system breaks through
  // to the surface. Most columns stay sealed (full surface protection); a
  // small fraction with entranceMask > ENTRANCE_THRESHOLD let caves carve
  // up through the surface band, producing visible cave entries.
  const entranceNoise = createNoise(seed + 33);
  const d = params.density;
  const ENTRANCE_SCALE     = 80;
  const ENTRANCE_THRESHOLD = 0.42;

  /**
   * Cave strength as a function of y, the column's surface offset, and the
   * column's entrance gate.
   *
   * Most columns have a fully-sealed surface (depth < 4 returns 0). Columns
   * where the 2D entrance gate is open (`entranceOpen=true`) let cs ramp up
   * starting from depth=0, so caves can carve through to the surface and
   * produce visible entries.
   *
   * Returns 0 outside the underground range, ramps to 1 at depth=caveDepthRange
   * below the surface, falls back to 0 in the 8 voxels above bedrock.
   */
  function caveStrength(wy: number, offset: number, entranceOpen: boolean): number {
    const minHeight = params.extent.minHeight;
    const depthBelowSurface = offset - wy;
    if (depthBelowSurface < 0) return 0;
    if (wy <= minHeight + 4) return 0;        // protect bedrock band
    const surfaceFloor = entranceOpen ? 0 : 4; // sealed columns: protect top 4 voxels
    if (depthBelowSurface < surfaceFloor) return 0;
    const ramp = Math.min(1, (depthBelowSurface - surfaceFloor) / d.caveDepthRange);
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
    const entranceVal = entranceNoise.fbm2D(wx / ENTRANCE_SCALE, wz / ENTRANCE_SCALE, 2, 0.5, 2.0);
    const entranceOpen = entranceVal > ENTRANCE_THRESHOLD;
    const cs = caveStrength(wy, offset, entranceOpen);
    if (cs > 0) {
      // Two complementary cave shapes:
      //   1. "Cheese" — single 3D iso-surface from one noise. Large
      //      coherent caverns (a band of voxels where |n1| < threshold).
      //   2. "Noodle" — intersection of two noises near zero. Thin twisty
      //      tunnels (1D curves in 3D space, inflated by threshold).
      // Without (1) you only get the rare pockets where both noises happen
      // to align — that was the bug producing only "air pocket" caves.
      const n1 = caveNoiseA.fbm3D(wx / d.caveScale, wy / d.caveScale, wz / d.caveScale, 2, 0.5, 2.0);
      const n2 = caveNoiseB.fbm3D(wx / d.caveScale, wy / d.caveScale, wz / d.caveScale, 2, 0.5, 2.0);

      const cheese = Math.max(0, d.caveThreshold - Math.abs(n1));
      // Noodle threshold is tighter (0.55×) — full threshold here would carve
      // roughly half the world. Multiplied by 0.9 in the final mix to keep
      // cheese as the dominant cave type.
      const noodleThreshold = d.caveThreshold * 0.55;
      const noodle = Math.max(0, noodleThreshold - Math.max(Math.abs(n1), Math.abs(n2)));

      const inside = Math.max(cheese, (noodle / noodleThreshold) * d.caveThreshold * 0.9);
      if (inside > 0) {
        // carveFraction ∈ [0, 1]: 1 means cave core (full carve). Multiplier
        // 1.6 means even partial-strength tunnels flip the sign, producing a
        // soft halo of "near-air" around carved cores rather than a hard ring.
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
