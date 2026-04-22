# Day / Night Cycle — Design

**Project:** `08-spline-terrain`
**Date:** 2026-04-22

## Goal

Add a running day-night cycle that modulates light levels on the surface of the voxel world. Sky-exposed voxels are bright during the day, gradually dim through dusk, reach a minimum at night, and ramp back up through dawn. Caves and other non-sky-exposed voxels are unaffected by the time of day — their darkness is governed only by block-emitted light.

The cycle also drives scene atmospherics: the `DirectionalLight` ("sun") traces an arc across the sky, ambient color warms toward sunrise/sunset and cools at night, and the clear color shifts to match.

The feature is a research/inspection tool as much as an effect: the debug panel exposes pause, time scrub, cycle length, and night-floor controls so the full cycle can be studied frame-by-frame.

## Non-goals

- No geometric sun / moon disc, no skybox, no stars.
- No change to block-emitter light propagation semantics.
- No re-meshing as time advances — geometry is baked once, the shader does the work per frame.

## Architecture

A new module, `src/dayNight.ts`, owns the authoritative `DayNightState`:

```ts
interface DayNightState {
  t: number;                  // position in cycle, [0, 1)
  paused: boolean;
  cycleLengthSeconds: number; // default 120
  nightMin: number;           // 0..15, default 4
}

interface DayNightFrame {
  skyLightFactor: number;     // [nightMin/15, 1]
  sunDir: THREE.Vector3;      // unit vector
  sunIntensity: number;
  ambientIntensity: number;
  ambientColor: THREE.Color;
  clearColor: THREE.Color;
  phase: 'dawn' | 'day' | 'dusk' | 'night';
  clockLabel: string;         // cosmetic HH:MM
}
```

`dayNight.tick(dt: number): DayNightFrame` advances `t` (unless paused) and returns the derived frame.

The render loop in `main.ts` calls `tick` once per frame and:

1. Writes `skyLightFactor` into the shared `uTimeOfDay` uniform used by every chunk material.
2. Updates `dirLight.position`, `dirLight.intensity`, `ambientLight.intensity`, `ambientLight.color`.
3. Calls `renderer.setClearColor(clearColor)`.

No chunk re-meshing is triggered by time changes — the shader combines baked sky/block light with the uniform per fragment.

## Phase curve

Cycle partitioned by named constants in `dayNight.ts`:

```ts
const DAWN_END = 0.15;
const DAY_END  = 0.50;
const DUSK_END = 0.65;
// night runs DUSK_END .. 1.0
```

`skyLightFactor(t)` is piecewise:

| Phase | Range        | Value                                               |
|-------|--------------|-----------------------------------------------------|
| dawn  | `[0, 0.15)`  | `lerp(nightMin/15, 1, smoothstep(0, 0.15, t))`      |
| day   | `[0.15, 0.5)`| `1.0`                                               |
| dusk  | `[0.5, 0.65)`| `lerp(1, nightMin/15, smoothstep(0.5, 0.65, t))`    |
| night | `[0.65, 1)`  | `nightMin/15`                                       |

Using `smoothstep` (not linear) gives gentler entry/exit from the plateaus, matching "gradually adjusts" from the requirements.

**Defaults:** `cycleLengthSeconds = 120`, `nightMin = 4`, starting `t = 0.25` (mid-day).

**Sun arc:** angle = `t * 2π`; `sunDir = normalize(cos(angle), sin(angle), 0.3)`. The 0.3 Z-tilt keeps shadow direction off-axis. `sunDir * 200` is the light's world-space position. `sunIntensity = skyLightFactor`.

**Ambient color / clear color:** interpolate across a small palette. Warm (orange-tinted) during dawn and dusk, cool blue-grey at night, near-white at day. Clear color uses the same curve at slightly lower brightness for contrast. Exact hex values determined at implementation time; not load-bearing for the architecture.

## Per-voxel sky / block light split

`lighting.ts` currently returns a single `Uint8Array` with combined light 0–15. Change to:

```ts
export interface ChunkLightData {
  sky:   Uint8Array; // 0..15
  block: Uint8Array; // 0..15
}

export function computeChunkLocalLight(data: ChunkData): ChunkLightData;
```

Two independent BFS passes:

- **Sky pass** — seed level 15 for every transparent, sky-exposed voxel (top-down column scan, unchanged logic). Propagate through transparent neighbors, losing 1 per step.
- **Block pass** — seed `BLOCK_DEFS[id].lightEmit` for every emitting voxel. Propagate through transparent neighbors, losing 1 per step.

No mixing at this stage. The shader does the combine per frame.

## Mesher changes

`src/mesher.ts` currently bakes `lightFactor = 0.2 + (light/15) * 0.8` into the RGB vertex color before writing. Change:

- Remove `lightFactor` from the vertex color. The vertex color retains only the face-shade term and any block tint.
- Emit two new per-vertex attributes:
  - `aSkyLight: Float32` — sky light level of the air-side voxel, 0..15
  - `aBlockLight: Float32` — block light level of the same voxel, 0..15
- Same values are written for sprite (cross) meshes and for cube faces.

The mesher signature changes to accept `ChunkLightData` instead of `Uint8Array | null`. The fallback "no light data → treat as 15" path keeps working by writing 15 to both channels.

## Worker changes

`src/worker.ts` currently returns `{ meshData, light }`. Change to `{ meshData, sky, block }`, transferring both `Uint8Array`s alongside the existing mesh transferables.

`src/world.ts` (chunk consumer) holds `sky` and `block` instead of a single `light` buffer, and passes both into the material setup on the main thread.

## Shader wiring

Chunk materials continue to use `MeshLambertMaterial` (or whichever built-in material is currently paired with the mesher — keep the existing base). Extend via `material.onBeforeCompile`:

1. **Vertex shader:**
   - Declare `attribute float aSkyLight;` and `attribute float aBlockLight;`
   - Declare `uniform float uTimeOfDay;`
   - Declare `varying float vLightFactor;`
   - Compute, before `gl_Position`:
     ```glsl
     float combined = max(aBlockLight, aSkyLight * uTimeOfDay);
     vLightFactor = 0.2 + (combined / 15.0) * 0.8;
     ```
2. **Fragment shader:**
   - Declare the matching `varying float vLightFactor;`
   - After the existing diffuse/map computation, multiply `gl_FragColor.rgb *= vLightFactor;` (inject before tonemapping).

A single shared uniform object is exported from `dayNight.ts`:

```ts
export const sharedDayNightUniforms = { uTimeOfDay: { value: 1.0 } };
```

The mesher imports this and passes it into each material's `onBeforeCompile` via the closure, ensuring every chunk's shader references the same uniform value object. `main.ts` writes `sharedDayNightUniforms.uTimeOfDay.value` once per frame; no per-chunk assignment is needed.

## Debug panel

`src/debugPanel.ts` gains a new `dayNightSection` factory matching the existing section pattern (`climateSection`, spline editor, etc.). Controls:

| Control        | Type     | Range / Values              | Default |
|----------------|----------|-----------------------------|---------|
| Cycle length   | slider   | 30 – 600 s, step 5          | 120     |
| Time of day    | slider   | 0.000 – 0.999, step 0.001   | 0.250   |
| Pause / play   | checkbox | on / off                    | off     |
| Night floor    | slider   | 0 – 15, step 1              | 4       |
| Phase readout  | text     | `dawn \| day \| dusk \| night` + `HH:MM` | live |

Interaction rules:

- **Time-of-day slider** is two-way. Auto-advance writes back to the slider each frame. User drags (detected via `input` events) write into `state.t` and are authoritative — during a drag, auto-advance is suppressed for that frame by comparing the slider value against the model.
- **Pause checkbox** gates the auto-advance in `tick`.
- **Cycle length** and **night floor** are applied live, no restart needed.

Phase readout updates each frame alongside the other per-frame state.

## File-level change summary

- **New:** `src/dayNight.ts` — state, `tick`, derived-frame helpers, `sharedDayNightUniforms`, constants.
- **Modified:** `src/lighting.ts` — return `ChunkLightData` with two channels, two BFS passes.
- **Modified:** `src/mesher.ts` — remove baked light factor from vertex color, emit `aSkyLight` / `aBlockLight` attributes, accept `ChunkLightData`.
- **Modified:** `src/worker.ts` — return `{ meshData, sky, block }`, transfer both buffers.
- **Modified:** `src/world.ts` — hold and forward both light buffers.
- **Modified:** `src/main.ts` — initialize `dayNight`, call `tick` in render loop, write uniform + scene lights + clear color.
- **Modified:** `src/debugPanel.ts` — add `dayNightSection` factory and wire it into the panel.

## Testing / verification

No unit tests exist in this repo. Verification is manual, via the debug panel:

1. Open the project, scrub the time-of-day slider from 0 to 1 — surface should cycle brightness smoothly, caves should stay dark at the level given by block light only.
2. Pause at `t ≈ 0.25` (day): surface bright.
3. Pause at `t ≈ 0.8` (night): surface dim to `nightMin/15 * 0.8 + 0.2` brightness. Torch-lit areas still visible.
4. Verify dawn/dusk transitions are smooth, not stepped (smoothstep check).
5. Verify the sun (DirectionalLight) position moves across the sky as `t` advances — shadow direction visibly rotates.
6. Live-adjust night floor to 0 — confirm surface goes black at night.
7. Live-adjust cycle length to 30 s — full cycle completes in half a minute without stutter.

## Open questions / deferred

- Exact color palette for ambient/clear color at each phase — picked at implementation time.
- Sprite-mesh face shading: confirm cross billboards receive the same `aSkyLight`/`aBlockLight` treatment as cube faces (expected: yes, trivial addition).
- No moonlight intensity for directional light at night — it just dims with `skyLightFactor`. Adding a separate moon direction/color is a future extension, out of scope.
