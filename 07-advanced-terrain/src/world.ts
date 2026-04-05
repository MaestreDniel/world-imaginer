import * as THREE from "three";
import { CHUNK_SIZE, chunkIndex, type WorldConfig, DEFAULT_CONFIG } from "./chunk";
import { BLOCK_DEFS } from "./blocks";
import type { WorkerRequest, WorkerResponse } from "./worker";
import { LightEngine } from "./lighting";

/**
 * 3D world manager — optimised with Web Workers.
 *
 * Key optimisations over the initial version:
 *
 * 1. **Web Worker pool** — Generation and meshing run off the main
 *    thread. The pool size matches navigator.hardwareConcurrency
 *    (typically 4-8 workers) for true parallelism.
 *
 * 2. **Smart vertical range** — Only loads chunk Y layers that can
 *    contain visible geometry (surface ± 1 chunk). Deep underground
 *    chunks that are fully enclosed are skipped entirely.
 *
 * 3. **Async queue** — Chunk requests are queued and dispatched to
 *    available workers. The main thread never blocks waiting for
 *    chunk data.
 */

function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

interface LoadedChunk {
  mesh: THREE.Mesh | null;
  blockData: Uint8Array | null;
  grassColors: Uint32Array | null;  // needed for light-pass re-meshing
}

export class World {
  readonly config: WorldConfig;
  private chunks = new Map<string, LoadedChunk>();
  private scene: THREE.Scene;
  private material: THREE.MeshLambertMaterial;
  private workers: Worker[] = [];
  private workerBusy: boolean[] = [];
  private pendingQueue: WorkerRequest[] = [];
  private inFlight = new Set<string>();
  private nextId = 0;
  private lightEngine = new LightEngine();
  private lightDirty = false;
  private remeshInFlight = new Set<string>();

  constructor(scene: THREE.Scene, config: Partial<WorldConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = scene;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

    // Spawn worker pool
    const count = Math.min(navigator.hardwareConcurrency || 4, 8);
    for (let i = 0; i < count; i++) {
      const worker = new Worker(
        new URL("./worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.onWorkerResult(i, e.data);
      };
      this.workers.push(worker);
      this.workerBusy.push(false);
    }
  }

  private onWorkerResult(workerIdx: number, resp: WorkerResponse): void {
    this.workerBusy[workerIdx] = false;

    const key = chunkKey(resp.cx, resp.cy, resp.cz);

    // Re-mesh response: swap geometry and return
    if (this.remeshInFlight.has(key)) {
      this.remeshInFlight.delete(key);
      const existing = this.chunks.get(key);
      if (existing) {
        if (!resp.empty) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(resp.positions, 3));
          geometry.setAttribute("normal", new THREE.Float32BufferAttribute(resp.normals, 3));
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(resp.colors, 3));
          geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));

          if (existing.mesh) {
            existing.mesh.geometry.dispose();
            existing.mesh.geometry = geometry;
          } else {
            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.position.set(resp.cx * CHUNK_SIZE, resp.cy * CHUNK_SIZE, resp.cz * CHUNK_SIZE);
            this.scene.add(mesh);
            existing.mesh = mesh;
          }
        }
        // blockData and grassColors are NOT updated — keep originals
      }
      this.dispatchNext();

      // After remesh, check if a new light pass is needed (more chunks may have loaded)
      if (
        this.pendingQueue.length === 0 &&
        this.inFlight.size === 0 &&
        this.remeshInFlight.size === 0 &&
        this.lightDirty
      ) {
        this.runLightPass();
      }

      return;
    }

    this.inFlight.delete(key);

    // Check if chunk is still needed (might have been unloaded while processing)
    if (this.chunks.has(key)) { this.dispatchNext(); return; }

    if (resp.empty) {
      this.chunks.set(key, { mesh: null, blockData: resp.blockData, grassColors: resp.grassColors });
      this.lightDirty = true;
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(resp.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(resp.normals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(resp.colors, 3));
      geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(resp.cx * CHUNK_SIZE, resp.cy * CHUNK_SIZE, resp.cz * CHUNK_SIZE);
      this.scene.add(mesh);

      this.chunks.set(key, { mesh, blockData: resp.blockData, grassColors: resp.grassColors });
      this.lightDirty = true;
    }

    // Dispatch next queued request
    this.dispatchNext();

    if (
      this.pendingQueue.length === 0 &&
      this.inFlight.size === 0 &&
      this.remeshInFlight.size === 0 &&
      this.lightDirty
    ) {
      this.runLightPass();
    }
  }

  private dispatchNext(): void {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workerBusy[i]) continue;
      const req = this.pendingQueue.shift();
      if (!req) return;
      this.workerBusy[i] = true;
      // Transfer typed array buffers for remesh requests to avoid serialisation cost
      const transfers: Transferable[] = [];
      if (req.blockData)   transfers.push(req.blockData.buffer);
      if (req.grassColors) transfers.push(req.grassColors.buffer);
      if (req.lightData)   transfers.push(req.lightData.buffer);
      this.workers[i].postMessage(req, transfers.length ? { transfer: transfers } : undefined);
    }
  }

  private runLightPass(): void {
    this.lightDirty = false;

    const dirty = this.lightEngine.recompute(this.chunks);

    for (const key of dirty) {
      const chunk = this.chunks.get(key);
      if (!chunk || !chunk.blockData || !chunk.grassColors) continue;
      if (this.remeshInFlight.has(key)) continue;

      const [cx, cy, cz] = key.split(",").map(Number);
      const lightData = this.lightEngine.getLightData(key);
      if (!lightData) continue;

      this.remeshInFlight.add(key);

      const req: WorkerRequest = {
        id: this.nextId++,
        cx, cy, cz,
        config: this.config,
        remesh: true,
        blockData: new Uint8Array(chunk.blockData),
        grassColors: new Uint32Array(chunk.grassColors),
        lightData,
      };

      // Dispatch to a free worker, or queue if all busy
      let dispatched = false;
      for (let i = 0; i < this.workers.length; i++) {
        if (this.workerBusy[i]) continue;
        this.workerBusy[i] = true;
        this.workers[i].postMessage(req, {
          transfer: [req.blockData!.buffer, req.grassColors!.buffer, req.lightData!.buffer],
        });
        dispatched = true;
        break;
      }
      if (!dispatched) {
        this.pendingQueue.push(req);
      }
    }
  }

  private requestChunk(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    if (this.chunks.has(key) || this.inFlight.has(key) || this.remeshInFlight.has(key)) return;

    this.inFlight.add(key);
    const req: WorkerRequest = {
      id: this.nextId++,
      cx, cy, cz,
      config: this.config,
    };
    this.pendingQueue.push(req);
    this.dispatchNext();
  }

  /**
   * Update loaded chunks around a world-space position.
   *
   * With waterLevel=0 and baseHeight=0, terrain spans roughly Y=-14
   * (ocean floor) to Y=+50 (mountain peaks). Chunk layers:
   *   CY -1: Y -32 to -1  (ocean floor, underground)
   *   CY  0: Y   0 to 31  (sea level, most surface)
   *   CY  1: Y  32 to 63  (mountain peaks, tall trees)
   *   CY  2: Y  64 to 95  (safety margin, mostly empty)
   */
  update(worldPos: THREE.Vector3, radius: number): void {
    const ccx = Math.floor(worldPos.x / CHUNK_SIZE);
    const ccz = Math.floor(worldPos.z / CHUNK_SIZE);

    const minCY = -2;
    const maxCY = 4;

    const needed = new Set<string>();
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Circular radius check (skip corners of the square)
          if (dx * dx + dz * dz > (radius + 0.5) * (radius + 0.5)) continue;

          const cx = ccx + dx;
          const cz = ccz + dz;
          const key = chunkKey(cx, cy, cz);
          needed.add(key);

          if (!this.chunks.has(key) && !this.inFlight.has(key)) {
            this.requestChunk(cx, cy, cz);
          }
        }
      }
    }

    // Unload distant chunks
    const unloadR2 = (radius + 3) * (radius + 3);
    for (const [key, entry] of this.chunks) {
      if (needed.has(key)) continue;
      const [cx, cy, cz] = key.split(",").map(Number);
      const dx = cx - ccx, dz = cz - ccz;
      if (dx * dx + dz * dz > unloadR2 || cy < minCY - 1 || cy > maxCY + 1) {
        if (entry.mesh) {
          this.scene.remove(entry.mesh);
          entry.mesh.geometry.dispose();
        }
        this.chunks.delete(key);
        this.lightDirty = true;
      }
    }
  }

  /** Returns the block id at the given world-space integer position.
   *  Unloaded chunks are treated as solid to prevent falling through. */
  getBlock(wx: number, wy: number, wz: number): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cy, cz));
    if (!chunk) return 1; // unloaded → treat as solid (Block.Grass = 1)
    if (!chunk.blockData) return 0; // empty chunk → air
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.blockData[chunkIndex(lx, ly, lz)];
  }

  isSolid(wx: number, wy: number, wz: number): boolean {
    return BLOCK_DEFS[this.getBlock(wx, wy, wz)]?.solid ?? false;
  }

  loadedCount(): number {
    return this.chunks.size;
  }

  pendingCount(): number {
    return this.pendingQueue.length + this.inFlight.size + this.remeshInFlight.size;
  }

  dispose(): void {
    for (const [, entry] of this.chunks) {
      if (entry.mesh) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
      }
    }
    this.chunks.clear();
    this.pendingQueue.length = 0;
    this.inFlight.clear();
    this.remeshInFlight.clear();
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.workerBusy.length = 0;
    this.material.dispose();
  }
}
