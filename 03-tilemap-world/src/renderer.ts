import { BLOCK_DEFS } from "./blocks";
import { CHUNK_W, WORLD_H } from "./chunk";
import { World } from "./world";

/**
 * Renders the world to a canvas.
 *
 * The renderer works in world-pixel coordinates. The camera position
 * determines which part of the world is visible. Only the visible
 * chunks are fetched from the World (which triggers generation if
 * they haven't been created yet).
 *
 * Rendering uses ImageData for bulk pixel writes — much faster than
 * individual fillRect calls when drawing thousands of tiles.
 */

export interface Camera {
  x: number;  // World-pixel X (top-left of viewport)
  y: number;  // World-pixel Y (top-left of viewport)
  tileSize: number;
}

// Pre-compute RGB values
const blockRgb = new Map<number, [number, number, number]>();
for (const [id, def] of Object.entries(BLOCK_DEFS)) {
  const n = parseInt(def.color.slice(1), 16);
  blockRgb.set(Number(id), [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
): void {
  const { width, height } = ctx.canvas;
  const { x: camX, y: camY, tileSize } = camera;

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Range of visible tiles
  const startTileX = Math.floor(camX / tileSize);
  const startTileY = Math.floor(camY / tileSize);
  const tilesAcross = Math.ceil(width / tileSize) + 1;
  const tilesDown = Math.ceil(height / tileSize) + 1;

  // Determine which chunks we need
  const minChunk = Math.floor(startTileX / CHUNK_W);
  const maxChunk = Math.floor((startTileX + tilesAcross) / CHUNK_W);

  // Pre-fetch visible chunks
  for (let cx = minChunk; cx <= maxChunk; cx++) {
    world.getChunk(cx);
  }

  // Render tile by tile
  for (let ty = 0; ty < tilesDown; ty++) {
    const worldY = startTileY + ty;
    if (worldY < 0 || worldY >= WORLD_H) continue;

    for (let tx = 0; tx < tilesAcross; tx++) {
      const worldX = startTileX + tx;
      const block = world.getBlock(worldX, worldY);
      const rgb = blockRgb.get(block);
      if (!rgb) continue;

      const screenX = Math.floor(worldX * tileSize - camX);
      const screenY = Math.floor(worldY * tileSize - camY);

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
