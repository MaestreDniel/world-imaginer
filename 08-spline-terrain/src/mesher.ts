import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS, Block, ATLAS_COLS, ATLAS_ROWS, ATLAS_TILE_SIZE, ATLAS_TILE_PAD, ATLAS_TILE_PADDED } from "./blocks";
import type { ChunkLightData } from "./lighting";

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
  skyLight:   number[];  // 1 float per vertex, 0..15
  blockLight: number[];  // 1 float per vertex, 0..15
  indices:   number[];
}

type NeighborLookup = (x: number, y: number, z: number) => number;

/**
 * Brightness multiplier per occluder count.
 * Index 0 = no occluders (full bright), index 3 = fully cornered (darkest).
 */
const AO_TABLE = [1.0, 0.80, 0.60, 0.45];

/**
 * Compute the AO level for one vertex of a face.
 *
 * `side1` and `side2` are the two edge-adjacent neighbors in the face plane.
 * `corner` is the diagonal neighbor. Each is 1 if solid, 0 if transparent/air.
 *
 * When both edges are solid the corner is visually hidden, so we force
 * occluderCount to 3 regardless of the actual corner value.
 */
function vertexAO(side1: number, side2: number, corner: number): number {
  if (side1 && side2) return AO_TABLE[3];
  return AO_TABLE[side1 + side2 + corner];
}

/**
 * Returns 1 if the block at (x, y, z) in local chunk coords is solid, 0 otherwise.
 * Uses getNeighbor for out-of-bounds positions.
 */
function isSolidAt(
  x: number, y: number, z: number,
  data: ChunkData, getNeighbor: NeighborLookup,
): number {
  let blockId: number;
  if (
    x < 0 || x >= CHUNK_SIZE ||
    y < 0 || y >= CHUNK_SIZE ||
    z < 0 || z >= CHUNK_SIZE
  ) {
    blockId = getNeighbor(x, y, z);
  } else {
    blockId = data[chunkIndex(x, y, z)];
  }
  const def = BLOCK_DEFS[blockId];
  return (def && !def.transparent) ? 1 : 0;
}

export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: ChunkLightData | null,
): MeshData {
  const positions: number[] = [];
  const normals:   number[] = [];
  const colors:    number[] = [];
  const uvs:       number[] = [];
  const skyLight:   number[] = [];
  const blockLight: number[] = [];
  const indices:   number[] = [];

  // Six face directions: [axis, sign]
  // axis: 0=x, 1=y, 2=z   sign: +1 or -1
  const faces: [number, number][] = [
    [0, -1], [0, 1],
    [1, -1], [1, 1],
    [2, -1], [2, 1],
  ];

  // ── Pass 1: cross-shape sprites (vegetation) ────────────────────────────────
  // Walk the grid once and emit two crossed double-sided quads per sprite cell.
  // The cube path below skips these blocks naturally because they're transparent.
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const block = data[chunkIndex(x, y, z)];
        const def = BLOCK_DEFS[block];
        if (!def || def.renderShape !== "cross") continue;

        const tileIdx = def.tiles.side;
        const tCol = tileIdx % ATLAS_COLS;
        const tRow = (tileIdx / ATLAS_COLS) | 0;
        const atlasW = ATLAS_COLS * ATLAS_TILE_PADDED;
        const atlasH = ATLAS_ROWS * ATLAS_TILE_PADDED;
        const htU = 0.5 / atlasW;
        const htV = 0.5 / atlasH;
        const u0 = (tCol * ATLAS_TILE_PADDED + ATLAS_TILE_PAD) / atlasW + htU;
        const u1 = (tCol * ATLAS_TILE_PADDED + ATLAS_TILE_PAD + ATLAS_TILE_SIZE) / atlasW - htU;
        const v0 = (tRow * ATLAS_TILE_PADDED + ATLAS_TILE_PAD) / atlasH + htV;
        const v1 = (tRow * ATLAS_TILE_PADDED + ATLAS_TILE_PAD + ATLAS_TILE_SIZE) / atlasH - htV;

        let spriteSky = 15;
        let spriteBlock = def.lightEmit;
        if (lightData) {
          spriteSky   = lightData.sky[chunkIndex(x, y, z)];
          spriteBlock = Math.max(lightData.block[chunkIndex(x, y, z)], def.lightEmit);
        }
        const r = 1, g = 1, b = 1;

        // Two quads, NW↔SE and NE↔SW. Material uses side: DoubleSide so
        // a single winding renders both faces.
        const quads: Array<{ corners: [number, number, number][]; nx: number; nz: number }> = [
          {
            corners: [
              [x + 0, y + 0, z + 0],
              [x + 1, y + 0, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 0, y + 1, z + 0],
            ],
            nx:  Math.SQRT1_2, nz: -Math.SQRT1_2,
          },
          {
            corners: [
              [x + 1, y + 0, z + 0],
              [x + 0, y + 0, z + 1],
              [x + 0, y + 1, z + 1],
              [x + 1, y + 1, z + 0],
            ],
            nx:  Math.SQRT1_2, nz:  Math.SQRT1_2,
          },
        ];

        for (const q of quads) {
          const vi = positions.length / 3;
          const uvc: [number, number][] = [
            [u0, v1], [u1, v1], [u1, v0], [u0, v0],
          ];
          for (let k = 0; k < 4; k++) {
            positions.push(q.corners[k][0], q.corners[k][1], q.corners[k][2]);
            normals.push(q.nx, 0, q.nz);
            colors.push(r, g, b);
            skyLight.push(spriteSky);
            blockLight.push(spriteBlock);
            uvs.push(uvc[k][0], uvc[k][1]);
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        }
      }
    }
  }

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
          // UV addresses the inner 16×16 content area of each padded 32×32 slot.
          // Half-texel inset keeps UVs off the content boundary so NearestFilter
          // never bleeds into the extruded-edge region even at the closest mip level.
          const atlasW = ATLAS_COLS * ATLAS_TILE_PADDED;  // 256
          const atlasH = ATLAS_ROWS * ATLAS_TILE_PADDED;  // 256
          const htU = 0.5 / atlasW;
          const htV = 0.5 / atlasH;
          const u0 = (tCol * ATLAS_TILE_PADDED + ATLAS_TILE_PAD) / atlasW + htU;
          const u1 = (tCol * ATLAS_TILE_PADDED + ATLAS_TILE_PAD + ATLAS_TILE_SIZE) / atlasW - htU;
          const v0 = (tRow * ATLAS_TILE_PADDED + ATLAS_TILE_PAD) / atlasH + htV;
          const v1 = (tRow * ATLAS_TILE_PADDED + ATLAS_TILE_PAD + ATLAS_TILE_SIZE) / atlasH - htV;

          // ── Vertex color (white unless grass top for biome tint) ─────────
          // Side faces stay untinted so the dirt strip at the bottom of
          // GrassSide matches the standalone Dirt block exactly.
          let packedColor = 0xFFFFFF;
          if (block === Block.Grass && faceType === "top") {
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
          let faceSky = 15;
          let faceBlock = def.lightEmit;
          if (lightData) {
            const lp = [pos[0], pos[1], pos[2]];
            lp[axis] += dir;
            if (
              lp[0] >= 0 && lp[0] < CHUNK_SIZE &&
              lp[1] >= 0 && lp[1] < CHUNK_SIZE &&
              lp[2] >= 0 && lp[2] < CHUNK_SIZE
            ) {
              const nIdx = chunkIndex(lp[0], lp[1], lp[2]);
              faceSky   = lightData.sky[nIdx];
              faceBlock = Math.max(lightData.block[nIdx], def.lightEmit);
            }
          }

          const baseR = r * shade;
          const baseG = g * shade;
          const baseB = b * shade;

          // ── Quad geometry ────────────────────────────────────────────────
          const corner = [0, 0, 0];
          corner[axis]  = d + (dir > 0 ? 1 : 0);
          corner[uAxis] = i;
          corner[vAxis] = j;

          const du = [0, 0, 0]; du[uAxis] = 1;
          const dv = [0, 0, 0]; dv[vAxis] = 1;

          // ── Per-vertex AO ───────────────────────────────────────────────
          // For each of the 4 quad corners, sample 2 edge + 1 corner neighbor
          // in the plane perpendicular to the face normal.
          // du/dv offsets: corner 0 = (0,0), 1 = (+u,0), 2 = (+u,+v), 3 = (0,+v)
          // Edge/corner neighbors are offset from the face's air-side position.
          const ap = [pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]];

          // Precompute the 4 edge neighbors (±u, ±v from air-side position)
          const s_pu = isSolidAt(ap[0] + du[0], ap[1] + du[1], ap[2] + du[2], data, getNeighbor);
          const s_nu = isSolidAt(ap[0] - du[0], ap[1] - du[1], ap[2] - du[2], data, getNeighbor);
          const s_pv = isSolidAt(ap[0] + dv[0], ap[1] + dv[1], ap[2] + dv[2], data, getNeighbor);
          const s_nv = isSolidAt(ap[0] - dv[0], ap[1] - dv[1], ap[2] - dv[2], data, getNeighbor);

          // And the 4 corner neighbors (diagonals)
          const c_pupv = isSolidAt(ap[0] + du[0] + dv[0], ap[1] + du[1] + dv[1], ap[2] + du[2] + dv[2], data, getNeighbor);
          const c_nupv = isSolidAt(ap[0] - du[0] + dv[0], ap[1] - du[1] + dv[1], ap[2] - du[2] + dv[2], data, getNeighbor);
          const c_punv = isSolidAt(ap[0] + du[0] - dv[0], ap[1] + du[1] - dv[1], ap[2] + du[2] - dv[2], data, getNeighbor);
          const c_nunv = isSolidAt(ap[0] - du[0] - dv[0], ap[1] - du[1] - dv[1], ap[2] - du[2] - dv[2], data, getNeighbor);

          // AO per corner: corner 0 = (-u,-v), 1 = (+u,-v), 2 = (+u,+v), 3 = (-u,+v)
          const ao0 = vertexAO(s_nu, s_nv, c_nunv);
          const ao1 = vertexAO(s_pu, s_nv, c_punv);
          const ao2 = vertexAO(s_pu, s_pv, c_pupv);
          const ao3 = vertexAO(s_nu, s_pv, c_nupv);

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

          const aoFactors = [ao0, ao1, ao2, ao3];
          for (let k = 0; k < 4; k++) {
            positions.push(qc[k][0], qc[k][1], qc[k][2]);
            normals.push(normal[0], normal[1], normal[2]);
            colors.push(baseR * aoFactors[k], baseG * aoFactors[k], baseB * aoFactors[k]);
            skyLight.push(faceSky);
            blockLight.push(faceBlock);
            uvs.push(uvc[k][0], uvc[k][1]);
          }

          // Quad diagonal flipping: compare AO on opposite corners.
          // Split along the diagonal with lower AO sum to avoid bright-seam artifacts.
          const flipDiag = ao0 + ao2 < ao1 + ao3;

          if (dir > 0) {
            if (flipDiag) {
              indices.push(vi, vi + 1, vi + 3, vi + 1, vi + 2, vi + 3);
            } else {
              indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
            }
          } else {
            if (flipDiag) {
              indices.push(vi, vi + 3, vi + 1, vi + 1, vi + 3, vi + 2);
            } else {
              indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
            }
          }
        }
      }
    }
  }

  return { positions, normals, colors, uvs, skyLight, blockLight, indices };
}
