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
 * Clear a tile slot to transparent (alpha = 0) and run a painter that
 * draws opaque pixels for an alpha-cut sprite. Used by all cross-shape
 * vegetation sprites — never for cube tiles, whose pixels must remain α=255.
 */
function drawSpriteTile(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  draw: (ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number) => void,
  rngSeed: number,
): void {
  const x0 = tileX(col);
  const y0 = tileY(row);
  ctx.clearRect(x0, y0, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
  const rng = makeLcg(rngSeed);
  draw(ctx, x0, y0, rng);
}

/** Paint a single opaque pixel at (px, py) within the tile content area. */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function drawBush(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const cx = 8, cy = 11, r = 4.5;
  const palette = ["#355E29", "#4A7C3A", "#6BA34D"];
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      // Slightly noisy edge: skip ~25% of border pixels
      if (d > r - 0.8 && rng() < 0.25) continue;
      const c = palette[(rng() * palette.length) | 0];
      px(ctx, x0 + cx + dx, y0 + cy + dy, c);
    }
  }
  // A few darker shadow pixels in the lower half
  for (let i = 0; i < 6; i++) {
    px(ctx, x0 + 5 + ((rng() * 7) | 0), y0 + 12 + ((rng() * 3) | 0), "#23401C");
  }
}

function drawDeadBush(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const palette = ["#6F4A1F", "#8C6A3A", "#5A3A18"];
  // 6 thin twigs from the bottom centre
  for (let i = 0; i < 6; i++) {
    const startX = 6 + ((rng() * 5) | 0);
    const startY = 14;
    const endX = 4 + ((rng() * 9) | 0);
    const endY = 4 + ((rng() * 6) | 0);
    const c = palette[(rng() * palette.length) | 0];
    // Draw a 1-px line from start to end
    const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const xx = Math.round(startX + (endX - startX) * t);
      const yy = Math.round(startY + (endY - startY) * t);
      px(ctx, x0 + xx, y0 + yy, c);
    }
  }
}

function drawFern(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const stemX = 8;
  const stem = "#356C2E";
  const frond = "#4A8C3A";
  // Vertical stem from y=2 to y=15
  for (let y = 2; y <= 15; y++) px(ctx, x0 + stemX, y0 + y, stem);
  // Side fronds at alternating heights
  for (let y = 4; y <= 14; y += 2) {
    const len = 1 + ((rng() * 3) | 0);
    const sideRight = (y & 1) === 0;
    for (let i = 1; i <= len; i++) {
      const xx = stemX + (sideRight ? i : -i);
      // Fronds taper diagonally upward away from the stem
      const yy = y - ((i / 2) | 0);
      if (xx >= 0 && xx < 16 && yy >= 0 && yy < 16) {
        px(ctx, x0 + xx, y0 + yy, frond);
      }
    }
    // Mirror on the other side as well
    for (let i = 1; i <= len; i++) {
      const xx = stemX + (sideRight ? -i : i);
      const yy = y - ((i / 2) | 0);
      if (xx >= 0 && xx < 16 && yy >= 0 && yy < 16) {
        px(ctx, x0 + xx, y0 + yy, frond);
      }
    }
  }
}

function drawTallGrass(ctx: CanvasRenderingContext2D, x0: number, y0: number, rng: () => number): void {
  const palette = ["#4FA035", "#69B040", "#82C455"];
  // 8–10 vertical strands in the bottom half
  const count = 8 + ((rng() * 3) | 0);
  for (let i = 0; i < count; i++) {
    const sx = 1 + ((rng() * 14) | 0);
    const top = 9 + ((rng() * 3) | 0);
    const c = palette[(rng() * palette.length) | 0];
    for (let y = top; y <= 15; y++) px(ctx, x0 + sx, y0 + y, c);
  }
}

function drawFlower(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number,
  petalColor: string, centerColor: string,
): void {
  // Stem
  const stem = "#355E29";
  for (let y = 8; y <= 15; y++) px(ctx, x0 + 8, y0 + y, stem);
  // Two leaves on the stem
  px(ctx, x0 + 7, y0 + 11, stem);
  px(ctx, x0 + 9, y0 + 13, stem);
  // 3×3 petal blob centred at (8, 5), with a 1-px centre
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      px(ctx, x0 + 8 + dx, y0 + 5 + dy, petalColor);
    }
  }
  // Four extra petal pixels in cardinal positions for a flower look
  px(ctx, x0 + 8, y0 + 3, petalColor);
  px(ctx, x0 + 8, y0 + 7, petalColor);
  px(ctx, x0 + 6, y0 + 5, petalColor);
  px(ctx, x0 + 10, y0 + 5, petalColor);
  // Centre pixel
  px(ctx, x0 + 8, y0 + 5, centerColor);
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
 * Build a 256×256 CanvasTexture atlas with procedural placeholder tiles.
 * Each 16×16 tile sits inside a 32×32 power-of-two slot with an extruded
 * gutter so GPU-generated mipmaps stay isolated for the useful mip range.
 * To swap in a real atlas: replace this function with a TextureLoader call
 * that returns a Promise<THREE.Texture> — no other files need to change.
 */
export function buildAtlasTexture(): THREE.CanvasTexture {
  const canvas    = document.createElement("canvas");
  canvas.width    = ATLAS_COLS * ATLAS_TILE_PADDED;   // 256
  canvas.height   = ATLAS_ROWS * ATLAS_TILE_PADDED;   // 256
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
    [TILE_IDS.Moss,         0x4F8B3C, 0.10],
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

  // ── Cross-sprite vegetation tiles (alpha-cut) ───────────────────────────────
  drawSpriteTile(ctx, tc(TILE_IDS.Bush),         tr(TILE_IDS.Bush),         drawBush,      TILE_IDS.Bush + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.DeadBush),     tr(TILE_IDS.DeadBush),     drawDeadBush,  TILE_IDS.DeadBush + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.Fern),         tr(TILE_IDS.Fern),         drawFern,      TILE_IDS.Fern + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.TallGrass),    tr(TILE_IDS.TallGrass),    drawTallGrass, TILE_IDS.TallGrass + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.FlowerRed),    tr(TILE_IDS.FlowerRed),
    (c, x, y) => drawFlower(c, x, y, "#C04040", "#822323"),
    TILE_IDS.FlowerRed + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.FlowerYellow), tr(TILE_IDS.FlowerYellow),
    (c, x, y) => drawFlower(c, x, y, "#E8C440", "#9E7A1A"),
    TILE_IDS.FlowerYellow + 4000);
  drawSpriteTile(ctx, tc(TILE_IDS.FlowerBlue),   tr(TILE_IDS.FlowerBlue),
    (c, x, y) => drawFlower(c, x, y, "#5C7CC8", "#2F3F7A"),
    TILE_IDS.FlowerBlue + 4000);

  // Extrude every non-Air, non-sprite tile so mipmap averaging never samples
  // empty canvas. Sprite tiles are intentionally skipped — extruding their
  // alpha-zero borders would bleed the canvas-clear back into the content.
  const SPRITE_TILE_IDS = new Set<number>([
    TILE_IDS.Bush, TILE_IDS.DeadBush, TILE_IDS.Fern, TILE_IDS.TallGrass,
    TILE_IDS.FlowerRed, TILE_IDS.FlowerYellow, TILE_IDS.FlowerBlue,
  ]);
  const allTileIds = Object.values(TILE_IDS).filter(
    id => id !== TILE_IDS.Air && !SPRITE_TILE_IDS.has(id),
  );
  for (const id of allTileIds) {
    extrudeTile(ctx, tc(id), tr(id));
  }

  const texture       = new THREE.CanvasTexture(canvas);
  texture.magFilter   = THREE.NearestFilter;              // pixelated up close
  texture.minFilter   = THREE.LinearMipmapLinearFilter;   // smooth trilinear minification at distance
  texture.wrapS       = THREE.ClampToEdgeWrapping;
  texture.wrapT       = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.flipY       = false;
  return texture;
}
