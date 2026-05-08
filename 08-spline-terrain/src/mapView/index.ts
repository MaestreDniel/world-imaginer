import { type GenerationParams } from "../generationParams";
import { classifyBiome, createBiomeSampler } from "../biomes";
import { createTerrainShaper } from "../terrainShape";
import { type Viewport, ZOOM_LEVELS } from "./viewport";
import { renderMap, type ClassifyFn } from "./render";

export interface MapViewHandle {
  show(): void;
  hide(): void;
  refresh(): void;
  /** Recenter the map at the given world coordinate. No-op until shown. */
  setCenter(wx: number, wz: number): void;
}

export interface MapViewConfig {
  canvas:         HTMLCanvasElement;
  tooltipEl:      HTMLElement;
  coordReadoutEl: HTMLElement;
  getSeedAndParams: () => { seed: number; params: GenerationParams; waterLevel: number };
  onTeleport:     (wx: number, wz: number, surfaceY: number) => void;
}

function buildClassifier(seed: number, params: GenerationParams): ClassifyFn {
  const shaper  = createTerrainShaper(seed, params);
  const climate = createBiomeSampler(seed, params.biomes);
  return (wx, wz) => {
    const sample = shaper.sampleClimate(wx, wz);
    const height = shaper.heightFromClimate(sample);
    const { temp, humid } = climate(wx, wz);
    const biome = classifyBiome(
      sample.continentalness, sample.erosion, sample.peaksValleys,
      temp, humid, params.biomePicker,
    );
    return { biome, height };
  };
}

export function createMapView(cfg: MapViewConfig): MapViewHandle {
  const ctx = cfg.canvas.getContext("2d");
  if (!ctx) throw new Error("createMapView: 2D context not available");

  const viewport: Viewport = {
    cx: 0,
    cz: 0,
    blocksPerPixel: ZOOM_LEVELS[0],   // start at 1 block/pixel
    width:  0,
    height: 0,
  };

  let classify: ClassifyFn = buildClassifier(0, cfg.getSeedAndParams().params);
  let waterLevel = 0;
  let isShown = false;
  let dirty = true;

  function sizeCanvasToViewport(): void {
    // Map canvas fills width below the toolbar (top:80px) and goes to bottom.
    const width  = window.innerWidth;
    const height = window.innerHeight - 80;
    cfg.canvas.width  = width;
    cfg.canvas.height = height;
    viewport.width  = width;
    viewport.height = height;
  }

  function rebuildClassifier(): void {
    const { seed, params, waterLevel: wl } = cfg.getSeedAndParams();
    classify = buildClassifier(seed, params);
    waterLevel = wl;
  }

  function render(): void {
    sizeCanvasToViewport();
    renderMap(ctx!, viewport, classify, waterLevel);
    dirty = false;
  }

  function show(): void {
    isShown = true;
    cfg.canvas.style.display = "block";
    cfg.coordReadoutEl.style.display = "block";
    if (dirty) {
      rebuildClassifier();
      render();
    }
  }

  function hide(): void {
    isShown = false;
    cfg.canvas.style.display = "none";
    cfg.tooltipEl.style.display = "none";
    cfg.coordReadoutEl.style.display = "none";
  }

  function refresh(): void {
    if (!isShown) {
      dirty = true;
      return;
    }
    rebuildClassifier();
    render();
  }

  function setCenter(wx: number, wz: number): void {
    viewport.cx = wx;
    viewport.cz = wz;
    if (isShown) render();
  }

  return { show, hide, refresh, setCenter };
}
