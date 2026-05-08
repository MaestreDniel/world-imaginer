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
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
): void {
  const img = ctx.createImageData(viewport.width, viewport.height);
  const data = img.data;
  for (let py = 0; py < viewport.height; py++) {
    for (let px = 0; px < viewport.width; px++) {
      const { wx, wz } = pixelToWorld(viewport, px, py);
      const { biome, height } = classify(wx, wz);
      const rgb = mapColor(biome, height, waterLevel);
      const idx = (py * viewport.width + px) * 4;
      data[idx]     = (rgb >> 16) & 0xff;
      data[idx + 1] = (rgb >>  8) & 0xff;
      data[idx + 2] =  rgb        & 0xff;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const layer of MARKER_LAYERS) layer.draw(viewport, ctx);
}
