/**
 * Particle-based hydraulic erosion.
 *
 * Each droplet carries water and sediment. It flows downhill following
 * the heightmap gradient. Where it's moving fast (steep slope), it
 * erodes terrain; where it slows (flat areas, depressions), it deposits.
 *
 * Key parameters:
 * - droplets: total simulated particles (more = smoother, slower)
 * - erosionRate: how aggressively droplets carve into terrain
 * - depositionRate: how quickly sediment settles
 * - evaporationRate: water loss per step (limits droplet lifetime)
 * - gravity: slope-to-speed conversion factor
 *
 * The heightmap is mutated in place.
 *
 * Reference: Sebastian Lague's "Hydraulic Erosion" implementation
 * https://github.com/SebLague/Hydraulic-Erosion
 */

export interface ErosionConfig {
  droplets: number;
  maxLifetime: number;
  inertia: number;       // 0-1, how much of old direction to keep
  erosionRate: number;
  depositionRate: number;
  evaporationRate: number;
  gravity: number;
  minSlope: number;      // prevents infinite erosion on flat areas
  erosionRadius: number; // radius of erosion brush
}

export const DEFAULT_EROSION: ErosionConfig = {
  droplets: 1500,     // reduced from 2000 for better perf/quality balance
  maxLifetime: 48,    // reduced from 64
  inertia: 0.3,
  erosionRate: 0.3,
  depositionRate: 0.3,
  evaporationRate: 0.02,
  gravity: 10,
  minSlope: 0.01,
  erosionRadius: 2,
};

/**
 * Get height at a floating-point position using bilinear interpolation.
 */
function sampleHeight(map: Float64Array, size: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  if (xi < 0 || xi >= size - 1 || yi < 0 || yi >= size - 1) {
    const cx = Math.max(0, Math.min(size - 1, xi));
    const cy = Math.max(0, Math.min(size - 1, yi));
    return map[cy * size + cx];
  }

  const fx = x - xi;
  const fy = y - yi;
  const h00 = map[yi * size + xi];
  const h10 = map[yi * size + xi + 1];
  const h01 = map[(yi + 1) * size + xi];
  const h11 = map[(yi + 1) * size + xi + 1];

  return h00 * (1 - fx) * (1 - fy)
       + h10 * fx * (1 - fy)
       + h01 * (1 - fx) * fy
       + h11 * fx * fy;
}

/**
 * Compute gradient (dh/dx, dh/dy) at a floating-point position.
 */
function sampleGradient(map: Float64Array, size: number, x: number, y: number): [number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  if (xi < 0 || xi >= size - 1 || yi < 0 || yi >= size - 1) {
    return [0, 0];
  }

  const fx = x - xi;
  const fy = y - yi;
  const h00 = map[yi * size + xi];
  const h10 = map[yi * size + xi + 1];
  const h01 = map[(yi + 1) * size + xi];
  const h11 = map[(yi + 1) * size + xi + 1];

  const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
  const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

  return [gx, gy];
}

/**
 * Precompute erosion brush weights for a given radius.
 * Returns arrays of relative offsets and corresponding weights.
 */
function buildBrush(radius: number): { offsets: [number, number][]; weights: number[] } {
  const offsets: [number, number][] = [];
  const weights: number[] = [];
  let total = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const w = Math.max(0, radius - dist);
        offsets.push([dx, dy]);
        weights.push(w);
        total += w;
      }
    }
  }

  for (let i = 0; i < weights.length; i++) weights[i] /= total;

  return { offsets, weights };
}

/**
 * Run hydraulic erosion on a heightmap in place.
 *
 * Droplets are spawned deterministically per *world* cell, not per chunk.
 * The same world cell yields the same droplet (spawn position, sub-cell
 * offset, and therefore trajectory) regardless of which chunk's padded
 * heightmap is being eroded. This eliminates one source of chunk-grid
 * artifacts: when neighbouring chunks' pads overlap, the shared cells
 * contribute identical droplet histories on both sides of the seam.
 *
 * (Droplets that originate outside a chunk's pad still don't reach it,
 * so a residual seam can remain — that's addressed by enlarging the pad.)
 *
 * @param map           Float64Array of size*size heights (row-major, z*size+x)
 * @param size          Width and height of the heightmap
 * @param worldOriginX  World X coordinate of map column 0
 * @param worldOriginZ  World Z coordinate of map row 0
 * @param config        Erosion parameters
 * @param worldSeed     World seed; mixed into the per-cell hashes
 */
export function erode(
  map: Float64Array,
  size: number,
  worldOriginX: number,
  worldOriginZ: number,
  config: ErosionConfig = DEFAULT_EROSION,
  worldSeed: number = 42,
): void {
  const { offsets, weights } = buildBrush(config.erosionRadius);

  const margin = config.erosionRadius + 1;
  // Fixed reference area decouples the user-facing `droplets` value from
  // pad size: enlarging the pad no longer dilutes per-world-cell density,
  // so a `droplets=50` setting produces the same visual intensity whether
  // the pad is 8 or 48. 676 = 26² (interior of the historical pad=8).
  const REF_INTERIOR_AREA = 676;
  const density = config.droplets / REF_INTERIOR_AREA;
  const seedMix = worldSeed | 0;

  // Three independent hashes per (wx, wz): spawn coin, sub-cell X, sub-cell Y.
  // Plain integer-mix hashes — same form used elsewhere in the project.
  const hash01 = (wx: number, wz: number, salt: number): number => {
    let h = (Math.imul(wx | 0, 374761393) ^ Math.imul(wz | 0, 668265263) ^ Math.imul(seedMix ^ salt, 2654435761)) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  };

  // Iterate every interior cell of the padded heightmap. Each world cell
  // either spawns one droplet (with deterministic sub-cell offset) or not.
  // Iteration order (row-major in world coords) is identical for any chunk
  // whose pad covers this region, so droplet ordering is consistent across
  // chunks for the cells they share.
  for (let py = margin; py < size - margin; py++) {
    const wz = worldOriginZ + py;
    for (let px = margin; px < size - margin; px++) {
      const wx = worldOriginX + px;
      if (hash01(wx, wz, 0) >= density) continue;

      let posX = px + hash01(wx, wz, 0x9e3779b1);
      let posY = py + hash01(wx, wz, 0x85ebca6b);
      let dirX = 0;
      let dirY = 0;
      let speed = 0;
      let water = 1;
      let sediment = 0;

      for (let life = 0; life < config.maxLifetime; life++) {
        const xi = Math.floor(posX);
        const yi = Math.floor(posY);

        if (xi < margin || xi >= size - margin || yi < margin || yi >= size - margin) break;

        const oldHeight = sampleHeight(map, size, posX, posY);
        const [gx, gy] = sampleGradient(map, size, posX, posY);

        // Update direction with inertia
        dirX = dirX * config.inertia - gx * (1 - config.inertia);
        dirY = dirY * config.inertia - gy * (1 - config.inertia);

        // Normalise direction
        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
        if (dirLen < 1e-8) break; // stuck in a pit
        dirX /= dirLen;
        dirY /= dirLen;

        // Move
        const newX = posX + dirX;
        const newY = posY + dirY;
        const newHeight = sampleHeight(map, size, newX, newY);
        const heightDiff = newHeight - oldHeight;

        // Capacity: how much sediment water can carry (more when fast and steep)
        const slope = Math.max(-heightDiff, config.minSlope);
        const capacity = Math.max(slope * speed * water * 8, config.minSlope);

        if (sediment > capacity || heightDiff > 0) {
          // Deposit sediment
          const depositAmount = heightDiff > 0
            ? Math.min(sediment, heightDiff) // fill up to new height when going uphill
            : (sediment - capacity) * config.depositionRate;

          sediment -= depositAmount;

          // Deposit on the 4 surrounding cells (bilinear)
          const fx = posX - xi;
          const fy = posY - yi;
          map[yi * size + xi]           += depositAmount * (1 - fx) * (1 - fy);
          map[yi * size + xi + 1]       += depositAmount * fx * (1 - fy);
          map[(yi + 1) * size + xi]     += depositAmount * (1 - fx) * fy;
          map[(yi + 1) * size + xi + 1] += depositAmount * fx * fy;
        } else {
          // Erode terrain using the brush
          const erodeAmount = Math.min(
            (capacity - sediment) * config.erosionRate,
            -heightDiff + 0.001, // don't erode below new position
          );

          for (let b = 0; b < offsets.length; b++) {
            const [bx, by] = offsets[b];
            const mx = xi + bx;
            const my = yi + by;
            if (mx >= 0 && mx < size && my >= 0 && my < size) {
              map[my * size + mx] -= erodeAmount * weights[b];
            }
          }

          sediment += erodeAmount;
        }

        // Update speed and water
        speed = Math.sqrt(Math.max(0, speed * speed - heightDiff * config.gravity));
        water *= (1 - config.evaporationRate);

        posX = newX;
        posY = newY;
      }
    }
  }
}
