import type { DensitySampler } from "./densityField";
import type { OffsetFactorSampler, ColumnFields } from "./offsetFactor";

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
 * Density is evaluated at 5x3x5 = 75 corner samples, then trilinearly interpolated
 * per voxel (sign-tested only — no scalar density retained).
 */
export function fillChunkDensity(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  offsetFactor: OffsetFactorSampler,
  density: DensitySampler,
  /** Pre-computed column fields for the 16x16 footprint, length CHUNK_SIZE^2, indexed lz*CHUNK_SIZE+lx. */
  columnFields: ColumnFields[],
): Uint8Array {
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
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const cx = (lx / CELL_X) | 0;
        const tx = (lx - cx * CELL_X) / CELL_X;

        const c00 = corners[base00 + cx] * (1 - tx) + corners[base00 + cx + 1] * tx;
        const c10 = corners[base10 + cx] * (1 - tx) + corners[base10 + cx + 1] * tx;
        const c01 = corners[base01 + cx] * (1 - tx) + corners[base01 + cx + 1] * tx;
        const c11 = corners[base11 + cx] * (1 - tx) + corners[base11 + cx + 1] * tx;
        const c0 = c00 * (1 - tz) + c10 * tz;
        const c1 = c01 * (1 - tz) + c11 * tz;
        const d  = c0 * (1 - ty) + c1 * ty;

        solid[solidRowBase + lx] = d >= 0 ? 1 : 0;
      }
    }
  }

  return solid;
}
