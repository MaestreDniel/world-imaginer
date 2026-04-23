// 08-spline-terrain/src/lighting.ts
import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS } from "./blocks";

export interface ChunkLightData {
  sky:   Uint8Array;  // 0..15 per voxel
  block: Uint8Array;  // 0..15 per voxel
}

function isTransparent(blockId: number): boolean {
  const def = BLOCK_DEFS[blockId];
  return def ? def.transparent : false;
}

const NEIGHBORS: Array<[number, number, number]> = [
  [ 1, 0, 0], [-1, 0, 0],
  [ 0, 1, 0], [ 0,-1, 0],
  [ 0, 0, 1], [ 0, 0,-1],
];

function propagate(light: Uint8Array, data: ChunkData, queue: Array<[number, number, number, number]>): void {
  let head = 0;
  while (head < queue.length) {
    const [x, y, z, level] = queue[head++];
    if (level <= 1) continue;
    const next = level - 1;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= CHUNK_SIZE ||
          ny < 0 || ny >= CHUNK_SIZE ||
          nz < 0 || nz >= CHUNK_SIZE) continue;
      const idx = chunkIndex(nx, ny, nz);
      if (!isTransparent(data[idx])) continue;
      if (light[idx] >= next) continue;
      light[idx] = next;
      queue.push([nx, ny, nz, next]);
    }
  }
}

export function computeChunkLocalLight(data: ChunkData): ChunkLightData {
  const sky   = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  const block = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const skyQueue:   Array<[number, number, number, number]> = [];
  const blockQueue: Array<[number, number, number, number]> = [];

  // ── Sky pass: seed from sky-exposed transparent columns.
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let inSky = true;
      for (let y = CHUNK_SIZE - 1; y >= 0; y--) {
        const idx = chunkIndex(x, y, z);
        const blockId = data[idx];
        if (inSky && isTransparent(blockId)) {
          sky[idx] = 15;
          skyQueue.push([x, y, z, 15]);
          continue;
        }
        inSky = false;
      }
    }
  }

  // ── Block pass: seed from emitters.
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = chunkIndex(x, y, z);
        const emit = BLOCK_DEFS[data[idx]]?.lightEmit ?? 0;
        if (emit === 0) continue;
        if (emit > block[idx]) {
          block[idx] = emit;
          blockQueue.push([x, y, z, emit]);
        }
      }
    }
  }

  propagate(sky,   data, skyQueue);
  propagate(block, data, blockQueue);

  return { sky, block };
}
