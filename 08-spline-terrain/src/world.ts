import * as THREE from "three";
import { CHUNK_SIZE, chunkIndex, type WorldConfig, DEFAULT_CONFIG } from "./chunk";
import { BLOCK_DEFS } from "./blocks";
import { buildAtlasTexture } from "./textureAtlas";
import type { WorkerRequest, WorkerResponse } from "./worker";
import { sharedDayNightUniforms } from "./dayNight";

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
  grassColors: Uint32Array | null;
  skyLight: Uint8Array | null;
  blockLight: Uint8Array | null;
}

export class World {
  readonly config: WorldConfig;
  private chunks = new Map<string, LoadedChunk>();
  private scene: THREE.Scene;
  private atlasTexture: THREE.CanvasTexture;
  private material: THREE.MeshLambertMaterial;
  private workers: Worker[] = [];
  private workerBusy: boolean[] = [];
  private pendingQueue: WorkerRequest[] = [];
  private inFlight = new Set<string>();
  private nextId = 0;

  constructor(scene: THREE.Scene, config: Partial<WorldConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = scene;
    this.atlasTexture = buildAtlasTexture();
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: this.atlasTexture,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTimeOfDay = sharedDayNightUniforms.uTimeOfDay;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
       attribute float aSkyLight;
       attribute float aBlockLight;
       uniform float uTimeOfDay;
       varying float vLightFactor;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
       float _combined = max(aBlockLight, aSkyLight * uTimeOfDay);
       vLightFactor = 0.2 + (_combined / 15.0) * 0.8;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
       varying float vLightFactor;`,
        )
        .replace(
          "#include <tonemapping_fragment>",
          `gl_FragColor.rgb *= vLightFactor;
       #include <tonemapping_fragment>`,
        );
    };

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
    if (this.chunks.has(key)) { this.dispatchNext(); return; }

    if (resp.empty) {
      this.chunks.set(key, {
        mesh: null,
        blockData: resp.blockData,
        grassColors: resp.grassColors,
        skyLight: resp.sky,
        blockLight: resp.block,
      });
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position",    new THREE.Float32BufferAttribute(resp.positions, 3));
      geometry.setAttribute("normal",      new THREE.Float32BufferAttribute(resp.normals, 3));
      geometry.setAttribute("color",       new THREE.Float32BufferAttribute(resp.colors, 3));
      geometry.setAttribute("uv",          new THREE.Float32BufferAttribute(resp.uvs, 2));
      geometry.setAttribute("aSkyLight",   new THREE.Float32BufferAttribute(resp.skyLightAttr, 1));
      geometry.setAttribute("aBlockLight", new THREE.Float32BufferAttribute(resp.blockLightAttr, 1));
      geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(resp.cx * CHUNK_SIZE, resp.cy * CHUNK_SIZE, resp.cz * CHUNK_SIZE);
      this.scene.add(mesh);

      this.chunks.set(key, {
        mesh,
        blockData: resp.blockData,
        grassColors: resp.grassColors,
        skyLight: resp.sky,
        blockLight: resp.block,
      });
    }

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

    const { minHeight, maxHeight } = this.config.params.extent;
    const minCY = Math.floor(minHeight / CHUNK_SIZE) - 1;
    const maxCY = Math.ceil(maxHeight / CHUNK_SIZE) + 1;

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
    this.atlasTexture.dispose();
    this.material.dispose();
  }
}
