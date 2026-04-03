import * as THREE from "three";
import { CHUNK_SIZE, type WorldConfig, DEFAULT_CONFIG } from "./chunk";
import type { WorkerRequest, WorkerResponse } from "./worker";

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
    this.inFlight.delete(key);

    // Check if chunk is still needed (might have been unloaded while processing)
    if (this.chunks.has(key)) return; // Already loaded by another path

    if (resp.empty) {
      this.chunks.set(key, { mesh: null });
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(resp.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(resp.normals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(resp.colors, 3));
      geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(resp.cx * CHUNK_SIZE, resp.cy * CHUNK_SIZE, resp.cz * CHUNK_SIZE);
      this.scene.add(mesh);

      this.chunks.set(key, { mesh });
    }

    // Dispatch next queued request
    this.dispatchNext();
  }

  private dispatchNext(): void {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workerBusy[i]) continue;
      const req = this.pendingQueue.shift();
      if (!req) return;
      this.workerBusy[i] = true;
      this.workers[i].postMessage(req);
    }
  }

  private requestChunk(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    if (this.chunks.has(key) || this.inFlight.has(key)) return;

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
   * Vertical range is fixed to Y layers 0 and 1 — the surface sits
   * around baseHeight (32), so chunk 0 (Y 0-31) and chunk 1 (Y 32-63)
   * contain all visible terrain. Layer -1 is added for deep caves.
   */
  update(worldPos: THREE.Vector3, radius: number): void {
    const ccx = Math.floor(worldPos.x / CHUNK_SIZE);
    const ccz = Math.floor(worldPos.z / CHUNK_SIZE);

    // Fixed vertical range: only surface-relevant layers
    const minCY = -1;
    const maxCY = 1;

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
      }
    }
  }

  loadedCount(): number {
    return this.chunks.size;
  }

  pendingCount(): number {
    return this.pendingQueue.length + this.inFlight.size;
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
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.workerBusy.length = 0;
    this.material.dispose();
  }
}
