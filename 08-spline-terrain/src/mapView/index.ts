import { type GenerationParams } from "../generationParams";
import { Biome, classifyBiome, createBiomeSampler, BIOME_DEFS, type BiomeId } from "../biomes";
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

const BIOME_NAMES: Record<BiomeId, string> = Object.fromEntries(
  Object.entries(BIOME_DEFS).map(([id, def]) => [Number(id), def.name]),
) as Record<BiomeId, string>;
void Biome;   // kept around in case a future feature needs the value

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
    // Only assign width/height when they actually change — assigning to a
    // canvas dimension always clears the bitmap and reallocates the backing
    // store, which is expensive enough to tank pan-drag fps.
    const width  = window.innerWidth;
    const height = window.innerHeight - 80;
    if (cfg.canvas.width  !== width)  cfg.canvas.width  = width;
    if (cfg.canvas.height !== height) cfg.canvas.height = height;
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
    cfg.coordReadoutEl.textContent =
      `center: (${viewport.cx.toFixed(0)}, ${viewport.cz.toFixed(0)})  zoom: ${viewport.blocksPerPixel}b/px`;
    dirty = false;
  }

  // ── Pan ─────────────────────────────────────────────────────────────
  type DragState = { active: boolean; startX: number; startY: number; movedPx: number };
  const drag: DragState = { active: false, startX: 0, startY: 0, movedPx: 0 };
  let dragFrameQueued = false;

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
    // Coalesce multiple mousemove events per frame: render fires at rAF
    // cadence so a fast drag doesn't queue up renders that take longer
    // than the gap between events.
    if (!dragFrameQueued) {
      dragFrameQueued = true;
      requestAnimationFrame(() => {
        dragFrameQueued = false;
        render();
      });
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    const wasClick = drag.active && drag.movedPx < 5;
    drag.active = false;
    cfg.canvas.style.cursor = "grab";

    if (!wasClick) return;

    // Determine pixel under cursor relative to the map canvas.
    const rect = cfg.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < 0 || py < 0 || px >= viewport.width || py >= viewport.height) return;

    const { wx, wz } = pixelToWorld(viewport, px, py);
    const { height } = classify(wx, wz);
    cfg.onTeleport(wx, wz, height);
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

  // ── Hover tooltip ───────────────────────────────────────────────────
  let hoverPx = 0;
  let hoverPy = 0;
  let hoverActive = false;
  let hoverFrameQueued = false;

  const onMouseMoveHover = (e: MouseEvent) => {
    if (drag.active) {
      cfg.tooltipEl.style.display = "none";
      return;
    }
    const rect = cfg.canvas.getBoundingClientRect();
    hoverPx = e.clientX - rect.left;
    hoverPy = e.clientY - rect.top;
    hoverActive = (hoverPx >= 0 && hoverPy >= 0 && hoverPx < viewport.width && hoverPy < viewport.height);
    if (!hoverActive) {
      cfg.tooltipEl.style.display = "none";
      return;
    }
    if (!hoverFrameQueued) {
      hoverFrameQueued = true;
      requestAnimationFrame(updateTooltip);
    }
  };

  const onMouseLeave = () => {
    hoverActive = false;
    cfg.tooltipEl.style.display = "none";
  };

  function updateTooltip(): void {
    hoverFrameQueued = false;
    if (!hoverActive || !isShown) return;
    const { wx, wz } = pixelToWorld(viewport, hoverPx, hoverPy);
    // Sample full climate for a richer readout (extra cost is one mousemove sample).
    const { seed, params } = cfg.getSeedAndParams();
    const shaper  = createTerrainShaper(seed, params);
    const climate = createBiomeSampler(seed, params.biomes);
    const sample = shaper.sampleClimate(wx, wz);
    const height = shaper.heightFromClimate(sample);
    const { temp, humid } = climate(wx, wz);
    const biome = classifyBiome(
      sample.continentalness, sample.erosion, sample.peaksValleys,
      temp, humid, params.biomePicker,
    );
    const biomeName = BIOME_NAMES[biome] ?? `#${biome}`;
    cfg.tooltipEl.textContent =
      `(wx=${wx.toFixed(0)}, wz=${wz.toFixed(0)})\n` +
      `biome:  ${biomeName}\n` +
      `height: ${height.toFixed(1)}\n` +
      `temp:   ${temp.toFixed(2)}   humid: ${humid.toFixed(2)}\n` +
      `cont:   ${sample.continentalness.toFixed(2)}   eros: ${sample.erosion.toFixed(2)}\n` +
      `pv:     ${sample.peaksValleys.toFixed(2)}`;
    cfg.tooltipEl.style.display = "block";
    cfg.tooltipEl.style.left = `${hoverPx + 16}px`;
    cfg.tooltipEl.style.top  = `${hoverPy + 80 + 16}px`;   // 80 = toolbar offset
  }

  function show(): void {
    isShown = true;
    cfg.canvas.style.display = "block";
    cfg.coordReadoutEl.style.display = "block";
    cfg.canvas.addEventListener("mousedown",  onMouseDown);
    window.addEventListener     ("mousemove", onMouseMoveDrag);
    window.addEventListener     ("mouseup",   onMouseUp);
    cfg.canvas.addEventListener("wheel", onWheel, { passive: false });
    cfg.canvas.addEventListener("mousemove",  onMouseMoveHover);
    cfg.canvas.addEventListener("mouseleave", onMouseLeave);
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
    cfg.canvas.removeEventListener("mousemove",  onMouseMoveHover);
    cfg.canvas.removeEventListener("mouseleave", onMouseLeave);
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
