import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS, Block, ATLAS_COLS, ATLAS_ROWS, ATLAS_TILE_SIZE } from "./blocks";

/**
 * Per-face quad emitter — replaces the greedy mesher.
 *
 * Each visible block face becomes exactly one quad (4 vertices, 2 triangles).
 * UV coordinates point to the block's assigned tile in the 8×8 texture atlas.
 * Vertex colors are kept for biome-tinted grass; all other blocks use white
 * so that `map × vertexColors = map` in MeshLambertMaterial.
 */

export interface MeshData {
  positions: number[];
  normals:   number[];
  colors:    number[];
  uvs:       number[];   // 2 floats per vertex (u, v)
  indices:   number[];
}

type NeighborLookup = (x: number, y: number, z: number) => number;

export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: Uint8Array | null,
): MeshData {
  const positions: number[] = [];
  const normals:   number[] = [];
  const colors:    number[] = [];
  const uvs:       number[] = [];
  const indices:   number[] = [];

  // Six face directions: [axis, sign]
  // axis: 0=x, 1=y, 2=z   sign: +1 or -1
  const faces: [number, number][] = [
    [0, -1], [0, 1],
    [1, -1], [1, 1],
    [2, -1], [2, 1],
  ];

  for (const [axis, dir] of faces) {
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;

    const normal = [0, 0, 0];
    normal[axis] = dir;

    for (let d = 0; d < CHUNK_SIZE; d++) {
      for (let j = 0; j < CHUNK_SIZE; j++) {
        for (let i = 0; i < CHUNK_SIZE; i++) {
          // Map (d, i, j) → local voxel position
          const pos = [0, 0, 0];
          pos[axis]  = d;
          pos[uAxis] = i;
          pos[vAxis] = j;

          const block = data[chunkIndex(pos[0], pos[1], pos[2])];
          const def   = BLOCK_DEFS[block];
          if (!def || def.transparent) continue;

          // Check the voxel on the other side of this face
          const nPos = [pos[0], pos[1], pos[2]];
          nPos[axis] += dir;

          let neighborBlock: number;
          if (
            nPos[0] < 0 || nPos[0] >= CHUNK_SIZE ||
            nPos[1] < 0 || nPos[1] >= CHUNK_SIZE ||
            nPos[2] < 0 || nPos[2] >= CHUNK_SIZE
          ) {
            neighborBlock = getNeighbor(nPos[0], nPos[1], nPos[2]);
          } else {
            neighborBlock = data[chunkIndex(nPos[0], nPos[1], nPos[2])];
          }

          const nDef = BLOCK_DEFS[neighborBlock];
          if (nDef && !nDef.transparent) continue; // face is hidden

          // ── Tile UV ──────────────────────────────────────────────────────
          // axis 1 (Y): dir +1 = top face, dir -1 = bottom face
          // axis 0/2 (X/Z): side face
          const faceType: "top" | "side" | "bottom" =
            axis === 1 ? (dir === 1 ? "top" : "bottom") : "side";
          const tileIdx = def.tiles[faceType];

          const tCol = tileIdx % ATLAS_COLS;
          const tRow = (tileIdx / ATLAS_COLS) | 0;
          // Half-texel inset: keeps UVs off tile boundaries so NearestFilter
          // never bleeds into an adjacent (possibly empty/black) tile slot.
          const htU = 0.5 / (ATLAS_COLS * ATLAS_TILE_SIZE);
          const htV = 0.5 / (ATLAS_ROWS * ATLAS_TILE_SIZE);
          const u0 = tCol / ATLAS_COLS + htU,       u1 = (tCol + 1) / ATLAS_COLS - htU;
          const v0 = tRow / ATLAS_ROWS + htV,       v1 = (tRow + 1) / ATLAS_ROWS - htV;

          // ── Vertex color (white unless grass top/side for biome tint) ────
          let packedColor = 0xFFFFFF;
          if (block === Block.Grass && faceType !== "bottom") {
            packedColor = grassColors[pos[2] * CHUNK_SIZE + pos[0]];
          }
          const r = ((packedColor >> 16) & 255) / 255;
          const g = ((packedColor >>  8) & 255) / 255;
          const b = ( packedColor        & 255) / 255;

          // ── Directional shading ──────────────────────────────────────────
          const shade =
            axis === 1 ? (dir === 1 ? 1.0 : 0.5) :
            axis === 0 ? 0.7 : 0.8;

          // ── Light level (from the air-side voxel of this face) ───────────
          let lightLevel = 15;
          if (lightData) {
            const lp = [pos[0], pos[1], pos[2]];
            lp[axis] += dir;
            if (
              lp[0] >= 0 && lp[0] < CHUNK_SIZE &&
              lp[1] >= 0 && lp[1] < CHUNK_SIZE &&
              lp[2] >= 0 && lp[2] < CHUNK_SIZE
            ) {
              lightLevel = lightData[chunkIndex(lp[0], lp[1], lp[2])];
            }
            lightLevel = Math.max(lightLevel, def.lightEmit);
          }
          const lightFactor = 0.2 + (lightLevel / 15) * 0.8;

          const sr = r * shade * lightFactor;
          const sg = g * shade * lightFactor;
          const sb = b * shade * lightFactor;

          // ── Quad geometry ────────────────────────────────────────────────
          const corner = [0, 0, 0];
          corner[axis]  = d + (dir > 0 ? 1 : 0);
          corner[uAxis] = i;
          corner[vAxis] = j;

          const du = [0, 0, 0]; du[uAxis] = 1;
          const dv = [0, 0, 0]; dv[vAxis] = 1;

          const vi = positions.length / 3;

          // 4 corners of the 1×1 quad, CCW from bottom-left
          const qc = [
            [corner[0],                corner[1],                corner[2]               ],
            [corner[0] + du[0],        corner[1] + du[1],        corner[2] + du[2]       ],
            [corner[0] + du[0]+dv[0],  corner[1] + du[1]+dv[1],  corner[2] + du[2]+dv[2] ],
            [corner[0] + dv[0],        corner[1] + dv[1],        corner[2] + dv[2]       ],
          ];
          // UV corners are axis-dependent so that V always runs top-to-bottom
          // on the block face (v0=tile top = world-top, v1=tile bottom = world-bottom).
          //
          // For Y-faces:  uAxis=Z, vAxis=X  — standard: (u0,v0)→(u1,v0)→(u1,v1)→(u0,v1)
          // For Z-faces:  uAxis=X, vAxis=Y  — V is inverted (Y grows up, V grows down in atlas)
          // For X-faces:  uAxis=Y, vAxis=Z  — U/V swapped and V inverted
          let uvc: [number, number][];
          if (axis === 1) {
            uvc = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
          } else if (axis === 2) {
            // Z-face: qc goes (Y-bottom,X-left)→(Y-bottom,X-right)→(Y-top,X-right)→(Y-top,X-left)
            // Map world-top (Y+1) → v0 (tile top), world-bottom (Y) → v1 (tile bottom)
            uvc = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
          } else {
            // X-face: qc goes (Y-bottom,Z-front)→(Y-top,Z-front)→(Y-top,Z-back)→(Y-bottom,Z-back)
            // U tracks Z (horizontal), V tracks inverted-Y (vertical)
            uvc = [[u0, v1], [u0, v0], [u1, v0], [u1, v1]];
          }

          for (let k = 0; k < 4; k++) {
            positions.push(qc[k][0], qc[k][1], qc[k][2]);
            normals.push(normal[0], normal[1], normal[2]);
            colors.push(sr, sg, sb);
            uvs.push(uvc[k][0], uvc[k][1]);
          }

          // Winding: positive-dir faces use 0-1-2, 0-2-3;
          //          negative-dir faces reverse to face outward
          if (dir > 0) {
            indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          } else {
            indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
          }
        }
      }
    }
  }

  return { positions, normals, colors, uvs, indices };
}
