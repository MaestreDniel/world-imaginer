import { type BiomeId } from "../biomes";
import { type Viewport, pixelToWorld } from "./viewport";
import { mapColor } from "./colors";

export interface MarkerLayer {
  draw(viewport: Viewport, ctx: CanvasRenderingContext2D): void;
}

/**
 * Reserved for future structure-marker work (pyramids, igloos, etc.).
 * Currently empty; pixel pass renders alone.
 */
export const MARKER_LAYERS: MarkerLayer[] = [];

export type ClassifyFn = (wx: number, wz: number) => { biome: BiomeId; height: number };

/**
 * Two-pass renderer: pixel pass fills ImageData; marker pass invokes
 * any registered MarkerLayer entries.
 *
 * pixelStep > 1 samples one classify per N×N block of canvas pixels
 * and fills the block uniformly. Used to keep pan-drag interactive:
 * the iteration count is canvas-pixel-bound (zoom doesn't reduce it),
 * so a 1920×1000 canvas at pixelStep=1 evaluates ~1.9M classify
 * calls (~1.5 s); at pixelStep=8 it's ~30k (~30 ms).
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
  pixelStep: number = 1,
): void {
  const img = ctx.createImageData(viewport.width, viewport.height);
  const data = img.data;
  for (let py = 0; py < viewport.height; py += pixelStep) {
    for (let px = 0; px < viewport.width; px += pixelStep) {
      const { wx, wz } = pixelToWorld(viewport, px, py);
      const { biome, height } = classify(wx, wz);
      const rgb = mapColor(biome, height, waterLevel);
      const r = (rgb >> 16) & 0xff;
      const g = (rgb >>  8) & 0xff;
      const b =  rgb        & 0xff;
      const pyEnd = Math.min(py + pixelStep, viewport.height);
      const pxEnd = Math.min(px + pixelStep, viewport.width);
      for (let by = py; by < pyEnd; by++) {
        for (let bx = px; bx < pxEnd; bx++) {
          const idx = (by * viewport.width + bx) * 4;
          data[idx]     = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const layer of MARKER_LAYERS) layer.draw(viewport, ctx);
}
