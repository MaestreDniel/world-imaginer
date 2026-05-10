import type { DensitySampler } from "./densityField";
import type { OffsetFactorSampler, ColumnFields } from "./offsetFactor";
import { createNoise } from "./perlin";

// Per-voxel detail noise added on top of the trilerped density. The trilerp
// can't represent sub-cell sign oscillation (linear interpolation between
// 4×8×4-spaced corners is monotonic inside each cell), so all sub-cell detail
// — overhangs, voxel-scale cliff irregularity, rocky outcrops — comes from
// here. Larger scale = more coherent overhangs / less voxel-grain noise.
const DETAIL_SCALE = 11;
const DETAIL_AMP   = 8;
const DETAIL_FALLOFF = 18;

// CHUNK_SIZE is hardcoded here (matching chunk.ts:29) instead of imported,
// to break a circular import: chunk.ts → chunkDensity.ts → chunk.ts. With
// the import, the CORNERS_* constants below would dereference an undefined
// CHUNK_SIZE during the temporal-dead-zone window of module initialization.
const CHUNK_SIZE = 16;
const CELL_X = 4;
const CELL_Y = 8;
const CELL_Z = 4;
const CORNERS_X = CHUNK_SIZE / CELL_X + 1; // 5
const CORNERS_Y = CHUNK_SIZE / CELL_Y + 1; // 3
const CORNERS_Z = CHUNK_SIZE / CELL_Z + 1; // 5

/**
 * Returns a Uint8Array of length CHUNK_SIZE^3 with 1 at solid voxels, 0 at air voxels.
 * Density is evaluated at 5x3x5 = 75 corner samples, trilerped per voxel, then
 * a per-voxel detail noise is added before the sign test.
 */
export function fillChunkDensity(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  seed: number,
  offsetFactor: OffsetFactorSampler,
  density: DensitySampler,
  /** Pre-computed column fields for the 16x16 footprint, length CHUNK_SIZE^2, indexed lz*CHUNK_SIZE+lx. */
  columnFields: ColumnFields[],
  /** Per-column detail amplitude (typically biome.terrainDrama × DETAIL_AMP). Same indexing as columnFields. */
  detailAmps: Float32Array,
): Uint8Array {
  const detailNoise = createNoise(seed + 50);
  const solid = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  const wxOff = chunkX * CHUNK_SIZE;
  const wyOff = chunkY * CHUNK_SIZE;
  const wzOff = chunkZ * CHUNK_SIZE;

  // Step 1: corner densities (75 samples).
  const corners = new Float32Array(CORNERS_X * CORNERS_Y * CORNERS_Z);
  for (let cz = 0; cz < CORNERS_Z; cz++) {
    const lz = cz * CELL_Z; // 0, 4, 8, 12, 16
    const wz = wzOff + lz;
    for (let cx = 0; cx < CORNERS_X; cx++) {
      const lx = cx * CELL_X; // 0, 4, 8, 12, 16
      const wx = wxOff + lx;
      // For lx in [0, 16): use precomputed columnFields. For lx == 16: sample fresh.
      const fields =
        lx < CHUNK_SIZE && lz < CHUNK_SIZE
          ? columnFields[lz * CHUNK_SIZE + lx]
          : offsetFactor.fieldsAt(wx, wz);
      for (let cy = 0; cy < CORNERS_Y; cy++) {
        const wy = wyOff + cy * CELL_Y;
        corners[(cy * CORNERS_Z + cz) * CORNERS_X + cx] =
          density.densityFromFields(fields, wx, wy, wz);
      }
    }
  }

  // Step 2: trilerp per voxel; sign-test → solid mask.
  // Index expressions are hoisted out of the innermost loop: `cy`/`cz`-dependent
  // offsets are constant for a whole z- or x-row, so we precompute the four
  // (cy ∈ {0,1}) × (cz ∈ {0,1}) corner-row bases and only add `cx`/`cx+1` inside.
  const CORNERS_PLANE = CORNERS_Z * CORNERS_X;
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const cy = (ly / CELL_Y) | 0;
    const ty = (ly - cy * CELL_Y) / CELL_Y;
    const cyRow0 = cy * CORNERS_PLANE;
    const cyRow1 = (cy + 1) * CORNERS_PLANE;
    const solidLyBase = ly * CHUNK_SIZE * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const cz = (lz / CELL_Z) | 0;
      const tz = (lz - cz * CELL_Z) / CELL_Z;
      const base00 = cyRow0 + cz * CORNERS_X;             // (cy+0, cz+0)
      const base10 = cyRow0 + (cz + 1) * CORNERS_X;       // (cy+0, cz+1)
      const base01 = cyRow1 + cz * CORNERS_X;             // (cy+1, cz+0)
      const base11 = cyRow1 + (cz + 1) * CORNERS_X;       // (cy+1, cz+1)
      const solidRowBase = solidLyBase + lz * CHUNK_SIZE;
      const wz = wzOff + lz;
      const wy = wyOff + ly;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const cx = (lx / CELL_X) | 0;
        const tx = (lx - cx * CELL_X) / CELL_X;
        const wx = wxOff + lx;

        const c00 = corners[base00 + cx] * (1 - tx) + corners[base00 + cx + 1] * tx;
        const c10 = corners[base10 + cx] * (1 - tx) + corners[base10 + cx + 1] * tx;
        const c01 = corners[base01 + cx] * (1 - tx) + corners[base01 + cx + 1] * tx;
        const c11 = corners[base11 + cx] * (1 - tx) + corners[base11 + cx + 1] * tx;
        const c0 = c00 * (1 - tz) + c10 * tz;
        const c1 = c01 * (1 - tz) + c11 * tz;
        const d  = c0 * (1 - ty) + c1 * ty;

        // Per-voxel detail noise. Scaled by both jaggedness (PV+erosion) and
        // spireMask (low-erosion + high-continentalness, i.e. mountain climate).
        // The spireMask term is what lets mountains/windswept get strong enough
        // detail to produce real overhangs without making plains/forests noisy.
        // Active in a y-band around offset so caves/sky stay clean.
        const fields = columnFields[lz * CHUNK_SIZE + lx];
        const dyFromSurface = Math.abs(wy - fields.offset);
        const surfaceEnv = Math.max(0, 1 - dyFromSurface / DETAIL_FALLOFF);
        const dramaAmp = fields.jaggedness * 0.05 + fields.spireMask * 2;
        const detail = detailNoise.perlin3D(wx / DETAIL_SCALE, wy / DETAIL_SCALE, wz / DETAIL_SCALE)
          * DETAIL_AMP * surfaceEnv * dramaAmp;

        solid[solidRowBase + lx] = (d + detail) >= 0 ? 1 : 0;
      }
    }
  }

  return solid;
}
