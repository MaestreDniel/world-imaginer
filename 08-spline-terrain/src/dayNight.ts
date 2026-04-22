// 08-spline-terrain/src/dayNight.ts
import * as THREE from "three";

export const DAWN_END  = 0.15;
export const DAY_END   = 0.50;
export const DUSK_END  = 0.65;

export type Phase = "dawn" | "day" | "dusk" | "night";

export interface DayNightState {
  t: number;                  // position in cycle, [0, 1)
  paused: boolean;
  cycleLengthSeconds: number;
  nightMin: number;           // 0..15 integer, sky-light floor
}

export interface DayNightFrame {
  skyLightFactor: number;     // [nightMin/15, 1]
  sunDir: THREE.Vector3;      // unit vector
  sunIntensity: number;
  ambientIntensity: number;
  ambientColor: THREE.Color;
  clearColor: THREE.Color;
  phase: Phase;
  clockLabel: string;         // cosmetic HH:MM
}

export const sharedDayNightUniforms = {
  uTimeOfDay: { value: 1.0 },
};

export function createDayNightState(): DayNightState {
  return {
    t: 0.25,            // mid-day
    paused: false,
    cycleLengthSeconds: 120,
    nightMin: 4,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  out.r = lerp(a.r, b.r, t);
  out.g = lerp(a.g, b.g, t);
  out.b = lerp(a.b, b.b, t);
  return out;
}

// Palette — indexed by phase center, interpolated at transitions.
const COLOR_DAWN_AMBIENT  = new THREE.Color(0xffc18a);
const COLOR_DAY_AMBIENT   = new THREE.Color(0xffffff);
const COLOR_DUSK_AMBIENT  = new THREE.Color(0xff9a66);
const COLOR_NIGHT_AMBIENT = new THREE.Color(0x3a4a70);

const COLOR_DAWN_SKY  = new THREE.Color(0xf0a070);
const COLOR_DAY_SKY   = new THREE.Color(0x7ec8e3);
const COLOR_DUSK_SKY  = new THREE.Color(0xc8603a);
const COLOR_NIGHT_SKY = new THREE.Color(0x0a1028);

function classifyPhase(t: number): Phase {
  if (t < DAWN_END) return "dawn";
  if (t < DAY_END)  return "day";
  if (t < DUSK_END) return "dusk";
  return "night";
}

function computeSkyLightFactor(t: number, nightMin: number): number {
  const floor = nightMin / 15;
  if (t < DAWN_END)  return lerp(floor, 1, smoothstep(0, DAWN_END, t));
  if (t < DAY_END)   return 1;
  if (t < DUSK_END)  return lerp(1, floor, smoothstep(DAY_END, DUSK_END, t));
  return floor;
}

// Scratch objects reused every frame to avoid allocation in the render loop.
const scratchSunDir = new THREE.Vector3();
const scratchAmbient = new THREE.Color();
const scratchClear   = new THREE.Color();

export function deriveFrame(state: DayNightState): DayNightFrame {
  const phase = classifyPhase(state.t);
  const skyLightFactor = computeSkyLightFactor(state.t, state.nightMin);

  // Sun arc: angle = 2π t, with slight Z tilt so shadows are off-axis.
  const angle = state.t * Math.PI * 2;
  scratchSunDir.set(Math.cos(angle), Math.sin(angle), 0.3).normalize();

  // Color palette interpolation.
  // Segments: [0, 0.125) night→dawn, [0.125, 0.25) dawn→day,
  //           [0.25, 0.5) day, [0.5, 0.575) day→dusk,
  //           [0.575, 0.7) dusk→night, [0.7, 1) night.
  if (state.t < 0.125) {
    const u = state.t / 0.125;
    lerpColor(scratchAmbient, COLOR_NIGHT_AMBIENT, COLOR_DAWN_AMBIENT, u);
    lerpColor(scratchClear,   COLOR_NIGHT_SKY,     COLOR_DAWN_SKY,     u);
  } else if (state.t < 0.25) {
    const u = (state.t - 0.125) / 0.125;
    lerpColor(scratchAmbient, COLOR_DAWN_AMBIENT, COLOR_DAY_AMBIENT, u);
    lerpColor(scratchClear,   COLOR_DAWN_SKY,     COLOR_DAY_SKY,     u);
  } else if (state.t < 0.5) {
    scratchAmbient.copy(COLOR_DAY_AMBIENT);
    scratchClear.copy(COLOR_DAY_SKY);
  } else if (state.t < 0.575) {
    const u = (state.t - 0.5) / 0.075;
    lerpColor(scratchAmbient, COLOR_DAY_AMBIENT, COLOR_DUSK_AMBIENT, u);
    lerpColor(scratchClear,   COLOR_DAY_SKY,     COLOR_DUSK_SKY,     u);
  } else if (state.t < 0.7) {
    const u = (state.t - 0.575) / 0.125;
    lerpColor(scratchAmbient, COLOR_DUSK_AMBIENT, COLOR_NIGHT_AMBIENT, u);
    lerpColor(scratchClear,   COLOR_DUSK_SKY,     COLOR_NIGHT_SKY,     u);
  } else {
    scratchAmbient.copy(COLOR_NIGHT_AMBIENT);
    scratchClear.copy(COLOR_NIGHT_SKY);
  }

  const hours = Math.floor(state.t * 24);
  const minutes = Math.floor((state.t * 24 - hours) * 60);
  const clockLabel = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

  return {
    skyLightFactor,
    sunDir: scratchSunDir,
    sunIntensity: 0.2 + skyLightFactor * 0.8,
    ambientIntensity: 0.2 + skyLightFactor * 0.5,
    ambientColor: scratchAmbient,
    clearColor: scratchClear,
    phase,
    clockLabel,
  };
}

export function tickDayNight(state: DayNightState, dtSeconds: number): DayNightFrame {
  if (!state.paused) {
    state.t = (state.t + dtSeconds / state.cycleLengthSeconds) % 1;
    if (state.t < 0) state.t += 1;
  }
  return deriveFrame(state);
}
