import { CHUNK_SIZE, chunkIndex } from "./chunk";
import { BLOCK_DEFS } from "./blocks";

function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

function worldToChunk(w: number): number {
  return Math.floor(w / CHUNK_SIZE);
}

function worldToLocal(w: number): number {
  return ((w % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

interface ChunkEntry {
  blockData: Uint8Array | null;
}

export class LightEngine {
  private lightGrid = new Map<string, Uint8Array>();

  /**
   * Re-run the full BFS over all currently loaded chunks.
   * Returns the set of chunk keys whose light values changed.
   */
  recompute(chunks: Map<string, ChunkEntry>): Set<string> {
    // Snapshot old light values for dirty detection
    const oldGrid = new Map<string, Uint8Array>();
    for (const [key, arr] of this.lightGrid) {
      oldGrid.set(key, new Uint8Array(arr));
    }

    // Reset light grid to zero for all loaded chunks
    this.lightGrid.clear();
    for (const [key] of chunks) {
      this.lightGrid.set(key, new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE));
    }

    // Helper: get block id at world coords (returns -1 if chunk unloaded)
    const getBlock = (wx: number, wy: number, wz: number): number => {
      const key = chunkKey(worldToChunk(wx), worldToChunk(wy), worldToChunk(wz));
      const chunk = chunks.get(key);
      if (!chunk || !chunk.blockData) return -1;
      const lx = worldToLocal(wx);
      const ly = worldToLocal(wy);
      const lz = worldToLocal(wz);
      return chunk.blockData[chunkIndex(lx, ly, lz)];
    };

    // Helper: get current light level at world coords
    const getLight = (wx: number, wy: number, wz: number): number => {
      const key = chunkKey(worldToChunk(wx), worldToChunk(wy), worldToChunk(wz));
      const arr = this.lightGrid.get(key);
      if (!arr) return 0;
      const lx = worldToLocal(wx);
      const ly = worldToLocal(wy);
      const lz = worldToLocal(wz);
      return arr[chunkIndex(lx, ly, lz)];
    };

    // Helper: set light level at world coords
    const setLight = (wx: number, wy: number, wz: number, level: number): void => {
      const key = chunkKey(worldToChunk(wx), worldToChunk(wy), worldToChunk(wz));
      const arr = this.lightGrid.get(key);
      if (!arr) return;
      const lx = worldToLocal(wx);
      const ly = worldToLocal(wy);
      const lz = worldToLocal(wz);
      arr[chunkIndex(lx, ly, lz)] = level;
    };

    // Helper: is a block transparent (passes light)?
    const isTransparent = (blockId: number): boolean => {
      if (blockId < 0) return false; // unloaded = opaque
      const def = BLOCK_DEFS[blockId];
      return def ? def.transparent : false;
    };

    // BFS queue: [wx, wy, wz, level]
    const queue: Array<[number, number, number, number]> = [];

    // ── Seed 1: Skylight ────────────────────────────────────────────────────
    // For each (cx, cz) column of loaded chunks, find the highest loaded Y,
    // then scan downward. All transparent blocks above the first opaque block
    // receive light level 15.
    const columnMap = new Map<string, { minCY: number; maxCY: number }>();
    for (const key of chunks.keys()) {
      const [cx, cy, cz] = key.split(",").map(Number);
      const colKey = `${cx},${cz}`;
      const existing = columnMap.get(colKey);
      if (!existing) {
        columnMap.set(colKey, { minCY: cy, maxCY: cy });
      } else {
        existing.minCY = Math.min(existing.minCY, cy);
        existing.maxCY = Math.max(existing.maxCY, cy);
      }
    }

    for (const [colKey, { minCY, maxCY }] of columnMap) {
      const [cx, cz] = colKey.split(",").map(Number);
      const wxBase = cx * CHUNK_SIZE;
      const wzBase = cz * CHUNK_SIZE;

      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const wx = wxBase + lx;
          const wz = wzBase + lz;

          let inSky = true;
          // Scan from top of highest chunk downward
          for (let cy = maxCY; cy >= minCY; cy--) {
            const wyBase = cy * CHUNK_SIZE;
            for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
              const wy = wyBase + ly;
              const blockId = getBlock(wx, wy, wz);
              if (blockId < 0) { inSky = false; continue; } // unloaded = treat as opaque
              if (inSky && isTransparent(blockId)) {
                setLight(wx, wy, wz, 15);
                queue.push([wx, wy, wz, 15]);
              } else {
                inSky = false;
              }
            }
          }
        }
      }
    }

    // ── Seed 2: Block lights ────────────────────────────────────────────────
    for (const [key, chunk] of chunks) {
      if (!chunk.blockData) continue;
      const [cx, cy, cz] = key.split(",").map(Number);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const blockId = chunk.blockData[chunkIndex(lx, ly, lz)];
            const def = BLOCK_DEFS[blockId];
            if (!def || def.lightEmit === 0) continue;
            const wx = cx * CHUNK_SIZE + lx;
            const wy = cy * CHUNK_SIZE + ly;
            const wz = cz * CHUNK_SIZE + lz;
            if (def.lightEmit > getLight(wx, wy, wz)) {
              setLight(wx, wy, wz, def.lightEmit);
              queue.push([wx, wy, wz, def.lightEmit]);
            }
          }
        }
      }
    }

    // ── BFS propagation ─────────────────────────────────────────────────────
    const neighbors: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];

    let head = 0;
    while (head < queue.length) {
      const [wx, wy, wz, level] = queue[head++];
      if (level <= 1) continue;
      const next = level - 1;

      for (const [dx, dy, dz] of neighbors) {
        const nx = wx + dx;
        const ny = wy + dy;
        const nz = wz + dz;

        const blockId = getBlock(nx, ny, nz);
        if (!isTransparent(blockId)) continue;
        if (getLight(nx, ny, nz) >= next) continue;

        setLight(nx, ny, nz, next);
        queue.push([nx, ny, nz, next]);
      }
    }

    // ── Dirty detection ─────────────────────────────────────────────────────
    const dirty = new Set<string>();
    for (const [key, newArr] of this.lightGrid) {
      const old = oldGrid.get(key);
      if (!old) {
        dirty.add(key);
        continue;
      }
      for (let i = 0; i < newArr.length; i++) {
        if (newArr[i] !== old[i]) {
          dirty.add(key);
          break;
        }
      }
    }

    return dirty;
  }

  /** Returns a copy of the light data for a chunk (for sending to workers). */
  getLightData(key: string): Uint8Array | null {
    const arr = this.lightGrid.get(key);
    return arr ? new Uint8Array(arr) : null;
  }
}
