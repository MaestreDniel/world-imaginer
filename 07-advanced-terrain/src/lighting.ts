import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS } from "./blocks";

function isTransparent(blockId: number): boolean {
  const def = BLOCK_DEFS[blockId];
  return def ? def.transparent : false;
}

export function computeChunkLocalLight(data: ChunkData): Uint8Array {
  const light = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  const queue: Array<[number, number, number, number]> = [];

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let inSky = true;
      for (let y = CHUNK_SIZE - 1; y >= 0; y--) {
        const idx = chunkIndex(x, y, z);
        const blockId = data[idx];
        if (inSky && isTransparent(blockId)) {
          light[idx] = 15;
          queue.push([x, y, z, 15]);
          continue;
        }
        inSky = false;
      }
    }
  }

  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = chunkIndex(x, y, z);
        const emit = BLOCK_DEFS[data[idx]]?.lightEmit ?? 0;
        if (emit === 0 || emit <= light[idx]) continue;
        light[idx] = emit;
        queue.push([x, y, z, emit]);
      }
    }
  }

  const neighbors: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ];

  let head = 0;
  while (head < queue.length) {
    const [x, y, z, level] = queue[head++];
    if (level <= 1) continue;

    const next = level - 1;
    for (const [dx, dy, dz] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (
        nx < 0 || nx >= CHUNK_SIZE ||
        ny < 0 || ny >= CHUNK_SIZE ||
        nz < 0 || nz >= CHUNK_SIZE
      ) {
        continue;
      }

      const idx = chunkIndex(nx, ny, nz);
      if (!isTransparent(data[idx])) continue;
      if (light[idx] >= next) continue;

      light[idx] = next;
      queue.push([nx, ny, nz, next]);
    }
  }

  return light;
}
