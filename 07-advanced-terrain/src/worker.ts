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
import { computeChunkLocalLight } from "./lighting";
import { buildChunkMesh } from "./mesher";

export interface WorkerRequest {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  config: WorldConfig;
}

export interface WorkerResponse {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  empty: boolean;
  blockData: Uint8Array;
  grassColors: Uint32Array;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, cx, cy, cz, config } = e.data;

  const t0 = performance.now();
  const result: ChunkResult = generateChunk(cx, cy, cz, config);
  const t1 = performance.now();
  if (t1 - t0 > 100) console.warn(`Slow chunk (${cx},${cy},${cz}): ${(t1 - t0).toFixed(0)}ms`);
  const data: ChunkData = result.data;
  const grassColors: Uint32Array = result.grassColors;
  const lightData = computeChunkLocalLight(data);

  const getNeighbor = (lx: number, ly: number, lz: number): number => {
    if (lx < 0 || lx >= CHUNK_SIZE ||
        ly < 0 || ly >= CHUNK_SIZE ||
        lz < 0 || lz >= CHUNK_SIZE) {
      return 0;
    }
    return data[chunkIndex(lx, ly, lz)];
  };

  const mesh = buildChunkMesh(data, getNeighbor, grassColors, lightData);

  if (mesh.indices.length === 0) {
    const resp: WorkerResponse = {
      id, cx, cy, cz,
      positions: new Float32Array(0),
      normals:   new Float32Array(0),
      colors:    new Float32Array(0),
      uvs:       new Float32Array(0),
      indices:   new Uint32Array(0),
      empty: true,
      blockData: data,
      grassColors,
    };
    self.postMessage(resp, { transfer: [data.buffer, grassColors.buffer] });
    return;
  }

  const positions = new Float32Array(mesh.positions);
  const normals   = new Float32Array(mesh.normals);
  const colors    = new Float32Array(mesh.colors);
  const uvs       = new Float32Array(mesh.uvs);
  const indices   = new Uint32Array(mesh.indices);

  const resp: WorkerResponse = {
    id, cx, cy, cz,
    positions, normals, colors, uvs, indices,
    empty: false,
    blockData: data,
    grassColors,
  };

  self.postMessage(resp, {
    transfer: [
      positions.buffer,
      normals.buffer,
      colors.buffer,
      uvs.buffer,
      indices.buffer,
      data.buffer,
      grassColors.buffer,
    ],
  });
};
