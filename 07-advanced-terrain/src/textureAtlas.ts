import * as THREE from "three";
import { TILE_IDS, ATLAS_COLS, ATLAS_ROWS, ATLAS_TILE_SIZE, ATLAS_TILE_PAD, ATLAS_TILE_PADDED } from "./blocks";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seeded LCG — reproducible noise independent of Math.random. */
function makeLcg(seed: number): () => number {
  let s = (seed ^ 0x5A5A5A5A) >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Column index for a tile slot. */
function tc(idx: number): number { return idx % ATLAS_COLS; }
/** Row index for a tile slot. */
function tr(idx: number): number { return Math.floor(idx / ATLAS_COLS); }
/** Canvas X origin of the drawable content area for tile slot (col, row). */
function tileX(col: number): number { return col * ATLAS_TILE_PADDED + ATLAS_TILE_PAD; }
/** Canvas Y origin of the drawable content area for tile slot (col, row). */
function tileY(row: number): number { return row * ATLAS_TILE_PADDED + ATLAS_TILE_PAD; }

/**
 * Fill a tile slot with a base color plus per-pixel brightness noise.
 * `variance` is a fraction of 255 (e.g. 0.10 = ±25.5 brightness).
 */
function drawNoiseTile(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  color: number,
  variance: number,
  seed: number,
): void {
  const x0  = tileX(col);
  const y0  = tileY(row);
  const rng = makeLcg(seed);
  const rb  = (color >> 16) & 255;
  const gb  = (color >>  8) & 255;
  const bb  =  color        & 255;
  const img = ctx.createImageData(ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
  const n   = ATLAS_TILE_SIZE * ATLAS_TILE_SIZE;
  for (let i = 0; i < n; i++) {
    const v = (rng() - 0.5) * variance * 255;
    img.data[i * 4 + 0] = Math.max(0, Math.min(255, rb + v)) | 0;
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, gb + v)) | 0;
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, bb + v)) | 0;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

// ── Specialised tile painters ─────────────────────────────────────────────────

function drawGrassTop(ctx: CanvasRenderingContext2D): void {
  drawNoiseTile(ctx, tc(TILE_IDS.GrassTop), tr(TILE_IDS.GrassTop), 0x4CAF50, 0.15, TILE_IDS.GrassTop);
  const x0  = tileX(tc(TILE_IDS.GrassTop));
  const y0  = tileY(tr(TILE_IDS.GrassTop));
  const rng = makeLcg(TILE_IDS.GrassTop + 1000);
  ctx.fillStyle = "#2E7D32";
  for (let i = 0; i < 14; i++) {
    ctx.fillRect(
      x0 + (rng() * ATLAS_TILE_SIZE) | 0,
      y0 + (rng() * ATLAS_TILE_SIZE) | 0,
      1, 1,
    );
  }
}

function drawGrassSide(ctx: CanvasRenderingContext2D): void {
  const col = tc(TILE_IDS.GrassSide);
  const row = tr(TILE_IDS.GrassSide);
  // Dirt base
  drawNoiseTile(ctx, col, row, 0x8B5E3C, 0.10, TILE_IDS.GrassSide);
  // Green strip on top 3 rows
  ctx.fillStyle = "#4CAF50";
  ctx.fillRect(tileX(col), tileY(row), ATLAS_TILE_SIZE, 3);
}

function drawWoodEnd(ctx: CanvasRenderingContext2D, tileIdx: number, baseColor: number): void {
  const col = tc(tileIdx);
  const row = tr(tileIdx);
  drawNoiseTile(ctx, col, row, baseColor, 0.10, tileIdx);
  const cx = tileX(col) + ATLAS_TILE_SIZE / 2;
  const cy = tileY(row) + ATLAS_TILE_SIZE / 2;
  const rb = (baseColor >> 16) & 255;
  const gb = (baseColor >>  8) & 255;
  const bb =  baseColor        & 255;
  ctx.strokeStyle = `rgba(${rb * 0.55 | 0},${gb * 0.55 | 0},${bb * 0.55 | 0},0.5)`;
  ctx.lineWidth = 1;
  for (let r = 2; r < ATLAS_TILE_SIZE / 2; r += 3) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawWoodBark(ctx: CanvasRenderingContext2D, tileIdx: number, baseColor: number): void {
  const col = tc(tileIdx);
  const row = tr(tileIdx);
  drawNoiseTile(ctx, col, row, baseColor, 0.10, tileIdx);
  const x0  = tileX(col);
  const y0  = tileY(row);
  const rb  = (baseColor >> 16) & 255;
  const gb  = (baseColor >>  8) & 255;
  const bb  =  baseColor        & 255;
  ctx.fillStyle = `rgba(${rb * 0.65 | 0},${gb * 0.65 | 0},${bb * 0.65 | 0},0.45)`;
  const rng = makeLcg(tileIdx + 2000);
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x0 + (rng() * ATLAS_TILE_SIZE) | 0, y0, 1, ATLAS_TILE_SIZE);
  }
}

/**
 * Extrude the 1-px border of each tile's content area into the surrounding pad
 * region. This prevents mipmap averaging from sampling black empty canvas space
 * when a mip level straddles the boundary between a tile's content and its
 * neighbouring slot's padding.
 */
function extrudeTile(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const sx = tileX(col);
  const sy = tileY(row);
  const S  = ATLAS_TILE_SIZE;
  const P  = ATLAS_TILE_PAD;

  // Top edge → pad row(s) above
  ctx.drawImage(ctx.canvas, sx, sy,     S, 1,  sx, sy - P, S, P);
  // Bottom edge → pad row(s) below
  ctx.drawImage(ctx.canvas, sx, sy+S-1, S, 1,  sx, sy + S, S, P);
  // Left edge → pad column(s) to the left
  ctx.drawImage(ctx.canvas, sx,     sy, 1, S,  sx - P, sy, P, S);
  // Right edge → pad column(s) to the right
  ctx.drawImage(ctx.canvas, sx+S-1, sy, 1, S,  sx + S, sy, P, S);
  // Corners (fill from nearest edge pixel to avoid seams)
  ctx.drawImage(ctx.canvas, sx,     sy,     1, 1,  sx - P, sy - P, P, P);
  ctx.drawImage(ctx.canvas, sx+S-1, sy,     1, 1,  sx + S, sy - P, P, P);
  ctx.drawImage(ctx.canvas, sx,     sy+S-1, 1, 1,  sx - P, sy + S, P, P);
  ctx.drawImage(ctx.canvas, sx+S-1, sy+S-1, 1, 1,  sx + S, sy + S, P, P);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a 128×128 CanvasTexture atlas with procedural placeholder tiles.
 * To swap in a real atlas: replace this function with a TextureLoader call
 * that returns a Promise<THREE.Texture> — no other files need to change.
 */
export function buildAtlasTexture(): THREE.CanvasTexture {
  const canvas    = document.createElement("canvas");
  canvas.width    = ATLAS_COLS * ATLAS_TILE_PADDED;   // 144
  canvas.height   = ATLAS_ROWS * ATLAS_TILE_PADDED;   // 144
  const ctx = canvas.getContext("2d")!;

  // Uniform noise tiles: [tileIdx, baseColor, variance]
  const noiseTiles: Array<[number, number, number]> = [
    [TILE_IDS.Dirt,         0x8B5E3C, 0.10],
    [TILE_IDS.Stone,        0x808080, 0.08],
    [TILE_IDS.DeepStone,    0x505050, 0.07],
    [TILE_IDS.Sand,         0xEDC9AF, 0.08],
    [TILE_IDS.Water,        0x2196F3, 0.05],
    [TILE_IDS.Snow,         0xF0F0F0, 0.05],
    [TILE_IDS.Coal,         0x333333, 0.15],
    [TILE_IDS.Iron,         0xC19A6B, 0.12],
    [TILE_IDS.OakLeaves,    0x2E7D32, 0.12],
    [TILE_IDS.BirchLeaves,  0x6DBF4B, 0.12],
    [TILE_IDS.SpruceLeaves, 0x1B5E20, 0.12],
    [TILE_IDS.Cactus,       0x388E3C, 0.10],
    [TILE_IDS.RedSand,      0xC97044, 0.08],
    [TILE_IDS.Ice,          0xB3E5FC, 0.04],
    [TILE_IDS.Gravel,       0x9E9E9E, 0.12],
    [TILE_IDS.Sandstone,    0xD4B483, 0.08],
    [TILE_IDS.SnowBrick,    0xDCE8EC, 0.06],
    [TILE_IDS.OakPlanks,    0xBC8F5E, 0.10],
    [TILE_IDS.Cobblestone,  0x6B6B6B, 0.12],
    [TILE_IDS.Glass,        0xCCE8F0, 0.03],
    [TILE_IDS.Lava,         0xFF6600, 0.08],
    [TILE_IDS.Glowstone,    0xFFDD44, 0.08],
  ];

  for (const [idx, color, variance] of noiseTiles) {
    drawNoiseTile(ctx, tc(idx), tr(idx), color, variance, idx);
  }

  drawGrassTop(ctx);
  drawGrassSide(ctx);
  drawWoodEnd(ctx, TILE_IDS.OakEnd,      0x6D4C2A);
  drawWoodBark(ctx, TILE_IDS.OakBark,    0x6D4C2A);
  drawWoodEnd(ctx, TILE_IDS.BirchEnd,    0xD4C9A8);
  drawWoodBark(ctx, TILE_IDS.BirchBark,  0xD4C9A8);
  drawWoodEnd(ctx, TILE_IDS.SpruceEnd,   0x3E2723);
  drawWoodBark(ctx, TILE_IDS.SpruceBark, 0x3E2723);

  // Extrude every non-Air tile so mipmap averaging never samples empty canvas.
  const allTileIds = Object.values(TILE_IDS).filter(id => id !== TILE_IDS.Air);
  for (const id of allTileIds) {
    extrudeTile(ctx, tc(id), tr(id));
  }

  const texture       = new THREE.CanvasTexture(canvas);
  texture.magFilter   = THREE.NearestFilter;           // pixelated up close
  texture.minFilter   = THREE.NearestMipmapLinearFilter; // mipmapped at distance (auto-generated)
  texture.flipY       = false;
  return texture;
}
