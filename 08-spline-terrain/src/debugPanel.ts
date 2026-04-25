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
  Y_RANGE_CONTINENT,
  Y_RANGE_EROSION,
  Y_RANGE_PV,
  X_RANGE,
} from "./splineEditor";
import type { DayNightState, DayNightFrame } from "./dayNight";

// ── Slider definition metadata ─────────────────────────────────────
interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
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
    id: "erosion", label: "Erosion", paramsKey: "erosion", expanded: true,
    toggle: { key: "enabled", label: "Enabled" },
    sliders: [
      { key: "droplets",        label: "Droplets",         min: 0,    max: 500, step: 5,    decimals: 0 },
      { key: "erosionRate",     label: "Erosion Rate",     min: 0,    max: 1,    step: 0.01,  decimals: 2 },
      { key: "depositionRate",  label: "Deposition Rate",  min: 0,    max: 1,    step: 0.01,  decimals: 2 },
      { key: "inertia",         label: "Inertia",          min: 0,    max: 1,    step: 0.01,  decimals: 2 },
      { key: "maxLifetime",     label: "Max Lifetime",     min: 10,   max: 200,  step: 1,     decimals: 0 },
      { key: "evaporationRate", label: "Evaporation Rate", min: 0,    max: 0.1,  step: 0.005, decimals: 3 },
      { key: "gravity",         label: "Gravity",          min: 1,    max: 30,   step: 1,     decimals: 0 },
    ],
  },
  {
    id: "extent", label: "World Extent", paramsKey: "extent", expanded: false,
    sliders: [
      { key: "minHeight", label: "Min Height", min: -128, max:   0, step: 1, decimals: 0 },
      { key: "maxHeight", label: "Max Height", min:    0, max: 256, step: 1, decimals: 0 },
    ],
  },
  {
    id: "caves", label: "Caves", paramsKey: "caves", expanded: false,
    sliders: [
      { key: "scale",           label: "Scale",            min: 5,    max: 60,   step: 1,    decimals: 0 },
      { key: "octaves",         label: "Octaves",          min: 1,    max: 6,    step: 1,    decimals: 0 },
      { key: "verticalStretch", label: "Vertical Stretch", min: 0.5,  max: 4,    step: 0.1,  decimals: 1 },
      { key: "thresholdBase",   label: "Threshold Base",   min: 0,    max: 0.2,  step: 0.005, decimals: 3 },
      { key: "thresholdMax",    label: "Threshold Max",    min: 0.05, max: 0.35, step: 0.005, decimals: 3 },
      { key: "depthGain",       label: "Depth Gain",       min: 0,    max: 0.02, step: 0.0005, decimals: 4 },
      { key: "minDepth",        label: "Min Depth",        min: 0,    max: 8,    step: 1,    decimals: 0 },
      { key: "entryDepth",      label: "Entry Depth",      min: 0,    max: 12,   step: 1,    decimals: 0 },
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
    id: "rivers", label: "Rivers", paramsKey: "rivers", expanded: false,
    sliders: [
      { key: "voronoiScale",  label: "Voronoi Scale",   min: 50,   max: 500, step: 10,   decimals: 0 },
      { key: "edgeThreshold", label: "Edge Threshold",   min: 0.01, max: 0.2, step: 0.01, decimals: 2 },
      { key: "maxCarveDepth", label: "Max Carve Depth",  min: 1,    max: 15,  step: 1,    decimals: 0 },
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
    id: "biome-climate", label: "Biome Thresholds", paramsKey: "shape", subKey: "biomeClimate", expanded: false,
    sliders: [
      { key: "oceanContinentalness",  label: "Ocean Cont.",   min: -1,   max: 0,   step: 0.01, decimals: 2 },
      { key: "coastContinentalness",  label: "Coast Cont.",   min: -0.5, max: 0.3, step: 0.01, decimals: 2 },
      { key: "beachBand",             label: "Beach Band",    min: 0,    max: 10,  step: 1,    decimals: 0 },
      { key: "inlandContinentalness", label: "Inland Cont.",  min: 0,    max: 0.8, step: 0.01, decimals: 2 },
      { key: "mountainErosion",       label: "Mountain Ero.", min: -1,   max: 0,   step: 0.01, decimals: 2 },
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
  {
    name: "Cave Heavy", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      caves: {
        scale: 22,
        octaves: 4,
        verticalStretch: 2.5,
        thresholdBase: 0.09,
        thresholdMax: 0.22,
        depthGain: 0.006,
        minDepth: 0,
        entryDepth: 4,
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

// ── Panel class ────────────────────────────────────────────────────
export class DebugPanel {
  private container: HTMLDivElement;
  private params: GenerationParams;
  private onApply: (params: GenerationParams, randomizeSeed: boolean) => void;
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

  constructor(params: GenerationParams, onApply: (params: GenerationParams, randomizeSeed: boolean) => void) {
    this.params = cloneParams(params);
    this.onApply = onApply;
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

    for (const section of SECTIONS) {
      body.appendChild(this.buildSection(section));
    }

    body.appendChild(this.buildSplineSection(
      "Splines · Continentalness → Height",
      () => this.params.shape.shape.continent,
      (s) => { this.params.shape.shape.continent = s; },
    ));
    body.appendChild(this.buildAnchoredSection(
      "Splines · Erosion (by Continentalness)",
      () => this.params.shape.shape.erosionByContinent,
      (l) => { this.params.shape.shape.erosionByContinent = l; },
    ));
    body.appendChild(this.buildAnchoredSection(
      "Splines · Peaks & Valleys (by Erosion)",
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
    label.textContent = def.label;

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
            climate:  { ...DEFAULT_PARAMS.climate,  ...(raw.climate  ?? {}) },
            shape:    { ...DEFAULT_PARAMS.shape,    ...(raw.shape    ?? {}) },
            extent:   { ...DEFAULT_PARAMS.extent,   ...(raw.extent   ?? {}) },
            erosion:  { ...DEFAULT_PARAMS.erosion,  ...(raw.erosion  ?? {}) },
            caves:    { ...DEFAULT_PARAMS.caves,    ...(raw.caves    ?? {}) },
            aquifers: { ...DEFAULT_PARAMS.aquifers, ...(raw.aquifers ?? {}) },
            rivers:   { ...DEFAULT_PARAMS.rivers,   ...(raw.rivers   ?? {}) },
            biomes:   { ...DEFAULT_PARAMS.biomes,   ...(raw.biomes   ?? {}) },
            ores:     { ...DEFAULT_PARAMS.ores,     ...(raw.ores     ?? {}) },
            vegetation: { ...DEFAULT_PARAMS.vegetation, ...(raw.vegetation ?? {}) },
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
