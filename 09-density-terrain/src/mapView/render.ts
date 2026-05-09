import { type BiomeId } from "../biomes";
import { type Viewport } from "./viewport";
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

interface ScratchCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

let scratch: ScratchCanvas | null = null;

function getScratchCanvas(ctx: CanvasRenderingContext2D): ScratchCanvas {
  if (scratch) return scratch;
  const canvas = ctx.canvas.ownerDocument.createElement("canvas");
  const scratchCtx = canvas.getContext("2d");
  if (!scratchCtx) throw new Error("renderMap: scratch 2D context not available");
  scratch = { canvas, ctx: scratchCtx };
  return scratch;
}

function colorPixel(data: Uint8ClampedArray, idx: number, rgb: number): void {
  data[idx]     = (rgb >> 16) & 0xff;
  data[idx + 1] = (rgb >>  8) & 0xff;
  data[idx + 2] =  rgb        & 0xff;
  data[idx + 3] = 255;
}

export function renderMapRows(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
  yStart: number,
  yEnd: number,
): void {
  const startY = Math.max(0, Math.floor(yStart));
  const endY = Math.min(viewport.height, Math.ceil(yEnd));
  if (endY <= startY) return;

  const rowCount = endY - startY;
  const img = ctx.createImageData(viewport.width, rowCount);
  const data = img.data;
  const left = viewport.cx - viewport.width / 2 * viewport.blocksPerPixel;
  const top  = viewport.cz - viewport.height / 2 * viewport.blocksPerPixel;
  for (let py = startY; py < endY; py++) {
    const wz = top + py * viewport.blocksPerPixel;
    const localY = py - startY;
    for (let px = 0; px < viewport.width; px++) {
      const wx = left + px * viewport.blocksPerPixel;
      const { biome, height } = classify(wx, wz);
      colorPixel(data, (localY * viewport.width + px) * 4, mapColor(biome, height, waterLevel));
    }
  }
  ctx.putImageData(img, 0, startY);
}

function renderFullResolution(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
): void {
  renderMapRows(ctx, viewport, classify, waterLevel, 0, viewport.height);
}

function renderStepped(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
  pixelStep: number,
): void {
  const lowWidth = Math.ceil(viewport.width / pixelStep);
  const lowHeight = Math.ceil(viewport.height / pixelStep);
  const { canvas, ctx: scratchCtx } = getScratchCanvas(ctx);
  if (canvas.width !== lowWidth) canvas.width = lowWidth;
  if (canvas.height !== lowHeight) canvas.height = lowHeight;

  const img = scratchCtx.createImageData(lowWidth, lowHeight);
  const data = img.data;
  const left = viewport.cx - viewport.width / 2 * viewport.blocksPerPixel;
  const top  = viewport.cz - viewport.height / 2 * viewport.blocksPerPixel;
  const worldStep = pixelStep * viewport.blocksPerPixel;
  for (let ly = 0; ly < lowHeight; ly++) {
    const wz = top + ly * worldStep;
    for (let lx = 0; lx < lowWidth; lx++) {
      const wx = left + lx * worldStep;
      const { biome, height } = classify(wx, wz);
      colorPixel(data, (ly * lowWidth + lx) * 4, mapColor(biome, height, waterLevel));
    }
  }

  scratchCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.drawImage(canvas, 0, 0, lowWidth * pixelStep, lowHeight * pixelStep);
}

/**
 * Two-pass renderer: pixel pass fills ImageData; marker pass invokes
 * any registered MarkerLayer entries.
 *
 * pixelStep > 1 samples one classify per N×N block of canvas pixels
 * into a small scratch canvas and scales it up with smoothing disabled.
 * This keeps pan-drag interactive by reducing both classification work
 * and ImageData memory writes.
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  classify: ClassifyFn,
  waterLevel: number,
  pixelStep: number = 1,
): void {
  if (pixelStep <= 1) {
    renderFullResolution(ctx, viewport, classify, waterLevel);
  } else {
    renderStepped(ctx, viewport, classify, waterLevel, pixelStep);
  }
  drawMarkerLayers(ctx, viewport);
}

export function drawMarkerLayers(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  for (const layer of MARKER_LAYERS) layer.draw(viewport, ctx);
}
