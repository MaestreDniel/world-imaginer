import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS } from "./blocks";

/**
 * Greedy mesher — converts voxel data into an optimised triangle mesh.
 *
 * A naive approach would emit 2 triangles (1 quad) per visible face of
 * every block. For a 32^3 chunk that's up to 6 * 32768 = 196608 quads.
 * Most are interior faces between two solid blocks — those are culled.
 *
 * Greedy meshing goes further: it merges adjacent coplanar faces of the
 * same block type into larger rectangles. A flat grass surface that would
 * be 1024 individual quads becomes a handful of large ones.
 *
 * Algorithm (per slice along each axis):
 * 1. For each layer, build a 2D mask of which faces are visible and
 *    what block type they belong to.
 * 2. Sweep the mask row by row. For each unvisited face, expand it
 *    rightward as far as the same block type extends, then downward
 *    as far as the entire row-width matches.
 * 3. Emit one quad for the merged rectangle, mark it visited.
 *
 * Reference: Mikola Lysenko's "Meshing in a Minecraft Game"
 * https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/
 */

export interface MeshData {
  positions: number[];   // xyz per vertex
  normals: number[];     // xyz per vertex
  colors: number[];      // rgb per vertex
  indices: number[];     // triangle indices
}

type NeighborLookup = (x: number, y: number, z: number) => number;

export function buildChunkMesh(data: ChunkData, getNeighbor: NeighborLookup): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Six face directions: [axis, sign]
  // axis: 0=x, 1=y, 2=z  sign: +1 or -1
  const faces: [number, number][] = [
    [0, -1], [0, 1],
    [1, -1], [1, 1],
    [2, -1], [2, 1],
  ];

  for (const [axis, dir] of faces) {
    const u = (axis + 1) % 3; // first tangent axis
    const v = (axis + 2) % 3; // second tangent axis

    const normal = [0, 0, 0];
    normal[axis] = dir;

    // Sweep each slice along `axis`
    for (let d = 0; d < CHUNK_SIZE; d++) {
      // Build the mask for this slice
      const mask = new Int16Array(CHUNK_SIZE * CHUNK_SIZE); // 0 = no face, else blockId+1

      for (let j = 0; j < CHUNK_SIZE; j++) {
        for (let i = 0; i < CHUNK_SIZE; i++) {
          const pos = [0, 0, 0];
          pos[axis] = d;
          pos[u] = i;
          pos[v] = j;

          const block = data[chunkIndex(pos[0], pos[1], pos[2])];
          const blockDef = BLOCK_DEFS[block];

          if (!blockDef || blockDef.transparent) {
            mask[j * CHUNK_SIZE + i] = 0;
            continue;
          }

          // Check neighbor in `dir` direction
          const nPos = [pos[0], pos[1], pos[2]];
          nPos[axis] += dir;

          let neighborBlock: number;
          if (nPos[0] < 0 || nPos[0] >= CHUNK_SIZE ||
              nPos[1] < 0 || nPos[1] >= CHUNK_SIZE ||
              nPos[2] < 0 || nPos[2] >= CHUNK_SIZE) {
            neighborBlock = getNeighbor(nPos[0], nPos[1], nPos[2]);
          } else {
            neighborBlock = data[chunkIndex(nPos[0], nPos[1], nPos[2])];
          }

          const nDef = BLOCK_DEFS[neighborBlock];
          if (!nDef || nDef.transparent) {
            mask[j * CHUNK_SIZE + i] = block + 1; // +1 so 0 means "no face"
          } else {
            mask[j * CHUNK_SIZE + i] = 0;
          }
        }
      }

      // Greedy merge
      for (let j = 0; j < CHUNK_SIZE; j++) {
        for (let i = 0; i < CHUNK_SIZE;) {
          const val = mask[j * CHUNK_SIZE + i];
          if (val === 0) { i++; continue; }

          // Expand width (along u axis)
          let w = 1;
          while (i + w < CHUNK_SIZE && mask[j * CHUNK_SIZE + i + w] === val) w++;

          // Expand height (along v axis)
          let h = 1;
          let done = false;
          while (j + h < CHUNK_SIZE && !done) {
            for (let k = 0; k < w; k++) {
              if (mask[(j + h) * CHUNK_SIZE + i + k] !== val) {
                done = true;
                break;
              }
            }
            if (!done) h++;
          }

          // Emit quad
          const blockId = val - 1;
          const def = BLOCK_DEFS[blockId];
          const r = ((def.color >> 16) & 255) / 255;
          const g = ((def.color >> 8) & 255) / 255;
          const b = (def.color & 255) / 255;

          // Simple directional shading
          const shade = axis === 1
            ? (dir === 1 ? 1.0 : 0.5)  // top bright, bottom dark
            : axis === 0 ? 0.7 : 0.8;  // sides slightly darker

          const sr = r * shade;
          const sg = g * shade;
          const sb = b * shade;

          // Quad corners
          const corner = [0, 0, 0];
          corner[axis] = d + (dir > 0 ? 1 : 0);
          corner[u] = i;
          corner[v] = j;

          const du = [0, 0, 0];
          du[u] = w;
          const dv = [0, 0, 0];
          dv[v] = h;

          const vi = positions.length / 3;

          // 4 vertices of the quad
          const corners = [
            [corner[0], corner[1], corner[2]],
            [corner[0] + du[0], corner[1] + du[1], corner[2] + du[2]],
            [corner[0] + du[0] + dv[0], corner[1] + du[1] + dv[1], corner[2] + du[2] + dv[2]],
            [corner[0] + dv[0], corner[1] + dv[1], corner[2] + dv[2]],
          ];

          for (const c of corners) {
            positions.push(c[0], c[1], c[2]);
            normals.push(normal[0], normal[1], normal[2]);
            colors.push(sr, sg, sb);
          }

          // Two triangles — winding depends on face direction
          if (dir > 0) {
            indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          } else {
            indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
          }

          // Clear the merged region from the mask
          for (let dj = 0; dj < h; dj++) {
            for (let di = 0; di < w; di++) {
              mask[(j + dj) * CHUNK_SIZE + i + di] = 0;
            }
          }

          i += w;
        }
      }
    }
  }

  return { positions, normals, colors, indices };
}
