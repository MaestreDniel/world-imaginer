import { BLOCK_COLORS } from "./terrain";

/**
 * Renders the terrain grid to a canvas.
 *
 * Uses ImageData for pixel-level rendering — each tile is drawn as a
 * square of pixels. This is much faster than calling fillRect() for
 * every tile, which would be thousands of draw calls.
 *
 * The renderer also supports a camera offset so we can scroll/pan
 * through worlds larger than the viewport.
 */

export interface Camera {
  x: number;
  y: number;
  tileSize: number;
}

/** Parse a hex color string to [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Pre-compute RGB values for each block type
const blockRgb = new Map<number, [number, number, number]>();
for (const [key, hex] of Object.entries(BLOCK_COLORS)) {
  blockRgb.set(Number(key), hexToRgb(hex));
}

export function renderTerrain(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array[],
  camera: Camera,
): void {
  const { width, height } = ctx.canvas;
  const { x: camX, y: camY, tileSize } = camera;

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Which tiles are visible
  const startTileX = Math.floor(camX / tileSize);
  const startTileY = Math.floor(camY / tileSize);
  const tilesAcross = Math.ceil(width / tileSize) + 1;
  const tilesDown = Math.ceil(height / tileSize) + 1;

  const worldH = grid.length;
  const worldW = grid[0]?.length ?? 0;

  for (let ty = 0; ty < tilesDown; ty++) {
    const worldY = startTileY + ty;
    if (worldY < 0 || worldY >= worldH) continue;

    const row = grid[worldY];

    for (let tx = 0; tx < tilesAcross; tx++) {
      const worldX = startTileX + tx;
      if (worldX < 0 || worldX >= worldW) continue;

      const block = row[worldX];
      const rgb = blockRgb.get(block);
      if (!rgb) continue;

      // Pixel position on screen
      const screenX = Math.floor(worldX * tileSize - camX);
      const screenY = Math.floor(worldY * tileSize - camY);

      // Fill the tile rectangle in the image data
      const x0 = Math.max(0, screenX);
      const y0 = Math.max(0, screenY);
      const x1 = Math.min(width, screenX + tileSize);
      const y1 = Math.min(height, screenY + tileSize);

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * width + px) * 4;
          data[i] = rgb[0];
          data[i + 1] = rgb[1];
          data[i + 2] = rgb[2];
          data[i + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
