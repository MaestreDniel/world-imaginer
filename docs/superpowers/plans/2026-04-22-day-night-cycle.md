# Day / Night Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a running day-night cycle in `08-spline-terrain` that modulates per-voxel sky light (Minecraft-style two-channel lighting) and animates scene atmospherics (sun arc, ambient color, clear color).

**Architecture:** A new `dayNight.ts` module owns the clock and derives per-frame lighting parameters + a shared `uTimeOfDay` uniform. The per-voxel BFS in `lighting.ts` is split into two channels (sky + block); both are baked as vertex attributes. A `MeshLambertMaterial.onBeforeCompile` hook combines them in the shader with the time-of-day uniform, so a full day costs zero CPU after chunk geometry is built.

**Tech Stack:** TypeScript, Three.js (MeshLambertMaterial + GLSL injection), Web Workers (existing), Vite.

**Verification:** This project has no unit tests by convention. Every task ends with a manual verification step in the Vite dev server. Run `cd 08-spline-terrain && npm run dev` once at the start of the implementation session and keep it running; verifications check the browser.

**Spec:** `docs/superpowers/specs/2026-04-22-day-night-cycle-design.md`

---

## File-level change map

- **New:** `08-spline-terrain/src/dayNight.ts` — clock state, phase curve, derived frame helper, `sharedDayNightUniforms`.
- **Modified:** `08-spline-terrain/src/lighting.ts` — return `ChunkLightData` (sky + block), two BFS passes.
- **Modified:** `08-spline-terrain/src/mesher.ts` — accept `ChunkLightData`, remove baked light factor from vertex color, emit `aSkyLight` / `aBlockLight` attributes.
- **Modified:** `08-spline-terrain/src/worker.ts` — return `sky` and `block` buffers instead of combined `light`.
- **Modified:** `08-spline-terrain/src/world.ts` — carry both light buffers, wire custom attributes into the chunk geometry, hook `onBeforeCompile` on the shared material.
- **Modified:** `08-spline-terrain/src/main.ts` — construct `DayNight`, tick each frame, drive scene lights and clear color.
- **Modified:** `08-spline-terrain/src/debugPanel.ts` — expose a `buildDayNightSection` that binds controls to a `DayNightState` reference.
- **Modified:** `08-spline-terrain/index.html` — no change expected; only if debug panel HTML anchors are needed (verify during Task 6).

---

## Task 1: Create `dayNight.ts` with clock, phase curve, and shared uniform

**Files:**
- Create: `08-spline-terrain/src/dayNight.ts`

The module is pure logic first — it compiles and exports the types/functions, but nothing imports it yet. This is a safe commit point.

- [ ] **Step 1: Create the file with state, constants, and the phase curve**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd 08-spline-terrain && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/dayNight.ts
git commit -m "feat(08): add dayNight module with clock, phase curve, and shared uniform

Unused for now; wired into the pipeline in subsequent commits."
```

---

## Task 2: Split `lighting.ts` into sky / block channels

**Files:**
- Modify: `08-spline-terrain/src/lighting.ts`

Two BFS passes are needed — one seeded from sky-exposed transparent voxels, one seeded from block emitters. At the end of the task the mesher still receives a single combined buffer, so the visible output is unchanged.

- [ ] **Step 1: Rewrite `lighting.ts` with two channels**

Replace the entire file contents with:

```ts
// 08-spline-terrain/src/lighting.ts
import { CHUNK_SIZE, chunkIndex, type ChunkData } from "./chunk";
import { BLOCK_DEFS } from "./blocks";

export interface ChunkLightData {
  sky:   Uint8Array;  // 0..15 per voxel
  block: Uint8Array;  // 0..15 per voxel
}

function isTransparent(blockId: number): boolean {
  const def = BLOCK_DEFS[blockId];
  return def ? def.transparent : false;
}

const NEIGHBORS: Array<[number, number, number]> = [
  [ 1, 0, 0], [-1, 0, 0],
  [ 0, 1, 0], [ 0,-1, 0],
  [ 0, 0, 1], [ 0, 0,-1],
];

function propagate(light: Uint8Array, data: ChunkData, queue: Array<[number, number, number, number]>): void {
  let head = 0;
  while (head < queue.length) {
    const [x, y, z, level] = queue[head++];
    if (level <= 1) continue;
    const next = level - 1;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= CHUNK_SIZE ||
          ny < 0 || ny >= CHUNK_SIZE ||
          nz < 0 || nz >= CHUNK_SIZE) continue;
      const idx = chunkIndex(nx, ny, nz);
      if (!isTransparent(data[idx])) continue;
      if (light[idx] >= next) continue;
      light[idx] = next;
      queue.push([nx, ny, nz, next]);
    }
  }
}

export function computeChunkLocalLight(data: ChunkData): ChunkLightData {
  const sky   = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  const block = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  const skyQueue:   Array<[number, number, number, number]> = [];
  const blockQueue: Array<[number, number, number, number]> = [];

  // ── Sky pass: seed from sky-exposed transparent columns.
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let inSky = true;
      for (let y = CHUNK_SIZE - 1; y >= 0; y--) {
        const idx = chunkIndex(x, y, z);
        const blockId = data[idx];
        if (inSky && isTransparent(blockId)) {
          sky[idx] = 15;
          skyQueue.push([x, y, z, 15]);
          continue;
        }
        inSky = false;
      }
    }
  }

  // ── Block pass: seed from emitters.
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = chunkIndex(x, y, z);
        const emit = BLOCK_DEFS[data[idx]]?.lightEmit ?? 0;
        if (emit === 0) continue;
        if (emit > block[idx]) {
          block[idx] = emit;
          blockQueue.push([x, y, z, emit]);
        }
      }
    }
  }

  propagate(sky,   data, skyQueue);
  propagate(block, data, blockQueue);

  return { sky, block };
}
```

- [ ] **Step 2: Update `worker.ts` to consume the new shape and transfer both buffers**

Replace the block around `lighting.ts` usage. Modify `08-spline-terrain/src/worker.ts`:

Replace the import and `lightData` line. The current line is:
```ts
const lightData = computeChunkLocalLight(data);
```
Replace with:
```ts
const lightData = computeChunkLocalLight(data);
// ChunkLightData = { sky, block }
```

Update the `buildChunkMesh` call to pass the new shape. The current line is:
```ts
const mesh = buildChunkMesh(data, getNeighbor, grassColors, lightData);
```
Leave this line unchanged for now — the mesher signature change happens in Task 3. At this task we need the mesher to still accept a `Uint8Array | null`. So temporarily convert:
```ts
// Task 2 transitional — mesher still takes a single buffer. Task 3 swaps this out.
const combined = new Uint8Array(lightData.sky.length);
for (let i = 0; i < combined.length; i++) {
  combined[i] = Math.max(lightData.sky[i], lightData.block[i]);
}
const mesh = buildChunkMesh(data, getNeighbor, grassColors, combined);
```

Update the response — `sky` and `block` are added alongside the existing fields:

Add to `WorkerResponse`:
```ts
sky:   Uint8Array;
block: Uint8Array;
```

In the `empty` branch, add to the response object:
```ts
sky: lightData.sky,
block: lightData.block,
```
And include their buffers in the `transfer` array:
```ts
transfer: [data.buffer, grassColors.buffer, lightData.sky.buffer, lightData.block.buffer]
```

In the non-empty branch, same additions to the response object and the `transfer` array.

- [ ] **Step 3: Update `world.ts` to store and forward both buffers (but not yet use them)**

In `08-spline-terrain/src/world.ts`, extend `LoadedChunk`:

```ts
interface LoadedChunk {
  mesh: THREE.Mesh | null;
  blockData: Uint8Array | null;
  grassColors: Uint32Array | null;
  skyLight: Uint8Array | null;
  blockLight: Uint8Array | null;
}
```

In `onWorkerResult`, include the new buffers in both `chunks.set(...)` calls:

```ts
this.chunks.set(key, {
  mesh: null,                   // or mesh in the non-empty branch
  blockData: resp.blockData,
  grassColors: resp.grassColors,
  skyLight: resp.sky,
  blockLight: resp.block,
});
```

- [ ] **Step 4: Verify compile and run**

Run: `cd 08-spline-terrain && npx tsc --noEmit`
Expected: no errors.

Reload the Vite page in the browser. Expected: world renders identically to before (combined light into single buffer preserves the existing visual).

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/lighting.ts 08-spline-terrain/src/worker.ts 08-spline-terrain/src/world.ts
git commit -m "refactor(08): split skylight and blocklight BFS into two channels

Both channels are computed, transferred, and stored; the mesher still
consumes a combined buffer so visual output is unchanged."
```

---

## Task 3: Mesher emits per-vertex `aSkyLight` / `aBlockLight`, shader combines via uniform

**Files:**
- Modify: `08-spline-terrain/src/mesher.ts`
- Modify: `08-spline-terrain/src/worker.ts`
- Modify: `08-spline-terrain/src/world.ts`

After this task, the vertex color no longer bakes the light factor — the shader computes `max(aBlockLight, aSkyLight * uTimeOfDay)` per fragment. With `uTimeOfDay = 1.0` (default), the output should match the previous render exactly.

- [ ] **Step 1: Change the mesher signature and drop the baked factor**

In `08-spline-terrain/src/mesher.ts`:

Change `MeshData` to add the two attribute arrays:

```ts
export interface MeshData {
  positions: number[];
  normals:   number[];
  colors:    number[];
  uvs:       number[];
  skyLight:   number[];  // 1 float per vertex, 0..15
  blockLight: number[];  // 1 float per vertex, 0..15
  indices:   number[];
}
```

Change the signature of `buildChunkMesh`. Replace:
```ts
export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: Uint8Array | null,
): MeshData {
```
with:
```ts
import type { ChunkLightData } from "./lighting";
// (add this import at the top if not present)

export function buildChunkMesh(
  data: ChunkData,
  getNeighbor: NeighborLookup,
  grassColors: Uint32Array,
  lightData: ChunkLightData | null,
): MeshData {
```

Declare the new arrays at the top of the function body alongside `positions` etc.:
```ts
const skyLight:   number[] = [];
const blockLight: number[] = [];
```

And in the return:
```ts
return { positions, normals, colors, uvs, skyLight, blockLight, indices };
```

Now update both emission paths to write to the new arrays and stop baking `lightFactor` into colors.

**Sprite/cross path (the loop starting around line 88):** replace the block that computes `lightLevel`, `lightFactor`, `r`, `g`, `b` and pushes colors.

Current code (lines ~107–146):
```ts
// Light from this cell (sprite occupies an air voxel that retained its light value).
let lightLevel = 15;
if (lightData) lightLevel = Math.max(lightData[chunkIndex(x, y, z)], def.lightEmit);
const lightFactor = 0.2 + (lightLevel / 15) * 0.8;
const r = lightFactor, g = lightFactor, b = lightFactor;
```

Replace with:
```ts
let spriteSky = 15;
let spriteBlock = def.lightEmit;
if (lightData) {
  spriteSky   = lightData.sky[chunkIndex(x, y, z)];
  spriteBlock = Math.max(lightData.block[chunkIndex(x, y, z)], def.lightEmit);
}
const r = 1, g = 1, b = 1;
```

Then in the inner `for (let k = 0; k < 4; k++)` that pushes vertex data for sprite quads (currently pushes positions, normals, colors, uvs), add the two attribute writes immediately after the colors push. The updated loop body:
```ts
for (let k = 0; k < 4; k++) {
  positions.push(q.corners[k][0], q.corners[k][1], q.corners[k][2]);
  normals.push(q.nx, 0, q.nz);
  colors.push(r, g, b);
  skyLight.push(spriteSky);
  blockLight.push(spriteBlock);
  uvs.push(uvc[k][0], uvc[k][1]);
}
```

**Cube face path (second major loop):** locate the block that computes `lightLevel` → `lightFactor` → `baseR/G/B`:

Current code (lines ~227–244):
```ts
let lightLevel = 15;
if (lightData) {
  const lp = [pos[0], pos[1], pos[2]];
  lp[axis] += dir;
  if (
    lp[0] >= 0 && lp[0] < CHUNK_SIZE &&
    lp[1] >= 0 && lp[1] < CHUNK_SIZE &&
    lp[2] >= 0 && lp[2] < CHUNK_SIZE
  ) {
    lightLevel = lightData[chunkIndex(lp[0], lp[1], lp[2])];
  }
  lightLevel = Math.max(lightLevel, def.lightEmit);
}
const lightFactor = 0.2 + (lightLevel / 15) * 0.8;

const baseR = r * shade * lightFactor;
const baseG = g * shade * lightFactor;
const baseB = b * shade * lightFactor;
```

Replace with:
```ts
let faceSky = 15;
let faceBlock = def.lightEmit;
if (lightData) {
  const lp = [pos[0], pos[1], pos[2]];
  lp[axis] += dir;
  if (
    lp[0] >= 0 && lp[0] < CHUNK_SIZE &&
    lp[1] >= 0 && lp[1] < CHUNK_SIZE &&
    lp[2] >= 0 && lp[2] < CHUNK_SIZE
  ) {
    const nIdx = chunkIndex(lp[0], lp[1], lp[2]);
    faceSky   = lightData.sky[nIdx];
    faceBlock = Math.max(lightData.block[nIdx], def.lightEmit);
  }
}

const baseR = r * shade;
const baseG = g * shade;
const baseB = b * shade;
```

Then in the vertex push loop for cube quads:

Current:
```ts
for (let k = 0; k < 4; k++) {
  positions.push(qc[k][0], qc[k][1], qc[k][2]);
  normals.push(normal[0], normal[1], normal[2]);
  colors.push(baseR * aoFactors[k], baseG * aoFactors[k], baseB * aoFactors[k]);
  uvs.push(uvc[k][0], uvc[k][1]);
}
```

Replace with:
```ts
for (let k = 0; k < 4; k++) {
  positions.push(qc[k][0], qc[k][1], qc[k][2]);
  normals.push(normal[0], normal[1], normal[2]);
  colors.push(baseR * aoFactors[k], baseG * aoFactors[k], baseB * aoFactors[k]);
  skyLight.push(faceSky);
  blockLight.push(faceBlock);
  uvs.push(uvc[k][0], uvc[k][1]);
}
```

**Fallback behavior:** when `lightData` is null the defaults are `sky=15, block=lightEmit`, which keeps the shader at full brightness during daytime uTimeOfDay=1.0. No special case needed.

- [ ] **Step 2: Update `worker.ts` — stop the transitional combine, pass the real `ChunkLightData`**

In `08-spline-terrain/src/worker.ts`, remove the `combined` Uint8Array construction added in Task 2, and pass `lightData` directly to `buildChunkMesh`:

```ts
const mesh = buildChunkMesh(data, getNeighbor, grassColors, lightData);
```

Then convert the two new number[] arrays to Float32Array and include them in the response:

```ts
const skyLight   = new Float32Array(mesh.skyLight);
const blockLight = new Float32Array(mesh.blockLight);
```

Extend `WorkerResponse`:
```ts
skyLightAttr:   Float32Array;
blockLightAttr: Float32Array;
```

Include them in the non-empty response and in its `transfer` array alongside positions/normals/etc.:
```ts
const resp: WorkerResponse = {
  id, cx, cy, cz,
  positions, normals, colors, uvs, indices,
  skyLightAttr: skyLight,
  blockLightAttr: blockLight,
  empty: false,
  blockData: data,
  grassColors,
  sky:   lightData.sky,
  block: lightData.block,
};

self.postMessage(resp, {
  transfer: [
    positions.buffer, normals.buffer, colors.buffer, uvs.buffer,
    indices.buffer,
    skyLight.buffer, blockLight.buffer,
    data.buffer, grassColors.buffer,
    lightData.sky.buffer, lightData.block.buffer,
  ],
});
```

For the empty branch, include zero-length Float32Arrays:
```ts
skyLightAttr:   new Float32Array(0),
blockLightAttr: new Float32Array(0),
```
(no need to transfer zero-length buffers).

- [ ] **Step 3: Update `world.ts` — register custom attributes and hook the material shader**

In `08-spline-terrain/src/world.ts`:

Import the shared uniform module at the top:
```ts
import { sharedDayNightUniforms } from "./dayNight";
```

Modify the `material` construction in the constructor to inject the shader code. Replace:
```ts
this.material = new THREE.MeshLambertMaterial({
  vertexColors: true,
  map: this.atlasTexture,
  alphaTest: 0.5,
  side: THREE.DoubleSide,
});
```

With:
```ts
this.material = new THREE.MeshLambertMaterial({
  vertexColors: true,
  map: this.atlasTexture,
  alphaTest: 0.5,
  side: THREE.DoubleSide,
});
this.material.onBeforeCompile = (shader) => {
  shader.uniforms.uTimeOfDay = sharedDayNightUniforms.uTimeOfDay;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       attribute float aSkyLight;
       attribute float aBlockLight;
       uniform float uTimeOfDay;
       varying float vLightFactor;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float _combined = max(aBlockLight, aSkyLight * uTimeOfDay);
       vLightFactor = 0.2 + (_combined / 15.0) * 0.8;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       varying float vLightFactor;`,
    )
    .replace(
      "#include <dithering_fragment>",
      `gl_FragColor.rgb *= vLightFactor;
       #include <dithering_fragment>`,
    );
};
```

In `onWorkerResult`, extend the non-empty geometry build to register the two new attributes:

```ts
geometry.setAttribute("position",    new THREE.Float32BufferAttribute(resp.positions, 3));
geometry.setAttribute("normal",      new THREE.Float32BufferAttribute(resp.normals, 3));
geometry.setAttribute("color",       new THREE.Float32BufferAttribute(resp.colors, 3));
geometry.setAttribute("uv",          new THREE.Float32BufferAttribute(resp.uvs, 2));
geometry.setAttribute("aSkyLight",   new THREE.Float32BufferAttribute(resp.skyLightAttr, 1));
geometry.setAttribute("aBlockLight", new THREE.Float32BufferAttribute(resp.blockLightAttr, 1));
geometry.setIndex(new THREE.Uint32BufferAttribute(resp.indices, 1));
```

- [ ] **Step 4: Verify compile and run**

Run: `cd 08-spline-terrain && npx tsc --noEmit`
Expected: no errors.

Reload the Vite page. Expected: world renders identically to before (uTimeOfDay is still 1.0). The surface is bright, caves are appropriately dark, grass tint still works. AO shading is unchanged.

Sanity-check: in devtools, set `sharedDayNightUniforms.uTimeOfDay.value = 0.3` from a temporary exposure (or via the console after `import("./src/dayNight.ts")` if needed) — the surface should dim. Revert before committing.

- [ ] **Step 5: Commit**

```bash
git add 08-spline-terrain/src/mesher.ts 08-spline-terrain/src/worker.ts 08-spline-terrain/src/world.ts
git commit -m "feat(08): bake sky/block light as vertex attributes, combine in shader

onBeforeCompile hooks uTimeOfDay into MeshLambertMaterial so skylight
scales per-frame without re-meshing. Default uniform = 1.0 preserves
the previous render."
```

---

## Task 4: Wire `dayNight` into the main render loop

**Files:**
- Modify: `08-spline-terrain/src/main.ts`

After this task the cycle runs automatically: no UI yet, but you can observe it.

- [ ] **Step 1: Initialize the state and extend the render loop**

In `08-spline-terrain/src/main.ts`:

Add imports at the top alongside the others:
```ts
import {
  createDayNightState,
  tickDayNight,
  sharedDayNightUniforms,
  type DayNightState,
} from "./dayNight";
```

Remove the static position on `dirLight`. Change:
```ts
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(80, 120, 40);
scene.add(dirLight);
```
to:
```ts
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
scene.add(dirLight);

const dayNightState: DayNightState = createDayNightState();
```

In the `animate` function, add the day-night tick after `dt` is computed (right after the `lastFrameTime = timestamp;` line, before the mode branch):

```ts
const frame = tickDayNight(dayNightState, dt);
sharedDayNightUniforms.uTimeOfDay.value = frame.skyLightFactor;
dirLight.position.copy(frame.sunDir).multiplyScalar(200);
dirLight.intensity = frame.sunIntensity;
ambientLight.intensity = frame.ambientIntensity;
ambientLight.color.copy(frame.ambientColor);
scene.background = frame.clearColor;
(scene.fog as THREE.Fog).color.copy(frame.clearColor);
```

Note: `scene.background` and `scene.fog.color` are updated together so the horizon blends into the sky. The fog color is currently a static hex; mutating its `.color` property is safe.

Also remove the initial fog-color baking. Change:
```ts
scene.background = new THREE.Color(0x7EC8E3);
scene.fog = new THREE.Fog(0x7EC8E3, 0, 1); // placeholder — set by updateFog()
```
to:
```ts
scene.background = new THREE.Color(0x7EC8E3);
scene.fog = new THREE.Fog(0x7EC8E3, 0, 1); // color overwritten each frame by dayNight; near/far by updateFog()
```
(only the comment changes — both lines still set a reasonable initial value before the first frame).

Expose the state to the debug panel Task 5 by storing it on `window` for manual console testing in the meantime — **not permanent, remove in Task 5**:

```ts
(window as unknown as { __dayNight: DayNightState }).__dayNight = dayNightState;
```

- [ ] **Step 2: Verify compile and run**

Run: `cd 08-spline-terrain && npx tsc --noEmit`
Expected: no errors.

Reload the Vite page. Expected: the cycle runs automatically at the default 120 s/cycle. Over 2 minutes you should see:
- Sky color transition dawn-orange → day-blue → dusk-orange → night-dark-blue
- Surface brightness pulsing up and down
- Caves stay dark regardless of time
- The directional light's shadow direction rotating (visible on terrain relief)

In devtools console, test pause: `__dayNight.paused = true` — cycle should freeze. Set `__dayNight.t = 0.8` — world should snap to night.

- [ ] **Step 3: Commit**

```bash
git add 08-spline-terrain/src/main.ts
git commit -m "feat(08): run day-night cycle in main render loop

Automatic cycle at 120s/rotation. Drives sky uniform, directional
light, ambient color, and scene background."
```

---

## Task 5: Add Day / Night section to the debug panel

**Files:**
- Modify: `08-spline-terrain/src/debugPanel.ts`
- Modify: `08-spline-terrain/src/main.ts`

The day-night state isn't part of `GenerationParams` (it's live, never triggers a rebuild). We add an independent section constructed imperatively and expose:
- a setter on `DebugPanel` to bind the `DayNightState` reference
- a public method `updateDayNightReadout(frame)` so `main.ts` can refresh the phase label each frame

- [ ] **Step 1: Add day-night fields and builder to `DebugPanel`**

In `08-spline-terrain/src/debugPanel.ts`:

Add the import at the top:
```ts
import type { DayNightState, DayNightFrame } from "./dayNight";
```

Add private fields alongside the existing ones (after `private splineRerenders` on line ~202):
```ts
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
```

Add a public method to bind the state and a method to refresh the readout:

```ts
attachDayNight(state: DayNightState): void {
  this.dayNightState = state;
  if (this.dnTimeSlider)    this.dnTimeSlider.value    = state.t.toFixed(3);
  if (this.dnCycleSlider)   this.dnCycleSlider.value   = String(state.cycleLengthSeconds);
  if (this.dnNightMinSlider) this.dnNightMinSlider.value = String(state.nightMin);
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
```

Add a private builder for the section. Place it near the other `build*Section` methods (after `buildAnchoredSection` for example):

```ts
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
```

Call the builder inside `build()`. Find the line that appends `applyRow` near the end of `build()`:
```ts
body.appendChild(applyRow);
```
Insert *before* that line:
```ts
body.appendChild(this.buildDayNightSection());
```

- [ ] **Step 2: Wire the debug panel from `main.ts`**

In `08-spline-terrain/src/main.ts`:

Remove the temporary window-exposure line from Task 4:
```ts
(window as unknown as { __dayNight: DayNightState }).__dayNight = dayNightState;
```

After `debugPanel` is constructed (around line 110–117), add:
```ts
debugPanel.attachDayNight(dayNightState);
```

In the render loop, after computing `frame`, call:
```ts
debugPanel.updateDayNightReadout(frame);
```
Place this line after the existing per-frame day-night writes (after `scene.background = frame.clearColor;`).

- [ ] **Step 3: Verify compile and interactive behavior**

Run: `cd 08-spline-terrain && npx tsc --noEmit`
Expected: no errors.

Reload the Vite page and open the debug panel (press `P`). Expand "Day / Night". Verify:

1. Default cycle length = 120 s, time ≈ 0.25, night floor = 4, pause unchecked.
2. Phase readout shows `day · 06:00` (or similar) and updates each frame.
3. Drag the **Time** slider from 0 to 1 — the world visibly transitions dawn → day → dusk → night. Releasing the slider resumes auto-advance from the dropped position.
4. Toggle **Paused** — cycle freezes. Unchecking resumes.
5. Move **Cycle (s)** to 30 — full cycle completes in 30 s.
6. Move **Night floor** to 0 at night — surface goes completely dark (surface voxels reach `(0/15)*0.8 + 0.2 = 0.2` brightness from the floor baseline). Move to 15 — "night" is indistinguishable from day (only the sun arc/colors change).
7. Caves stay visually dark at all times of day (block light only).

- [ ] **Step 4: Commit**

```bash
git add 08-spline-terrain/src/debugPanel.ts 08-spline-terrain/src/main.ts
git commit -m "feat(08): debug panel section for day/night cycle controls

Cycle length, time-of-day scrub, pause, night floor, phase readout.
Controls bind directly to the shared DayNightState; no regenerate
needed."
```

---

## Task 6: Final verification pass

**Files:** none modified; verification only.

- [ ] **Step 1: End-to-end visual checklist**

Reload fresh. Run through:

1. World loads at midday, surface bright, caves dark — baseline sanity.
2. Let the cycle run uninterrupted for one full 120 s rotation. Observe: sky color palette cycles smoothly, no flicker, no seams between chunks. Sun (dirLight) position rotates.
3. Open debug panel. Scrub time to `0.15` (end of dawn) — surface should be at full daylight brightness. Scrub to `0.5` — still full daylight. Scrub to `0.575` (mid-dusk) — visibly dimmer. Scrub to `0.65` (start of night) — surface at night-floor brightness. Scrub to `0.8` (deep night) — same brightness (plateau).
4. With time at `0.8`, move around — verify cave visibility unchanged; sprites (grass/flowers) dim with sky light like cube faces.
5. Generate a new world (`Apply & Regenerate` in the panel). Cycle state is preserved (not reset) — intentional, since it's decoupled from generation.
6. Resize the browser window. No visual regression.

- [ ] **Step 2: Performance check**

Open devtools Performance tab. Record 5 seconds with the cycle running. Look at frame time: the added per-frame cost should be negligible (≤ 0.1 ms — it's 6 simple writes).

If frame time regressed noticeably (> 1 ms), inspect whether `scene.background = frame.clearColor` is triggering per-frame texture upload — if so, clone the color into a persistent THREE.Color set once and mutate `.r/.g/.b` each frame instead.

- [ ] **Step 3: No commit (verification only)**

If any issue was found and fixed, commit with an appropriate message describing the fix. Otherwise stop here — the feature is complete.

---

## Post-implementation notes

- The color palette in `dayNight.ts` is tuned blind — expect to iterate on the exact hex values once you've seen it in motion. Palette constants are hoisted so a single-line edit drives the whole cycle.
- No moonlight direction is added; the directional light just dims to `sunIntensity = 0.2 + nightMin/15 * 0.8 ≈ 0.41` during full night. If you want a separate moon, add a second `DirectionalLight` and drive its intensity as `1 - sunIntensity` — out of scope here.
- The `onBeforeCompile` injection relies on `MeshLambertMaterial`'s shader chunks (`<common>`, `<begin_vertex>`, `<dithering_fragment>`) being present. If upgrading Three.js changes these hook names, the shader will silently fall back to stock behavior (attributes unread). Manual verification in Task 3 catches that regression.
