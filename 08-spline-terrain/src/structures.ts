import { Block } from "./blocks";
import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";

/**
 * Procedural structure placement.
 *
 * In the 3D coordinate system, Y increases upward — so structures
 * grow in the +Y direction from the surface.
 */

type SetBlock = (lx: number, ly: number, lz: number, block: number) => void;

function makeSetter(data: ChunkData, overwrite = false): SetBlock {
  return (lx, ly, lz, block) => {
    if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    const idx = chunkIndex(lx, ly, lz);
    if (overwrite || data[idx] === Block.Air) {
      data[idx] = block;
    }
  };
}

/** Force-set a block (overwrites any existing block including solid) */
function makeForcer(data: ChunkData): SetBlock {
  return (lx, ly, lz, block) => {
    if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    data[chunkIndex(lx, ly, lz)] = block;
  };
}

// ── Trees ──────────────────────────────────────────────────────

export function placeOakTree(data: ChunkData, x: number, surfaceY: number, z: number, woodBlock: number, leafBlock: number, seedX: number = x, seedZ: number = z): void {
  const set = makeSetter(data);
  const trunkH = 4 + (((seedX * 73 + seedZ * 37) & 3));

  for (let dy = 1; dy <= trunkH; dy++) set(x, surfaceY + dy, z, woodBlock);

  const canopyY = surfaceY + trunkH;
  const r = 2;
  for (let dy = -1; dy <= r; dy++) {
    const layerR = dy <= 0 ? r : r - dy;
    for (let dx = -layerR; dx <= layerR; dx++) {
      for (let dz = -layerR; dz <= layerR; dz++) {
        if (dx * dx + dz * dz <= layerR * layerR + 1) {
          set(x + dx, canopyY + dy, z + dz, leafBlock);
        }
      }
    }
  }
}

export function placeSpruceTree(data: ChunkData, x: number, surfaceY: number, z: number, woodBlock: number, leafBlock: number, seedX: number = x, seedZ: number = z): void {
  const set = makeSetter(data);
  const trunkH = 6 + (((seedX * 53 + seedZ * 29) & 3));

  for (let dy = 1; dy <= trunkH; dy++) set(x, surfaceY + dy, z, woodBlock);

  const canopyStart = trunkH - 1;
  const canopyH = trunkH - 2;
  for (let dy = 0; dy < canopyH; dy++) {
    const layerR = Math.max(0, Math.floor((canopyH - dy) / 2));
    const py = surfaceY + canopyStart + dy;
    for (let dx = -layerR; dx <= layerR; dx++) {
      for (let dz = -layerR; dz <= layerR; dz++) {
        if (Math.abs(dx) + Math.abs(dz) <= layerR + 1) {
          set(x + dx, py, z + dz, leafBlock);
        }
      }
    }
  }
  set(x, surfaceY + trunkH + 1, z, leafBlock);
}

export function placeBirchTree(data: ChunkData, x: number, surfaceY: number, z: number, woodBlock: number, leafBlock: number, seedX: number = x, seedZ: number = z): void {
  const set = makeSetter(data);
  const trunkH = 5 + (((seedX * 61 + seedZ * 43) & 3));

  for (let dy = 1; dy <= trunkH; dy++) set(x, surfaceY + dy, z, woodBlock);

  const canopyY = surfaceY + trunkH;
  for (let dy = -1; dy <= 1; dy++) {
    const layerR = dy === 0 ? 2 : 1;
    for (let dx = -layerR; dx <= layerR; dx++) {
      for (let dz = -layerR; dz <= layerR; dz++) {
        if (dx * dx + dz * dz <= layerR * layerR + 1) {
          set(x + dx, canopyY + dy, z + dz, leafBlock);
        }
      }
    }
  }
}

export function placeCactus(data: ChunkData, x: number, surfaceY: number, z: number, seedX: number = x, seedZ: number = z): void {
  const set = makeSetter(data);
  const h = 2 + (((seedX * 47 + seedZ * 31) & 1));
  for (let dy = 1; dy <= h; dy++) set(x, surfaceY + dy, z, Block.Cactus);
}

// ── Pyramid ────────────────────────────────────────────────────

/**
 * Desert pyramid — stepped sandstone structure with a hollow interior.
 * Base is ~11x11, rises 6 blocks. Placement anchored at center (x, z).
 */
export function placePyramid(data: ChunkData, cx: number, surfaceY: number, cz: number): void {
  const force = makeForcer(data);
  const baseR = 5;
  const height = 6;

  for (let dy = 0; dy < height; dy++) {
    const r = baseR - dy;
    if (r < 0) break;
    const y = surfaceY + dy + 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const lx = cx + dx;
        const lz = cz + dz;
        // Shell only (hollow inside from dy=1)
        const isEdge = Math.abs(dx) === r || Math.abs(dz) === r || dy === 0;
        if (isEdge) {
          force(lx, y, lz, Block.Sandstone);
        } else if (dy > 0) {
          force(lx, y, lz, Block.Air);
        }
      }
    }
  }
  // Top cap
  force(cx, surfaceY + height + 1, cz, Block.Sandstone);
}

// ── Igloo ──────────────────────────────────────────────────────

/**
 * Igloo — half-sphere dome of snow bricks with a hollow interior.
 * Radius 3, entrance on the +X side.
 */
export function placeIgloo(data: ChunkData, cx: number, surfaceY: number, cz: number): void {
  const force = makeForcer(data);
  const r = 3;

  for (let dy = 0; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist2 = dx * dx + dy * dy + dz * dz;
        const y = surfaceY + dy + 1;
        const lx = cx + dx;
        const lz = cz + dz;

        if (dist2 <= r * r + 1 && dist2 > (r - 1) * (r - 1)) {
          // Shell
          force(lx, y, lz, Block.SnowBrick);
        } else if (dist2 <= (r - 1) * (r - 1) && dy > 0) {
          // Hollow interior
          force(lx, y, lz, Block.Air);
        }
      }
    }
  }

  // Floor
  for (let dx = -(r - 1); dx <= r - 1; dx++) {
    for (let dz = -(r - 1); dz <= r - 1; dz++) {
      if (dx * dx + dz * dz <= (r - 1) * (r - 1)) {
        force(cx + dx, surfaceY + 1, cz + dz, Block.SnowBrick);
      }
    }
  }

  // Entrance (cut a 1x2 opening on +X side)
  force(cx + r, surfaceY + 2, cz, Block.Air);
  force(cx + r, surfaceY + 3, cz, Block.Air);
}

// ── Village house ──────────────────────────────────────────────

/**
 * Small village house — 5x5 cobblestone base, oak plank walls,
 * oak wood roof, with a door and window.
 */
export function placeHouse(data: ChunkData, cx: number, surfaceY: number, cz: number): void {
  const force = makeForcer(data);
  const w = 5; // width/depth
  const wallH = 4;

  // Foundation + floor
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < w; dz++) {
      force(cx + dx, surfaceY, cz + dz, Block.Cobblestone);
      force(cx + dx, surfaceY + 1, cz + dz, Block.OakPlanks);
    }
  }

  // Walls
  for (let dy = 2; dy <= wallH; dy++) {
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < w; dz++) {
        const isWall = dx === 0 || dx === w - 1 || dz === 0 || dz === w - 1;
        if (isWall) {
          force(cx + dx, surfaceY + dy, cz + dz, Block.OakPlanks);
        } else {
          force(cx + dx, surfaceY + dy, cz + dz, Block.Air);
        }
      }
    }
  }

  // Roof (flat oak wood)
  for (let dx = -1; dx <= w; dx++) {
    for (let dz = -1; dz <= w; dz++) {
      force(cx + dx, surfaceY + wallH + 1, cz + dz, Block.OakWood);
    }
  }

  // Door (front wall, +X side, 2 blocks tall)
  force(cx + w - 1, surfaceY + 2, cz + 2, Block.Air);
  force(cx + w - 1, surfaceY + 3, cz + 2, Block.Air);

  // Windows (side walls)
  force(cx, surfaceY + 3, cz + 2, Block.Glass);        // left wall
  force(cx + 2, surfaceY + 3, cz, Block.Glass);         // back wall
  force(cx + 2, surfaceY + 3, cz + w - 1, Block.Glass); // front wall
}
