import { generateChunk, CHUNK_W, WORLD_H, type Chunk, type WorldConfig, DEFAULT_CONFIG } from "./chunk";

/**
 * World manager — handles chunk loading and unloading.
 *
 * Chunks are generated lazily as the camera moves. A chunk cache keeps
 * recently visited chunks in memory. Chunks beyond the retention radius
 * are evicted to keep memory bounded.
 *
 * The world is infinite horizontally but has a fixed height (WORLD_H).
 * Chunk coordinates are integers: chunkX=0 is columns 0..31, chunkX=1
 * is columns 32..63, chunkX=-1 is columns -32..-1, and so on.
 */

const MAX_CACHED_CHUNKS = 64;

export class World {
  readonly config: WorldConfig;
  private chunks = new Map<number, Chunk>();
  private accessOrder: number[] = [];

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get (or generate) the chunk at the given chunk-X index. */
  getChunk(chunkX: number): Chunk {
    let chunk = this.chunks.get(chunkX);
    if (!chunk) {
      chunk = generateChunk(chunkX, this.config);
      this.chunks.set(chunkX, chunk);
    }

    // LRU tracking
    this.accessOrder = this.accessOrder.filter((x) => x !== chunkX);
    this.accessOrder.push(chunkX);

    // Evict oldest if over capacity
    while (this.accessOrder.length > MAX_CACHED_CHUNKS) {
      const evict = this.accessOrder.shift()!;
      this.chunks.delete(evict);
    }

    return chunk;
  }

  /** Read a single block at world coordinates (wx, wy). */
  getBlock(wx: number, wy: number): number {
    if (wy < 0 || wy >= WORLD_H) return 0;
    const chunkX = Math.floor(wx / CHUNK_W);
    const localX = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    return this.getChunk(chunkX)[wy][localX];
  }

  /** Get all chunk X indices currently loaded. */
  loadedChunks(): number[] {
    return Array.from(this.chunks.keys());
  }
}
