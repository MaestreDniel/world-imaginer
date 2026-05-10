// 07-advanced-terrain/src/debugPanel.ts

import {
  type GenerationParams,
  DEFAULT_PARAMS,
  cloneParams,
} from "./generationParams";
import type { Spline, AnchoredSpline } from "./splines";
import {
  buildSplineGraph,
  buildAnchoredSplineGraph,
  buildSplineShapeToolbar,
  Y_RANGE_CONTINENT,
  Y_RANGE_EROSION,
  Y_RANGE_PV,
  X_RANGE,
} from "./splineEditor";
import type { DayNightState, DayNightFrame } from "./dayNight";
import { type BiomeBox } from "./biomeBoxes";
import { BIOME_DEFS, CAVE_BIOME_DEFS, SURFACE_REGISTRY, CAVE_REGISTRY } from "./biomes";

// ── Slider definition metadata ─────────────────────────────────────
interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Optional hover tooltip explaining what the knob does and which way is which. */
  description?: string;
}

interface SectionDef {
  id: string;
  label: string;
  paramsKey: keyof GenerationParams;
  subKey?: string;           // nested field inside params[paramsKey]
  expanded: boolean;
  sliders: SliderDef[];
  toggle?: { key: string; label: string };
}

// ── Climate section factory ────────────────────────────────────────
function climateSection(
  id: string,
  label: string,
  subKey: string,
  scaleMin: number,
  scaleMax: number,
  scaleStep: number,
): SectionDef {
  return {
    id, label, paramsKey: "climate", subKey, expanded: false,
    sliders: [
      { key: "scale",       label: "Scale",       min: scaleMin, max: scaleMax, step: scaleStep, decimals: 0 },
      { key: "octaves",     label: "Octaves",     min: 1,   max: 6,   step: 1,    decimals: 0 },
      { key: "persistence", label: "Persistence", min: 0.1, max: 0.9, step: 0.01, decimals: 2 },
      { key: "lacunarity",  label: "Lacunarity",  min: 1.5, max: 3,   step: 0.05, decimals: 2 },
    ],
  };
}

const SECTIONS: SectionDef[] = [
  {
    id: "extent", label: "World Extent", paramsKey: "extent", expanded: false,
    sliders: [
      { key: "minHeight", label: "Min Height", min: -128, max:   0, step: 1, decimals: 0 },
      { key: "maxHeight", label: "Max Height", min:    0, max: 256, step: 1, decimals: 0 },
    ],
  },
  {
    id: "density", label: "Density Field", paramsKey: "density", expanded: false,
    sliders: [
      {
        key: "jaggedScale",    label: "Jagged Scale",    min: 6,    max: 60,   step: 1,     decimals: 0,
        description:
          "3D noise period for the trilerp jagged term, in voxels.\n" +
          "Should be comparable to the corner spacing (4 horizontal, 8 vertical).\n" +
          "↓ smaller = adjacent corners differ more = bumpier per cell, more cliffy\n" +
          "↑ larger = neighbors read similar values = smoother per cell",
      },
      {
        key: "jaggedFalloff",  label: "Jagged Falloff",  min: 4,    max: 64,   step: 1,     decimals: 0,
        description:
          "Vertical falloff of the jagged envelope around offset, in voxels.\n" +
          "Outside ±this many voxels of the column's offset, jagged is zero.\n" +
          "↑ larger = jagged contributes far above/below the surface (risk of floating chunks of solid in the sky)\n" +
          "↓ smaller = jagged stays at the surface band only",
      },
      {
        key: "jaggedOctaves",  label: "Jagged Octaves",  min: 1,    max: 6,    step: 1,     decimals: 0,
        description:
          "fBm octave count for the jagged 3D noise.\n" +
          "↑ more = finer detail layered into the noise (slower)\n" +
          "↓ fewer = simpler shapes",
      },
      {
        key: "caveScale",      label: "Cave Scale",      min: 20,   max: 160,  step: 1,     decimals: 0,
        description:
          "3D noise period for the cave term, in voxels.\n" +
          "↑ larger = bigger caverns, longer tunnels\n" +
          "↓ smaller = tighter, narrower tunnels",
      },
      {
        key: "caveThreshold",  label: "Cave Threshold",  min: 0,    max: 0.3,  step: 0.005, decimals: 3,
        description:
          "|noise| < threshold counts as inside a tunnel.\n" +
          "↑ larger = wider tunnels, more caves overall\n" +
          "↓ smaller = narrower, fewer caves\n" +
          "0 = no caves at all",
      },
      {
        key: "caveDepthRange", label: "Cave Depth Range", min: 4,   max: 96,   step: 1,     decimals: 0,
        description:
          "Voxels below sea level where the cave term reaches full strength.\n" +
          "↑ larger = caves only appear deep underground\n" +
          "↓ smaller = caves come right up near the surface",
      },
      {
        key: "factorMin",      label: "Factor Min",      min: 0.1,  max: 4.0,  step: 0.05,  decimals: 2,
        description:
          "Lower clamp on the per-column factor (used in eroded plains).\n" +
          "factor scales the base term `(offset - y) × factor` — i.e. how stiff the surface is.\n" +
          "↑ higher = even plains have a stiff base = sharper plain-edge transitions\n" +
          "↓ lower = soft, rolling plains where 3D noise dominates",
      },
      {
        key: "factorMax",      label: "Factor Max",      min: 1.0,  max: 12.0, step: 0.1,   decimals: 1,
        description:
          "Upper clamp on the per-column factor (used in mountainous regions).\n" +
          "Counterintuitive: HIGHER factor → SMOOTHER mountains, because the base\n" +
          "term gets so stiff that jagged + detail noise can no longer flip the sign\n" +
          "near the surface. LOWER factor → softer base → more chaos / overhangs.\n" +
          "↑ higher = clean cliff faces, mountains track offset closely\n" +
          "↓ lower = jagged and detail dominate, dramatic sub-voxel chaos",
      },
    ],
  },
  {
    id: "aquifers", label: "Aquifers & Lakes", paramsKey: "aquifers", expanded: false,
    toggle: { key: "enabled", label: "Enabled" },
    sliders: [
      { key: "presenceScale",     label: "Presence Scale",     min: 40,  max: 400, step: 5,    decimals: 0 },
      { key: "presenceThreshold", label: "Presence Threshold", min: 0.1, max: 0.7, step: 0.01, decimals: 2 },
      { key: "levelScale",        label: "Level Scale",        min: 100, max: 2000, step: 20,   decimals: 0 },
      { key: "levelAmplitude",    label: "Level Amplitude",    min: 0,   max: 30,  step: 0.5,  decimals: 1 },
      { key: "levelOffset",       label: "Level Offset",       min: -20, max: 30,  step: 0.5,  decimals: 1 },
    ],
  },
  {
    id: "biomes", label: "Biomes", paramsKey: "biomes", expanded: false,
    sliders: [
      { key: "tempHumidityScale", label: "Temp/Humidity Scale", min: 100, max: 600, step: 10, decimals: 0 },
    ],
  },
  {
    id: "ores", label: "Ores", paramsKey: "ores", expanded: false,
    sliders: [
      { key: "scale",          label: "Scale",           min: 2,   max: 20,  step: 1,    decimals: 0 },
      { key: "ironThreshold",  label: "Iron Threshold",  min: 0.3, max: 0.8, step: 0.01, decimals: 2 },
      { key: "ironMinDepth",   label: "Iron Min Depth",  min: 5,   max: 30,  step: 1,    decimals: 0 },
      { key: "coalThreshold",  label: "Coal Threshold",  min: 0.3, max: 0.7, step: 0.01, decimals: 2 },
    ],
  },
  {
    id: "vegetation", label: "Vegetation", paramsKey: "vegetation", expanded: false,
    toggle: { key: "enabled", label: "Enabled" },
    sliders: [
      { key: "globalDensity", label: "Decoration Density", min: 0, max: 3, step: 0.05, decimals: 2 },
      { key: "treeDensity",   label: "Tree Density Mult.", min: 0, max: 3, step: 0.05, decimals: 2 },
    ],
  },
  climateSection("climate-cont", "Climate · Continentalness", "continentalness", 200, 4000, 10),
  climateSection("climate-ero",  "Climate · Erosion",         "erosion",         100, 2000, 10),
  climateSection("climate-pv",   "Climate · Peaks & Valleys", "peaksValleys",     40,  600,  5),
  {
    id: "biome-picker",          label: "Biome Picker · Depth", paramsKey: "biomePicker", expanded: false,
    sliders: [
      { key: "depthScale", label: "Depth Scale", min: 8, max: 256, step: 1, decimals: 0 },
    ],
  },
  {
    id: "biome-picker-weights",  label: "Biome Picker · Weights", paramsKey: "biomePicker", subKey: "weights", expanded: false,
    sliders: [
      { key: "temperature",  label: "Temperature",   min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "humidity",     label: "Humidity",      min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "continent",    label: "Continent",     min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "erosion",      label: "Erosion",       min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "peaksValleys", label: "Peaks/Valleys", min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: "depth",        label: "Depth",         min: 0, max: 4, step: 0.05, decimals: 2 },
    ],
  },
];

// ── Preset system ──────────────────────────────────────────────────
interface Preset {
  name: string;
  params: GenerationParams;
  builtIn: boolean;
}

const BUILT_IN_PRESETS: Preset[] = [
  { name: "Default", params: cloneParams(DEFAULT_PARAMS), builtIn: true },

  // Soft, rolling, almost-heightmap-feel terrain. High factor on both ends
  // means the base dominates → 3D noise can't flip signs → smooth surface.
  // Tighter jaggedFalloff also keeps any residual jagged contribution close
  // to the surface band so nothing floats.
  {
    name: "Smooth World", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      density: {
        ...DEFAULT_PARAMS.density,
        jaggedScale: 28,
        jaggedFalloff: 14,
        factorMin: 1.0,
        factorMax: 5.0,
      },
    },
  },

  // The opposite end: low factor + small jaggedScale + wider falloff. The
  // base is soft so jagged + detail dominate and produce extreme sub-voxel
  // chaos. Use this to see what overhangs/spires the system can produce.
  {
    name: "Razor Peaks", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      density: {
        ...DEFAULT_PARAMS.density,
        jaggedScale: 9,
        jaggedFalloff: 28,
        factorMin: 0.3,
        factorMax: 1.2,
      },
    },
  },

  // Floating-island vibe: very wide jaggedFalloff lets the jagged term
  // contribute density far above the column's offset, so noise-positive
  // pockets form floating solid above the regular surface.
  {
    name: "Sky Islands", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      density: {
        ...DEFAULT_PARAMS.density,
        jaggedScale: 16,
        jaggedFalloff: 56,
        jaggedOctaves: 4,
        factorMin: 0.4,
        factorMax: 1.4,
      },
    },
  },

  // Underground emphasis: caves come up near the surface and dominate
  // deep regions. Pair with the in-game render radius to actually see them.
  {
    name: "Cave Heavy", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      density: {
        ...DEFAULT_PARAMS.density,
        caveScale: 40,
        caveThreshold: 0.16,
        caveDepthRange: 18,
      },
    },
  },
];

const STORAGE_KEY_PRESETS = "world-imaginer-user-presets";
const STORAGE_KEY_POSITION = "world-imaginer-panel-pos";

function loadUserPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
    if (!raw) return [];
    return JSON.parse(raw).map((p: { name: string; params: GenerationParams }) => ({
      ...p, builtIn: false,
    }));
  } catch { return []; }
}

function saveUserPresets(presets: Preset[]): void {
  localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(
    presets.filter(p => !p.builtIn).map(p => ({ name: p.name, params: p.params })),
  ));
}

// ── Biome-box inspector ────────────────────────────────────────────
function renderBiomeBoxInspector(parent: HTMLElement): void {
  const container = document.createElement("details");
  container.className = "panel-section";
  const summary = document.createElement("summary");
  summary.textContent = "Biome Boxes (read-only)";
  container.appendChild(summary);

  const renderRow = (name: string, box: BiomeBox) => {
    const row = document.createElement("details");
    row.className = "biome-box-row";
    const sum = document.createElement("summary");
    sum.textContent = name;
    row.appendChild(sum);
    const list = document.createElement("ul");
    const fmt = (r: [number, number]) => `[${r[0].toFixed(2)}, ${r[1].toFixed(2)}]`;
    const axes: Array<[string, [number, number]]> = [
      ["temperature",  box.temperature],
      ["humidity",     box.humidity],
      ["continent",    box.continent],
      ["erosion",      box.erosion],
      ["peaksValleys", box.peaksValleys],
      ["depth",        box.depth],
    ];
    for (const [axisName, range] of axes) {
      const li = document.createElement("li");
      li.textContent = `${axisName.padEnd(13)} ${fmt(range)}`;
      list.appendChild(li);
    }
    row.appendChild(list);
    return row;
  };

  const surfaceHeader = document.createElement("h4");
  surfaceHeader.textContent = "Surface biomes";
  container.appendChild(surfaceHeader);
  for (const entry of SURFACE_REGISTRY) {
    container.appendChild(renderRow(BIOME_DEFS[entry.id].name, entry.box));
  }

  const caveHeader = document.createElement("h4");
  caveHeader.textContent = "Cave biomes";
  container.appendChild(caveHeader);
  for (const entry of CAVE_REGISTRY) {
    container.appendChild(renderRow(CAVE_BIOME_DEFS[entry.id].name, entry.box));
  }

  parent.appendChild(container);
}

// ── Panel class ────────────────────────────────────────────────────
export class DebugPanel {
  private container: HTMLDivElement;
  private params: GenerationParams;
  private onApply: (params: GenerationParams, randomizeSeed: boolean) => void;
  private onViewChange: (mode: "3d" | "map") => void;
  private sliderInputs = new Map<string, HTMLInputElement>();
  private sliderValues = new Map<string, HTMLSpanElement>();
  private toggleInputs = new Map<string, HTMLInputElement>();
  private sectionBodies = new Map<string, HTMLDivElement>();
  private sectionHeaders = new Map<string, HTMLDivElement>();
  private presetSelect!: HTMLSelectElement;
  private presets: Preset[];
  private randomizeSeedCheckbox!: HTMLInputElement;
  private visible = false;
  private minimized = false;
  private splineRerenders: Array<() => void> = [];
  private dayNightState: DayNightState | null = null;
  private dnTimeSlider:   HTMLInputElement | null = null;
  private dnTimeLabel:    HTMLSpanElement | null = null;
  private dnCycleSlider:  HTMLInputElement | null = null;
  private dnCycleLabel:   HTMLSpanElement | null = null;
  private dnNightMinSlider: HTMLInputElement | null = null;
  private dnNightMinLabel:  HTMLSpanElement | null = null;
  private dnPauseCheckbox: HTMLInputElement | null = null;
  private dnPhaseReadout:  HTMLSpanElement | null = null;
  private dnDraggingTime = false;

  constructor(
    params: GenerationParams,
    onApply: (params: GenerationParams, randomizeSeed: boolean) => void,
    onViewChange: (mode: "3d" | "map") => void = () => {},
  ) {
    this.params = cloneParams(params);
    this.onApply = onApply;
    this.onViewChange = onViewChange;
    this.presets = [...BUILT_IN_PRESETS, ...loadUserPresets()];
    this.container = this.build();
    document.body.appendChild(this.container);
    this.restorePosition();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
  }

  isVisible(): boolean { return this.visible; }

  setParams(p: GenerationParams): void {
    this.params = cloneParams(p);
    this.syncSlidersFromParams();
  }

  attachDayNight(state: DayNightState): void {
    this.dayNightState = state;
    if (this.dnTimeSlider)     this.dnTimeSlider.value     = state.t.toFixed(3);
    if (this.dnTimeLabel)      this.dnTimeLabel.textContent = state.t.toFixed(3);
    if (this.dnCycleSlider)    this.dnCycleSlider.value    = String(state.cycleLengthSeconds);
    if (this.dnCycleLabel)     this.dnCycleLabel.textContent = String(state.cycleLengthSeconds);
    if (this.dnNightMinSlider) this.dnNightMinSlider.value = String(state.nightMin);
    if (this.dnNightMinLabel)  this.dnNightMinLabel.textContent = String(state.nightMin);
    if (this.dnPauseCheckbox)  this.dnPauseCheckbox.checked = state.paused;
  }

  updateDayNightReadout(frame: DayNightFrame): void {
    if (!this.dayNightState) return;
    if (this.dnTimeLabel)    this.dnTimeLabel.textContent = this.dayNightState.t.toFixed(3);
    if (this.dnPhaseReadout) this.dnPhaseReadout.textContent = `${frame.phase} · ${frame.clockLabel}`;
    if (!this.dnDraggingTime && this.dnTimeSlider) {
      this.dnTimeSlider.value = this.dayNightState.t.toFixed(3);
    }
  }

  private build(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.id = "debug-panel";
    panel.style.cssText = `
      display:none; position:fixed; top:90px; right:12px; width:300px;
      background:#1a1a3e; border:1px solid #444; border-radius:6px;
      font-family:system-ui,sans-serif; font-size:0.75rem; color:#ccc;
      box-shadow:0 4px 20px rgba(0,0,0,0.5); z-index:100;
      max-height:calc(100vh - 100px); overflow-y:auto;
      user-select:none;
    `;

    const titleBar = document.createElement("div");
    titleBar.style.cssText = `
      display:flex; justify-content:space-between; align-items:center;
      padding:8px 12px; background:#16213e; border-radius:6px 6px 0 0;
      border-bottom:1px solid #333; cursor:move;
    `;
    const title = document.createElement("span");
    title.textContent = "World Parameters";
    title.style.cssText = "font-weight:bold;color:#e94560;font-size:0.85rem;";

    const titleButtons = document.createElement("div");
    titleButtons.style.cssText = "display:flex;gap:6px;align-items:center;";

    const resetAllBtn = document.createElement("span");
    resetAllBtn.textContent = "Reset All";
    resetAllBtn.style.cssText = "font-size:0.65rem;color:#888;background:#222;padding:2px 6px;border-radius:3px;cursor:pointer;";
    resetAllBtn.addEventListener("click", () => this.resetAll());

    const minimizeBtn = document.createElement("span");
    minimizeBtn.textContent = "\u2212";
    minimizeBtn.style.cssText = "cursor:pointer;color:#888;font-size:1.2rem;line-height:1;";
    minimizeBtn.addEventListener("click", () => this.toggleMinimize());

    titleButtons.appendChild(resetAllBtn);
    titleButtons.appendChild(minimizeBtn);
    titleBar.appendChild(title);
    titleBar.appendChild(titleButtons);
    panel.appendChild(titleBar);

    this.setupDrag(panel, titleBar);

    const body = document.createElement("div");
    body.id = "debug-panel-body";

    body.appendChild(this.buildPresetRow());

    const viewRow = document.createElement("div");
    viewRow.style.cssText = "padding:0.4rem 0.6rem; border-bottom:1px solid #333; display:flex; gap:0.8rem; align-items:center; font-size:0.8rem;";
    viewRow.innerHTML = `
      <span>View:</span>
      <label style="cursor:pointer"><input type="radio" name="map-view-mode" value="3d" checked /> 3D</label>
      <label style="cursor:pointer"><input type="radio" name="map-view-mode" value="map" /> Map</label>
    `;
    body.appendChild(viewRow);
    viewRow.querySelectorAll<HTMLInputElement>("input[name=map-view-mode]").forEach((r) => {
      r.addEventListener("change", () => {
        if (r.checked) this.onViewChange(r.value as "3d" | "map");
      });
    });

    for (const section of SECTIONS) {
      body.appendChild(this.buildSection(section));
    }

    renderBiomeBoxInspector(body);

    const splineToolbar = buildSplineShapeToolbar({
      getShape: () => this.params.shape.shape,
      setShape: (s) => { this.params.shape.shape = s; },
      onChange: () => { for (const r of this.splineRerenders) r(); },
    });
    body.appendChild(splineToolbar.element);

    body.appendChild(this.buildSplineSection(
      "Splines · Continentalness → Offset",
      () => this.params.shape.shape.continent,
      (s) => { this.params.shape.shape.continent = s; },
    ));
    body.appendChild(this.buildAnchoredSection(
      "Splines · Erosion → Offset Bonus (by Continentalness)",
      () => this.params.shape.shape.erosionByContinent,
      (l) => { this.params.shape.shape.erosionByContinent = l; },
    ));
    body.appendChild(this.buildAnchoredSection(
      "Splines · Peaks & Valleys → Offset Wobble (by Erosion)",
      () => this.params.shape.shape.pvByErosion,
      (l) => { this.params.shape.shape.pvByErosion = l; },
    ));

    const applyRow = document.createElement("div");
    applyRow.style.cssText = "padding:10px 12px;";

    const randomizeRow = document.createElement("label");
    randomizeRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer;color:#aaa;font-size:0.7rem;";
    this.randomizeSeedCheckbox = document.createElement("input");
    this.randomizeSeedCheckbox.type = "checkbox";
    this.randomizeSeedCheckbox.checked = false;
    randomizeRow.appendChild(this.randomizeSeedCheckbox);
    randomizeRow.appendChild(document.createTextNode("Randomize seed on apply"));
    applyRow.appendChild(randomizeRow);

    const applyBtn = document.createElement("div");
    applyBtn.textContent = "Apply & Regenerate";
    applyBtn.style.cssText = `
      background:#e94560; color:white; text-align:center; padding:8px;
      border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.8rem;
    `;
    applyBtn.addEventListener("click", () => {
      this.readSlidersIntoParams();
      this.onApply(cloneParams(this.params), this.randomizeSeedCheckbox.checked);
    });
    applyBtn.addEventListener("mouseenter", () => { applyBtn.style.background = "#c73e54"; });
    applyBtn.addEventListener("mouseleave", () => { applyBtn.style.background = "#e94560"; });
    applyRow.appendChild(applyBtn);
    body.appendChild(this.buildDayNightSection());
    body.appendChild(applyRow);

    panel.appendChild(body);
    return panel;
  }

  private buildPresetRow(): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 12px;border-bottom:1px solid #2a2a4a;display:flex;gap:6px;align-items:center;";

    this.presetSelect = document.createElement("select");
    this.presetSelect.style.cssText = "flex:1;background:#0f3460;color:#ccc;border:1px solid #555;border-radius:3px;padding:3px 4px;font-size:0.7rem;";
    this.refreshPresetOptions();
    this.presetSelect.addEventListener("change", () => this.loadPreset());

    const saveBtn = document.createElement("span");
    saveBtn.textContent = "Save";
    saveBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
    saveBtn.addEventListener("click", () => this.savePreset());

    const delBtn = document.createElement("span");
    delBtn.textContent = "Del";
    delBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
    delBtn.addEventListener("click", () => this.deletePreset());

    const exportBtn = document.createElement("span");
    exportBtn.textContent = "↓";
    exportBtn.title = "Export preset";
    exportBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
    exportBtn.addEventListener("click", () => this.exportPreset());

    const importBtn = document.createElement("span");
    importBtn.textContent = "↑";
    importBtn.title = "Import preset";
    importBtn.style.cssText = "background:#0f3460;padding:3px 6px;border-radius:3px;border:1px solid #555;cursor:pointer;font-size:0.65rem;";
    importBtn.addEventListener("click", () => this.importPreset());

    row.appendChild(this.presetSelect);
    row.appendChild(saveBtn);
    row.appendChild(delBtn);
    row.appendChild(exportBtn);
    row.appendChild(importBtn);
    return row;
  }

  private buildSection(section: SectionDef): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border-bottom:1px solid #2a2a4a;";

    const header = document.createElement("div");
    header.style.cssText = `
      display:flex; justify-content:space-between; align-items:center;
      padding:6px 12px; cursor:pointer; background:#16213e;
    `;
    const arrow = section.expanded ? "\u25BC" : "\u25B6";
    const label = document.createElement("span");
    label.style.cssText = `color:${section.expanded ? "#e94560" : "#888"};font-weight:bold;`;
    label.textContent = `${arrow} ${section.label}`;

    const resetBtn = document.createElement("span");
    resetBtn.textContent = "\u21BA reset";
    resetBtn.style.cssText = "font-size:0.6rem;color:#666;cursor:pointer;";
    resetBtn.addEventListener("click", (e) => { e.stopPropagation(); this.resetSection(section); });

    header.appendChild(label);
    header.appendChild(resetBtn);
    this.sectionHeaders.set(section.id, header);

    const body = document.createElement("div");
    body.style.cssText = `padding:6px 12px 10px;display:${section.expanded ? "block" : "none"};`;

    if (section.toggle) {
      const toggleRow = document.createElement("div");
      toggleRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = (this.params[section.paramsKey] as unknown as Record<string, unknown>)[section.toggle.key] as boolean;
      this.toggleInputs.set(`${section.paramsKey}.${section.toggle.key}`, checkbox);
      const toggleLabel = document.createElement("label");
      toggleLabel.style.cssText = "cursor:pointer;color:#aaa;";
      toggleLabel.textContent = section.toggle.label;
      toggleLabel.prepend(checkbox);
      toggleRow.appendChild(toggleLabel);
      body.appendChild(toggleRow);
    }

    for (const slider of section.sliders) {
      body.appendChild(this.buildSliderRow(section.paramsKey, slider, section.subKey));
    }

    this.sectionBodies.set(section.id, body);

    header.addEventListener("click", () => {
      const isOpen = body.style.display !== "none";
      body.style.display = isOpen ? "none" : "block";
      label.textContent = `${isOpen ? "\u25B6" : "\u25BC"} ${section.label}`;
      label.style.color = isOpen ? "#888" : "#e94560";
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  private buildSliderRow(paramsKey: string, def: SliderDef, subKey?: string): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;";

    const label = document.createElement("span");
    label.style.color = "#aaa";
    if (def.description) {
      label.textContent = def.label + " ⓘ";
      label.style.cursor = "help";
      label.style.borderBottom = "1px dotted #555";
    } else {
      label.textContent = def.label;
    }
    if (def.description) row.title = def.description;

    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:4px;";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    const topGroup = this.params[paramsKey as keyof GenerationParams] as unknown as Record<string, unknown>;
    const group = subKey ? (topGroup[subKey] as Record<string, number>) : (topGroup as Record<string, number>);
    const currentVal = group[def.key];
    input.value = String(currentVal);
    input.style.cssText = "width:90px;";

    const valueSpan = document.createElement("span");
    valueSpan.style.cssText = "color:#e94560;width:36px;text-align:right;font-size:0.7rem;font-family:monospace;";
    valueSpan.textContent = currentVal.toFixed(def.decimals);

    input.addEventListener("input", () => {
      valueSpan.textContent = Number(input.value).toFixed(def.decimals);
    });

    const fullKey = subKey ? `${paramsKey}.${subKey}.${def.key}` : `${paramsKey}.${def.key}`;
    this.sliderInputs.set(fullKey, input);
    this.sliderValues.set(fullKey, valueSpan);

    right.appendChild(input);
    right.appendChild(valueSpan);
    row.appendChild(label);
    row.appendChild(right);
    return row;
  }

  private buildSplineSection(
    title: string,
    getSpline: () => Spline,
    setSpline: (s: Spline) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border-bottom:1px solid #2a2a4a;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 12px;background:#16213e;font-weight:bold;color:#e94560;cursor:pointer;";
    header.textContent = "▼ " + title;
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "padding:6px 12px;";
    wrapper.appendChild(body);

    let collapsed = false;
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      header.textContent = (collapsed ? "▶ " : "▼ ") + title;
    });

    const graph = buildSplineGraph({
      getSpline,
      setSpline,
      xRange: X_RANGE,
      yRange: Y_RANGE_CONTINENT,
      xLabel: "continentalness",
    });
    body.appendChild(graph.element);

    this.splineRerenders.push(graph.rerender);
    return wrapper;
  }

  private buildAnchoredSection(
    title: string,
    getList: () => AnchoredSpline[],
    setList: (l: AnchoredSpline[]) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border-bottom:1px solid #2a2a4a;";

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 12px;background:#16213e;font-weight:bold;color:#e94560;cursor:pointer;";
    header.textContent = "▼ " + title;
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "padding:6px 12px;";
    wrapper.appendChild(body);

    let collapsed = false;
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      header.textContent = (collapsed ? "▶ " : "▼ ") + title;
    });

    const isErosion = title.toLowerCase().includes("erosion (by");
    const yRange = isErosion ? Y_RANGE_EROSION : Y_RANGE_PV;
    const xLabel = isErosion ? "erosion" : "peaks & valleys";
    const anchorLabel = isErosion ? "cont" : "ero";

    const graph = buildAnchoredSplineGraph({
      getList,
      setList,
      xRange: X_RANGE,
      yRange,
      xLabel,
      anchorLabel,
    });
    body.appendChild(graph.element);

    this.splineRerenders.push(graph.rerender);
    return wrapper;
  }

  private buildDayNightSection(): HTMLDivElement {
    const section = document.createElement("div");
    section.style.cssText = "border-bottom:1px solid #2a2a4a;";

    const header = document.createElement("div");
    header.style.cssText = `
      padding:8px 12px; background:#16213e; cursor:pointer; display:flex;
      justify-content:space-between; align-items:center; font-weight:bold;
    `;
    const headerLabel = document.createElement("span");
    headerLabel.textContent = "Day / Night";
    this.dnPhaseReadout = document.createElement("span");
    this.dnPhaseReadout.style.cssText = "color:#aaa;font-weight:normal;font-size:0.7rem;";
    this.dnPhaseReadout.textContent = "–";
    header.appendChild(headerLabel);
    header.appendChild(this.dnPhaseReadout);

    const body = document.createElement("div");
    body.style.cssText = "padding:8px 12px;display:none;";

    header.addEventListener("click", () => {
      body.style.display = body.style.display === "none" ? "block" : "none";
    });

    // Row helper — mirrors the slider style used by the existing sections.
    const addSlider = (
      label: string, min: number, max: number, step: number, initial: number,
      onInput: (v: number) => void,
    ): { input: HTMLInputElement; valueLabel: HTMLSpanElement } => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;margin:4px 0;";
      const lbl = document.createElement("span");
      lbl.style.cssText = "flex:0 0 85px;color:#aaa;";
      lbl.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(initial);
      input.style.cssText = "flex:1;";
      const valueLabel = document.createElement("span");
      valueLabel.style.cssText = "flex:0 0 45px;text-align:right;color:#e94560;";
      valueLabel.textContent = String(initial);
      input.addEventListener("input", () => {
        const v = Number(input.value);
        valueLabel.textContent = input.value;
        onInput(v);
      });
      row.appendChild(lbl); row.appendChild(input); row.appendChild(valueLabel);
      body.appendChild(row);
      return { input, valueLabel };
    };

    const cycle = addSlider("Cycle (s)", 30, 600, 5, 120, (v) => {
      if (this.dayNightState) this.dayNightState.cycleLengthSeconds = v;
    });
    this.dnCycleSlider = cycle.input;
    this.dnCycleLabel  = cycle.valueLabel;

    const timeRow = addSlider("Time", 0, 0.999, 0.001, 0.25, (v) => {
      if (this.dayNightState) this.dayNightState.t = v;
    });
    this.dnTimeSlider = timeRow.input;
    this.dnTimeLabel  = timeRow.valueLabel;
    this.dnTimeSlider.addEventListener("pointerdown", () => { this.dnDraggingTime = true; });
    this.dnTimeSlider.addEventListener("pointerup",   () => { this.dnDraggingTime = false; });
    this.dnTimeSlider.addEventListener("pointercancel", () => { this.dnDraggingTime = false; });

    const floor = addSlider("Night floor", 0, 15, 1, 4, (v) => {
      if (this.dayNightState) this.dayNightState.nightMin = v;
    });
    this.dnNightMinSlider = floor.input;
    this.dnNightMinLabel  = floor.valueLabel;

    const pauseRow = document.createElement("label");
    pauseRow.style.cssText = "display:flex;align-items:center;gap:6px;margin:6px 0;color:#aaa;cursor:pointer;";
    this.dnPauseCheckbox = document.createElement("input");
    this.dnPauseCheckbox.type = "checkbox";
    this.dnPauseCheckbox.addEventListener("change", () => {
      if (this.dayNightState && this.dnPauseCheckbox) {
        this.dayNightState.paused = this.dnPauseCheckbox.checked;
      }
    });
    pauseRow.appendChild(this.dnPauseCheckbox);
    pauseRow.appendChild(document.createTextNode("Paused"));
    body.appendChild(pauseRow);

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  private setupDrag(panel: HTMLDivElement, handle: HTMLDivElement): void {
    let dragging = false;
    let offsetX = 0, offsetY = 0;

    handle.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).style.cursor === "pointer") return;
      dragging = true;
      offsetX = e.clientX - panel.offsetLeft;
      offsetY = e.clientY - panel.offsetTop;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - offsetX) + "px";
      panel.style.top = (e.clientY - offsetY) + "px";
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        this.savePosition();
      }
    });
  }

  private savePosition(): void {
    localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify({
      left: this.container.style.left,
      top: this.container.style.top,
    }));
  }

  private restorePosition(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_POSITION);
      if (!raw) return;
      const { left, top } = JSON.parse(raw);
      this.container.style.left = left;
      this.container.style.top = top;
      this.container.style.right = "auto";
    } catch { /* ignore */ }
  }

  private toggleMinimize(): void {
    this.minimized = !this.minimized;
    const body = this.container.querySelector("#debug-panel-body") as HTMLDivElement;
    body.style.display = this.minimized ? "none" : "block";
  }

  private readSlidersIntoParams(): void {
    for (const section of SECTIONS) {
      const topGroup = this.params[section.paramsKey] as unknown as Record<string, unknown>;
      const group = section.subKey
        ? (topGroup[section.subKey] as Record<string, unknown>)
        : topGroup;
      if (section.toggle) {
        const checkbox = this.toggleInputs.get(`${section.paramsKey}.${section.toggle.key}`)!;
        topGroup[section.toggle.key] = checkbox.checked;
      }
      for (const slider of section.sliders) {
        const fullKey = section.subKey
          ? `${section.paramsKey}.${section.subKey}.${slider.key}`
          : `${section.paramsKey}.${slider.key}`;
        const input = this.sliderInputs.get(fullKey)!;
        group[slider.key] = Number(input.value);
      }
    }
  }

  private syncSlidersFromParams(): void {
    for (const section of SECTIONS) {
      const topGroup = this.params[section.paramsKey] as unknown as Record<string, unknown>;
      const group = section.subKey
        ? (topGroup[section.subKey] as Record<string, unknown>)
        : topGroup;
      if (section.toggle) {
        const checkbox = this.toggleInputs.get(`${section.paramsKey}.${section.toggle.key}`)!;
        checkbox.checked = topGroup[section.toggle.key] as boolean;
      }
      for (const slider of section.sliders) {
        const fullKey = section.subKey
          ? `${section.paramsKey}.${section.subKey}.${slider.key}`
          : `${section.paramsKey}.${slider.key}`;
        const input = this.sliderInputs.get(fullKey)!;
        const valueSpan = this.sliderValues.get(fullKey)!;
        const val = group[slider.key] as number;
        input.value = String(val);
        valueSpan.textContent = val.toFixed(slider.decimals);
      }
    }
    for (const r of this.splineRerenders) r();
  }

  private resetSection(section: SectionDef): void {
    const defaults = DEFAULT_PARAMS[section.paramsKey];
    (this.params as unknown as Record<string, unknown>)[section.paramsKey] = JSON.parse(JSON.stringify(defaults));
    this.syncSlidersFromParams();
  }

  private resetAll(): void {
    this.params = cloneParams(DEFAULT_PARAMS);
    this.syncSlidersFromParams();
  }

  private refreshPresetOptions(): void {
    this.presetSelect.innerHTML = "";
    for (const preset of this.presets) {
      const opt = document.createElement("option");
      opt.textContent = preset.builtIn ? preset.name : `\u2605 ${preset.name}`;
      opt.value = preset.name;
      this.presetSelect.appendChild(opt);
    }
  }

  private loadPreset(): void {
    const name = this.presetSelect.value;
    const preset = this.presets.find(p => p.name === name);
    if (!preset) return;
    this.params = cloneParams(preset.params);
    this.syncSlidersFromParams();
  }

  private savePreset(): void {
    const name = prompt("Preset name:");
    if (!name || !name.trim()) return;
    this.readSlidersIntoParams();
    this.presets = this.presets.filter(p => p.builtIn || p.name !== name.trim());
    this.presets.push({ name: name.trim(), params: cloneParams(this.params), builtIn: false });
    saveUserPresets(this.presets);
    this.refreshPresetOptions();
    this.presetSelect.value = name.trim();
  }

  private deletePreset(): void {
    const name = this.presetSelect.value;
    const preset = this.presets.find(p => p.name === name);
    if (!preset || preset.builtIn) return;
    this.presets = this.presets.filter(p => p.name !== name);
    saveUserPresets(this.presets);
    this.refreshPresetOptions();
  }

  private exportPreset(): void {
    const name = this.presetSelect.value;
    const preset = this.presets.find(p => p.name === name);
    if (!preset) return;
    const data = JSON.stringify(
      { worldImaginerPreset: true, name: preset.name, params: preset.params },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.name.replace(/[\\/:*?"<>|]/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private importPreset(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => alert("Failed to read preset file.");
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.worldImaginerPreset !== true) {
            alert("Not a valid preset file.");
            return;
          }
          const baseName: string = (String(data.name ?? "Imported Preset").trim().slice(0, 64)) || "Imported Preset";
          let candidate = baseName;
          let n = 2;
          while (this.presets.some(p => p.name === candidate)) {
            candidate = `${baseName} (${n++})`;
          }
          const raw = data.params ?? {};
          const params: GenerationParams = {
            climate:     { ...DEFAULT_PARAMS.climate,     ...(raw.climate     ?? {}) },
            shape:       { ...DEFAULT_PARAMS.shape,       ...(raw.shape       ?? {}) },
            biomePicker: { ...DEFAULT_PARAMS.biomePicker, ...(raw.biomePicker ?? {}) },
            extent:      { ...DEFAULT_PARAMS.extent,      ...(raw.extent      ?? {}) },
            aquifers:    { ...DEFAULT_PARAMS.aquifers,    ...(raw.aquifers    ?? {}) },
            biomes:      { ...DEFAULT_PARAMS.biomes,      ...(raw.biomes      ?? {}) },
            ores:        { ...DEFAULT_PARAMS.ores,        ...(raw.ores        ?? {}) },
            vegetation:  { ...DEFAULT_PARAMS.vegetation,  ...(raw.vegetation  ?? {}) },
            density:     { ...DEFAULT_PARAMS.density,     ...(raw.density     ?? {}) },
          };
          this.presets.push({ name: candidate, params, builtIn: false });
          saveUserPresets(this.presets);
          this.refreshPresetOptions();
          this.presetSelect.value = candidate;
        } catch {
          alert("Failed to read preset file.");
        }
      };
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }
}
