# Caves & Lakes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `07-advanced-terrain`'s isotropic "crater" cave pass with intersecting-noise tube caves and add a noise-field water table that produces elevated lakes and underground aquifers.

**Architecture:** Two independent 3D fBm fields intersected (`|n1|<t && |n2|<t`) define connected winding tunnels; depth-biased threshold stretches the field vertically. A separate low-frequency 3D presence field plus a 2D level field defines a region-local water surface that floods both cave air and surface air columns.

**Tech Stack:** TypeScript, Vite. Project 07 has no test harness, linter, or formatter — verification is `npm run build` (typecheck) plus manual visual inspection in the dev server. Spec reference: `docs/superpowers/specs/2026-04-12-caves-lakes-design.md`.

**Notes for executor:**
- All file paths are relative to the repo root `/home/maestre/Proyectos/world-imaginer/`.
- Run all `npm` commands from inside `07-advanced-terrain/`.
- Commit after each task. Each task leaves the code in a compiling state.
- Do not attempt to run tests — there are none.

---

## File Structure

Files touched in this plan:

- `07-advanced-terrain/src/generationParams.ts` — new `AquiferParams` type, revised `CaveParams` fields, updated `DEFAULT_PARAMS`.
- `07-advanced-terrain/src/chunk.ts` — new cave pass, deleted surface erosion pass, new aquifer pass.
- `07-advanced-terrain/src/debugPanel.ts` — new slider definitions for caves, new section for aquifers, updated `Cave Heavy` preset, updated `importPreset` merge.

No other files change.

---

## Task 1: Add `AquiferParams` type and defaults

**Files:**
- Modify: `07-advanced-terrain/src/generationParams.ts`

This task is purely additive — introduces the `aquifers` field on `GenerationParams` without touching caves yet. The new field is not yet read by `chunk.ts` or displayed in the debug panel; those come in later tasks. Build stays green because all existing references to params are unchanged.

- [ ] **Step 1: Add `AquiferParams` interface**

In `07-advanced-terrain/src/generationParams.ts`, after the existing `CaveParams` interface (around line 21), add:

```ts
export interface AquiferParams {
  /** Master toggle for aquifer/lake generation. */
  enabled: boolean;
  /** Scale of the 3D presence field. Larger = sparser lake regions. */
  presenceScale: number;
  /** Threshold on presence field; only cells above this have a local water table. Higher = rarer. */
  presenceThreshold: number;
  /** Scale of the 2D local water-surface height field. */
  levelScale: number;
  /** Vertical wobble amplitude of the local water surface. */
  levelAmplitude: number;
  /** Baseline Y offset of the local water surface (relative to global waterLevel). */
  levelOffset: number;
}
```

- [ ] **Step 2: Add `aquifers` to `GenerationParams`**

In the same file, update the `GenerationParams` interface to include `aquifers`. The final shape should look like:

```ts
export interface GenerationParams {
  terrain: TerrainParams;
  erosion: ErosionParams;
  caves: CaveParams;
  aquifers: AquiferParams;
  rivers: RiverParams;
  biomes: BiomeParams;
  ores: OreParams;
}
```

- [ ] **Step 3: Add `aquifers` defaults to `DEFAULT_PARAMS`**

In the same file, in the `DEFAULT_PARAMS` object, add an `aquifers` block after `caves` and before `rivers`:

```ts
  aquifers: {
    enabled: true,
    presenceScale: 160,
    presenceThreshold: 0.35,
    levelScale: 80,
    levelAmplitude: 8,
    levelOffset: 2,
  },
```

- [ ] **Step 4: Typecheck**

Run:
```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds. No type errors. The new field is present but unused.

- [ ] **Step 5: Commit**

```bash
git add 07-advanced-terrain/src/generationParams.ts
git commit -m "feat(07): add AquiferParams type and defaults"
```

---

## Task 2: Swap cave algorithm + update CaveParams + update debug panel caves section

This task is atomic: the `CaveParams` field names change, so `generationParams.ts`, `chunk.ts`, and `debugPanel.ts` must all change in the same commit or the build breaks. The old surface-erosion pass at `chunk.ts:244–270` is left in place for this task (it still compiles against the retained `surfaceErosionScale/Threshold/Depth` fields, which we keep temporarily as deprecated). Task 3 removes them.

**Wait — simpler:** we remove the old cave logic AND the surface-erosion fields in this task, since the surface-erosion loop is just a few lines and removing it here avoids carrying dead state. So this task handles both the new cave pass and the removal of the old erosion loop as a single atomic swap.

**Files:**
- Modify: `07-advanced-terrain/src/generationParams.ts`
- Modify: `07-advanced-terrain/src/chunk.ts`
- Modify: `07-advanced-terrain/src/debugPanel.ts`

- [ ] **Step 1: Replace `CaveParams` fields in `generationParams.ts`**

Find the existing `CaveParams` interface and replace its body so it reads:

```ts
export interface CaveParams {
  /** Noise scale for tunnel sizing (larger = wider features). */
  scale: number;
  /** Number of fBm octaves. */
  octaves: number;
  /** Y-axis stretch factor: >1 elongates noise vertically → tunnels prefer horizontal. */
  verticalStretch: number;
  /** Base threshold |n|<t near the surface. Smaller = rarer surface openings. */
  thresholdBase: number;
  /** Maximum threshold at depth. Larger = wider deep networks. */
  thresholdMax: number;
  /** Per-block growth of threshold with depth. */
  depthGain: number;
  /** Minimum depth below the surface before caves can carve. Protects top blocks. */
  minDepth: number;
}
```

The old fields (`threshold`, `surfaceErosionScale`, `surfaceErosionThreshold`, `surfaceErosionDepth`) are removed.

- [ ] **Step 2: Replace the `caves` block in `DEFAULT_PARAMS`**

In `generationParams.ts`, update the `caves` block inside `DEFAULT_PARAMS` so it reads:

```ts
  caves: {
    scale: 22,
    octaves: 3,
    verticalStretch: 2.0,
    thresholdBase: 0.06,
    thresholdMax: 0.16,
    depthGain: 0.004,
    minDepth: 2,
  },
```

- [ ] **Step 3: Rewrite the cave pass in `chunk.ts`**

In `07-advanced-terrain/src/chunk.ts`:

**3a.** Near the top of `generateChunk` where noise instances are created (around line 55), add a second cave noise seed. The block should read:

```ts
  const noise = createNoise(seed);
  const caveNoise = createNoise(seed + 1);
  const caveNoiseB = createNoise(seed + 9);
  const oreNoise = createNoise(seed + 2);
  const treeNoise = createNoise(seed + 3);
  const lavaNoise      = createNoise(seed + 4);
  const glowstoneNoise = createNoise(seed + 8);
```

**3b.** Find the existing cave-carving block inside the main voxel loop (around lines 219–227), which currently reads:

```ts
        // 3D caves — larger scale = wider tunnels, higher threshold = fewer caves
        // Threshold eases near surface so some caves open to the sky
        if (depth > 1) {
          const caveVal = caveNoise.fbm3D(wx / caves.scale, wy / caves.scale, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const threshold = depth < 8 ? caves.threshold - 0.03 + (depth - 2) * 0.005 : caves.threshold;
          if (caveVal > threshold) {
            block = wy <= waterLevel ? Block.Water : Block.Air;
          }
        }
```

Replace that block with:

```ts
        // 3D caves — intersecting-noise tubes.
        // Two independent fbm3D fields, each thresholded as |n|<t, define 2D
        // iso-surfaces; their intersection is a 1D curve → winding tunnel.
        // verticalStretch divides y by a larger number so the noise varies
        // slowly in y, giving near-horizontal iso-surfaces and horizontal tubes.
        // Depth-biased threshold: tight near surface (few openings), wider deep.
        if (depth >= caves.minDepth) {
          const yScaled = wy / (caves.scale * caves.verticalStretch);
          const n1 = caveNoise.fbm3D(wx / caves.scale, yScaled, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const n2 = caveNoiseB.fbm3D(wx / caves.scale, yScaled, wz / caves.scale, caves.octaves, 0.5, 2.0);
          const t = Math.min(caves.thresholdMax, caves.thresholdBase + depth * caves.depthGain);
          if (Math.abs(n1) < t && Math.abs(n2) < t) {
            block = wy <= waterLevel ? Block.Water : Block.Air;
          }
        }
```

**3c.** Delete the entire surface cave erosion pass (currently at chunk.ts lines 244–270). Remove these lines:

```ts
  // Surface cave erosion — carve irregular openings near the surface
  // using a separate noise field so caves sometimes breach the surface
  const erosionNoise = createNoise(seed + 5);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = worldXOff + lx;
      const wz = worldZOff + lz;
      const surfaceH = heights[lz * CHUNK_SIZE + lx];
      const surfaceLocal = Math.floor(surfaceH) - worldYOff;

      for (let dy = 0; dy <= caves.surfaceErosionDepth; dy++) {
        const ly = surfaceLocal - dy;
        if (ly < 0 || ly >= CHUNK_SIZE) continue;
        const wy = worldYOff + ly;
        if (wy <= waterLevel) continue;

        const erosion = erosionNoise.fbm3D(
          wx / caves.surfaceErosionScale, wy / caves.surfaceErosionScale, wz / caves.surfaceErosionScale,
          3, 0.5, 2.0,
        );
        const threshold = caves.surfaceErosionThreshold + dy * 0.02;
        if (erosion > threshold) {
          data[chunkIndex(lx, ly, lz)] = Block.Air;
        }
      }
    }
  }
```

The loop is gone entirely. The next pass (lava placement) now runs directly after the main voxel fill.

- [ ] **Step 4: Update the caves slider list in `debugPanel.ts`**

In `07-advanced-terrain/src/debugPanel.ts`, find the `caves` entry in the `SECTIONS` array (around lines 55–64) and replace its `sliders` array. The full entry should read:

```ts
  {
    id: "caves", label: "Caves", paramsKey: "caves", expanded: false,
    sliders: [
      { key: "scale",           label: "Scale",            min: 5,    max: 60,   step: 1,    decimals: 0 },
      { key: "octaves",         label: "Octaves",          min: 1,    max: 6,    step: 1,    decimals: 0 },
      { key: "verticalStretch", label: "Vertical Stretch", min: 0.5,  max: 4,    step: 0.1,  decimals: 1 },
      { key: "thresholdBase",   label: "Threshold Base",   min: 0,    max: 0.2,  step: 0.005, decimals: 3 },
      { key: "thresholdMax",    label: "Threshold Max",    min: 0.05, max: 0.35, step: 0.005, decimals: 3 },
      { key: "depthGain",       label: "Depth Gain",       min: 0,    max: 0.02, step: 0.0005, decimals: 4 },
      { key: "minDepth",        label: "Min Depth",        min: 1,    max: 8,    step: 1,    decimals: 0 },
    ],
  },
```

- [ ] **Step 5: Update the `Cave Heavy` preset**

In `07-advanced-terrain/src/debugPanel.ts`, find the `Cave Heavy` entry in `BUILT_IN_PRESETS` (around lines 125–131). Replace its `caves` block (which currently uses the old field names) with the new shape:

```ts
  {
    name: "Cave Heavy", builtIn: true,
    params: {
      ...cloneParams(DEFAULT_PARAMS),
      caves: {
        scale: 22,
        octaves: 4,
        verticalStretch: 2.0,
        thresholdBase: 0.09,
        thresholdMax: 0.22,
        depthGain: 0.006,
        minDepth: 2,
      },
    },
  },
```

- [ ] **Step 6: Typecheck**

Run:
```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds. If there is any error referencing `surfaceErosion*`, `caves.threshold`, or `erosionNoise`, go back and remove the stale reference. If there is an unused-variable warning for the old `erosionNoise` declaration, confirm step 3c deleted it.

- [ ] **Step 7: Commit**

```bash
git add 07-advanced-terrain/src/generationParams.ts 07-advanced-terrain/src/chunk.ts 07-advanced-terrain/src/debugPanel.ts
git commit -m "feat(07): replace isotropic caves with intersecting-noise tubes

- New two-field cave test (abs(n1)<t && abs(n2)<t) produces
  connected winding tunnels instead of isolated blobs.
- Depth-biased threshold: rare near surface, denser deep.
- verticalStretch elongates noise vertically so tunnels prefer
  horizontal orientation.
- Delete the separate surface erosion pass that produced
  disconnected craters."
```

---

## Task 3: Add aquifer pass to `chunk.ts`

**Files:**
- Modify: `07-advanced-terrain/src/chunk.ts`

This task adds the new voxel-pass that floods Air cells (both cave air and surface air) inside a 3D presence region up to a locally-varying water surface height. Runs after caves and before lava. Uses two fresh noise seeds.

- [ ] **Step 1: Add aquifer noise seeds**

In `07-advanced-terrain/src/chunk.ts`, in the noise-creation block near the top of `generateChunk` (which should already include `caveNoiseB` from Task 2), add two more noise instances so the block reads:

```ts
  const noise = createNoise(seed);
  const caveNoise = createNoise(seed + 1);
  const caveNoiseB = createNoise(seed + 9);
  const oreNoise = createNoise(seed + 2);
  const treeNoise = createNoise(seed + 3);
  const lavaNoise      = createNoise(seed + 4);
  const glowstoneNoise = createNoise(seed + 8);
  const aquiferPresenceNoise = createNoise(seed + 10);
  const aquiferLevelNoise    = createNoise(seed + 11);
```

- [ ] **Step 2: Insert the aquifer pass between the voxel fill and the lava pass**

In `chunk.ts`, find the comment `// ── Lava placement (deep chunks only) ────────────────` (now immediately after the main voxel fill, since Task 2 deleted the surface erosion pass). Directly **before** that comment, insert the following block:

```ts
  // ── Aquifer / lake pass ──────────────────────────────────────────
  // A low-frequency 3D presence field marks regions that have a local
  // water table; a 2D level field gives that region a smoothly-varying
  // local water surface height. Any Air cell inside such a region at or
  // below the local surface becomes Water — this produces both flooded
  // cave aquifers underground and surface ponds that sit above the
  // global ocean water level.
  const { aquifers } = config.params;
  if (aquifers.enabled) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const wy = worldYOff + ly;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = worldZOff + lz;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = worldXOff + lx;
          const voxIdx = chunkIndex(lx, ly, lz);
          if (data[voxIdx] !== Block.Air) continue;

          const presence = aquiferPresenceNoise.fbm3D(
            wx / aquifers.presenceScale,
            wy / (aquifers.presenceScale * 2),
            wz / aquifers.presenceScale,
            2, 0.5, 2.0,
          );
          if (presence <= aquifers.presenceThreshold) continue;

          const localSurface = waterLevel
            + aquifers.levelOffset
            + aquiferLevelNoise.fbm2D(
                wx / aquifers.levelScale,
                wz / aquifers.levelScale,
                2, 0.5, 2.0,
              ) * aquifers.levelAmplitude;

          if (wy <= localSurface) {
            data[voxIdx] = Block.Water;
          }
        }
      }
    }
  }
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds. No type errors.

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/chunk.ts
git commit -m "feat(07): add aquifer pass for elevated lakes and flooded caves

A 3D presence field marks regions with a local water table; a 2D
level field gives those regions a smoothly-varying water surface
height independent of the global ocean level. The pass floods Air
cells — both underground cave air and surface air columns —
producing both aquifers and elevated lakes."
```

---

## Task 4: Expose aquifer controls in the debug panel

**Files:**
- Modify: `07-advanced-terrain/src/debugPanel.ts`

Adds a new collapsible `Aquifers` section to the panel, and updates `importPreset` so imported preset files include the new `aquifers` group (preventing missing-field runtime errors on old presets).

- [ ] **Step 1: Add the `aquifers` section to `SECTIONS`**

In `07-advanced-terrain/src/debugPanel.ts`, in the `SECTIONS` array, add a new entry **after** the `caves` entry and **before** the `rivers` entry:

```ts
  {
    id: "aquifers", label: "Aquifers & Lakes", paramsKey: "aquifers", expanded: false,
    toggle: { key: "enabled", label: "Enabled" },
    sliders: [
      { key: "presenceScale",     label: "Presence Scale",     min: 40,  max: 400, step: 5,    decimals: 0 },
      { key: "presenceThreshold", label: "Presence Threshold", min: 0.1, max: 0.7, step: 0.01, decimals: 2 },
      { key: "levelScale",        label: "Level Scale",        min: 20,  max: 200, step: 5,    decimals: 0 },
      { key: "levelAmplitude",    label: "Level Amplitude",    min: 0,   max: 30,  step: 0.5,  decimals: 1 },
      { key: "levelOffset",       label: "Level Offset",       min: -20, max: 30,  step: 0.5,  decimals: 1 },
    ],
  },
```

- [ ] **Step 2: Add `aquifers` to the `importPreset` merge**

In `debugPanel.ts`, find the `importPreset` method (around lines 562–607). Locate the block that constructs the `params` object (around lines 586–593) and add an `aquifers` line so it reads:

```ts
          const params: GenerationParams = {
            terrain:  { ...DEFAULT_PARAMS.terrain,  ...(raw.terrain  ?? {}) },
            erosion:  { ...DEFAULT_PARAMS.erosion,  ...(raw.erosion  ?? {}) },
            caves:    { ...DEFAULT_PARAMS.caves,    ...(raw.caves    ?? {}) },
            aquifers: { ...DEFAULT_PARAMS.aquifers, ...(raw.aquifers ?? {}) },
            rivers:   { ...DEFAULT_PARAMS.rivers,   ...(raw.rivers   ?? {}) },
            biomes:   { ...DEFAULT_PARAMS.biomes,   ...(raw.biomes   ?? {}) },
            ores:     { ...DEFAULT_PARAMS.ores,     ...(raw.ores     ?? {}) },
          };
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd 07-advanced-terrain && npm run build
```

Expected: build succeeds. No type errors.

- [ ] **Step 4: Commit**

```bash
git add 07-advanced-terrain/src/debugPanel.ts
git commit -m "feat(07): expose aquifer controls in debug panel"
```

---

## Task 5: Visual verification against acceptance criteria

**Files:** none modified.

This task is manual browser-based verification. Project 07 has no automated tests, so this is the acceptance gate.

- [ ] **Step 1: Start the dev server**

```bash
cd 07-advanced-terrain && npm run dev
```

Expected: Vite prints a local URL (typically `http://localhost:5181`).

- [ ] **Step 2: Open the world in a browser and inspect**

Open the printed URL. Walk/fly the camera over several chunks with the default seed. Verify each acceptance criterion from the spec:

1. **No surface craters** — the dirt/stone "patch" artifacts from the old surface-erosion pass should be gone. The ground surface should be continuous grass / sand / snow except where a real tunnel reaches up through it.
2. **Connected tunnels** — dig or fly underground. Tunnels should branch, persist over many blocks, and form a network (not isolated pockets).
3. **Density increases with depth** — near the surface, caves should be rare and narrow; deeper down, they should be more common and wider.
4. **Surface caves are real entrances** — any cave opening at the surface should lead into the underground network below it, not just a shallow dimple.
5. **Elevated lakes exist** — scan the landscape for ponds sitting on hills or plateaus above the global ocean level.
6. **Flooded caves** — inspect at least one underground cavity and confirm some caves contain water (aquifers).
7. **Global ocean unchanged** — the main ocean around the world fills exactly as before.

If any criterion fails, note which and return to the relevant earlier task to tune parameters or fix logic.

- [ ] **Step 3: Exercise the debug panel**

Open the debug panel (default keybinding in project 07 — press the key that toggles it, typically `P` or similar; confirm by looking at `main.ts`). Verify:

- The **Caves** section shows 7 sliders: Scale, Octaves, Vertical Stretch, Threshold Base, Threshold Max, Depth Gain, Min Depth.
- The **Aquifers & Lakes** section appears after Caves with an Enabled toggle and 5 sliders (Presence Scale, Presence Threshold, Level Scale, Level Amplitude, Level Offset).
- No `Surface Erosion *` sliders remain.
- Selecting the `Cave Heavy` preset and clicking **Apply & Regenerate** does not throw a console error and produces a visibly cave-rich world.
- Raising `presenceThreshold` to ~0.5 and regenerating visibly reduces the number of lakes/aquifers.
- Lowering `presenceThreshold` to ~0.2 visibly increases them.

- [ ] **Step 4: Stop the dev server**

Press `Ctrl+C` in the terminal.

- [ ] **Step 5: Report**

If all criteria pass, report "caves & lakes redesign complete — all acceptance criteria met." If any failed, list which ones and which parameters or code paths seem to need adjustment.
