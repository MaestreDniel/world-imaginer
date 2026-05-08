import { type GenerationParams } from "../generationParams";
import { classifyBiome, createBiomeSampler } from "../biomes";
import { createTerrainShaper } from "../terrainShape";
import { type Viewport, ZOOM_LEVELS, pixelToWorld, zoomIn, zoomOut } from "./viewport";
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

  // ── Pan ─────────────────────────────────────────────────────────────
  type DragState = { active: boolean; startX: number; startY: number; movedPx: number };
  const drag: DragState = { active: false, startX: 0, startY: 0, movedPx: 0 };

  const onMouseDown = (e: MouseEvent) => {
    drag.active = true;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.movedPx = 0;
    cfg.canvas.style.cursor = "grabbing";
  };

  const onMouseMoveDrag = (e: MouseEvent) => {
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.movedPx = Math.max(drag.movedPx, Math.abs(dx) + Math.abs(dy));
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    viewport.cx -= dx * viewport.blocksPerPixel;
    viewport.cz -= dy * viewport.blocksPerPixel;
    render();
  };

  const onMouseUp = (_e: MouseEvent) => {
    drag.active = false;
    cfg.canvas.style.cursor = "grab";
  };

  // ── Zoom ────────────────────────────────────────────────────────────
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = cfg.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const before = pixelToWorld(viewport, px, py);
    const next = e.deltaY < 0 ? zoomIn(viewport.blocksPerPixel) : zoomOut(viewport.blocksPerPixel);
    if (next === viewport.blocksPerPixel) return;   // already at the end
    viewport.blocksPerPixel = next;
    const after = pixelToWorld(viewport, px, py);
    viewport.cx += before.wx - after.wx;
    viewport.cz += before.wz - after.wz;
    render();
  };

  function show(): void {
    isShown = true;
    cfg.canvas.style.display = "block";
    cfg.coordReadoutEl.style.display = "block";
    cfg.canvas.addEventListener("mousedown",  onMouseDown);
    window.addEventListener     ("mousemove", onMouseMoveDrag);
    window.addEventListener     ("mouseup",   onMouseUp);
    cfg.canvas.addEventListener("wheel", onWheel, { passive: false });
    if (dirty) {
      rebuildClassifier();
      render();
    } else {
      render();   // ensure canvas resized to current window
    }
  }

  function hide(): void {
    isShown = false;
    cfg.canvas.style.display = "none";
    cfg.tooltipEl.style.display = "none";
    cfg.coordReadoutEl.style.display = "none";
    cfg.canvas.removeEventListener("mousedown",  onMouseDown);
    window.removeEventListener    ("mousemove", onMouseMoveDrag);
    window.removeEventListener    ("mouseup",   onMouseUp);
    cfg.canvas.removeEventListener("wheel", onWheel);
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
