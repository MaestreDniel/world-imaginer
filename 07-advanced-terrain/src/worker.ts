/**
 * Web Worker for off-thread chunk generation and meshing.
 *
 * This is the single biggest optimisation: noise sampling and greedy
 * meshing are CPU-intensive and were blocking the render loop. Moving
 * them to a worker keeps the main thread free for 60 FPS rendering
 * while chunks generate in the background.
 *
 * Trade-off: without neighbor chunk data, boundary faces between
 * chunks are assumed to face air. This causes a few extra faces at
 * chunk seams but is nearly invisible in practice, and avoids the
 * complexity of passing neighbor data to the worker.
 */

import { generateChunk, CHUNK_SIZE, type WorldConfig, chunkIndex, type ChunkResult, type ChunkData } from "./chunk";
import { buildChunkMesh } from "./mesher";

export interface WorkerRequest {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  config: WorldConfig;
  remesh?: boolean;          // skip generation, use provided blockData
  blockData?: Uint8Array;    // provided when remesh = true
  grassColors?: Uint32Array; // provided when remesh = true
  lightData?: Uint8Array;    // per-voxel light levels 0–15
}

export interface WorkerResponse {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  empty: boolean;
  blockData: Uint8Array;
  grassColors: Uint32Array;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, cx, cy, cz, config, remesh, lightData } = e.data;

  let data: ChunkData;
  let grassColors: Uint32Array;

  if (remesh && e.data.blockData && e.data.grassColors) {
    // Light-pass re-mesh: skip generation, use provided data
    data = e.data.blockData;
    grassColors = e.data.grassColors;
  } else {
    const t0 = performance.now();
    const result: ChunkResult = generateChunk(cx, cy, cz, config);
    const t1 = performance.now();
    if (t1 - t0 > 100) console.warn(`Slow chunk (${cx},${cy},${cz}): ${(t1 - t0).toFixed(0)}ms`);
    data = result.data;
    grassColors = result.grassColors;
  }

  const getNeighbor = (lx: number, ly: number, lz: number): number => {
    if (lx < 0 || lx >= CHUNK_SIZE ||
        ly < 0 || ly >= CHUNK_SIZE ||
        lz < 0 || lz >= CHUNK_SIZE) {
      return 0;
    }
    return data[chunkIndex(lx, ly, lz)];
  };

  const mesh = buildChunkMesh(data, getNeighbor, grassColors, lightData ?? null);

  if (mesh.indices.length === 0) {
    const resp: WorkerResponse = {
      id, cx, cy, cz,
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
      empty: true,
      blockData: data,
      grassColors,
    };
    self.postMessage(resp, { transfer: [data.buffer, grassColors.buffer] });
    return;
  }

  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const colors = new Float32Array(mesh.colors);
  const indices = new Uint32Array(mesh.indices);

  const resp: WorkerResponse = {
    id, cx, cy, cz,
    positions, normals, colors, indices,
    empty: false,
    blockData: data,
    grassColors,
  };

  self.postMessage(resp, {
    transfer: [
      positions.buffer,
      normals.buffer,
      colors.buffer,
      indices.buffer,
      data.buffer,
      grassColors.buffer,
    ],
  });
};
