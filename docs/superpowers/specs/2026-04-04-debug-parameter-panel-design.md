# Debug Parameter Panel — Design Spec

**Project:** 07-advanced-terrain  
**Date:** 2026-04-04  

## Goal

Create a floating, draggable debug panel that exposes all world generation parameters as adjustable controls. This enables rapid iteration on terrain settings without code changes, significantly improving the research workflow.

## Layout

- **Floating overlay** on top of the full-width 3D viewport
- Draggable by title bar, position persisted in localStorage
- Minimizable to just the title bar via a (−) button
- Toggled via toolbar button or keyboard shortcut (`P`)
- Default position: top-right corner

## Sections

The panel uses collapsible accordion sections. **Terrain Noise** and **Erosion** are expanded by default; all others start collapsed. Each section header shows the section name and a small "reset" button to restore that section's defaults.

### 1. Terrain Noise (7 parameters)

| Parameter | Range | Default | Step |
|-----------|-------|---------|------|
| Scale | 10–500 | 80 | 5 |
| Octaves | 1–8 | 5 | 1 |
| Persistence | 0.01–1.0 | 0.5 | 0.01 |
| Lacunarity | 1.0–4.0 | 2.0 | 0.1 |
| Warp Strength | 0.0–10.0 | 3.0 | 0.1 |
| Warp Iterations | 0–4 | 1 | 1 |
| Height Multiplier | 1–60 | 20 | 1 |

These map to the `warpedFbm2D` call in `chunk.ts` and the `baseNoise * 20 * blendedScales[idx]` height formula.

### 2. Erosion (8 parameters)

| Parameter | Range | Default | Step |
|-----------|-------|---------|------|
| Enabled | toggle | true | — |
| Droplets | 0–5000 | 250 | 50 |
| Erosion Rate | 0.0–1.0 | 0.3 | 0.01 |
| Deposition Rate | 0.0–1.0 | 0.3 | 0.01 |
| Inertia | 0.0–1.0 | 0.3 | 0.01 |
| Max Lifetime | 10–200 | 48 | 1 |
| Evaporation Rate | 0.0–0.1 | 0.02 | 0.005 |
| Gravity | 1–30 | 10 | 1 |

Maps to `ErosionConfig` in `erosion.ts`. The existing `erosionDroplets` in `WorldConfig` is replaced by the full config being passed through.

### 3. Caves (6 parameters)

| Parameter | Range | Default | Step |
|-----------|-------|---------|------|
| Scale | 5–100 | 30 | 1 |
| Octaves | 1–6 | 3 | 1 |
| Threshold | 0.20–0.70 | 0.45 | 0.01 |
| Surface Erosion Scale | 5–50 | 16 | 1 |
| Surface Erosion Threshold | 0.20–0.60 | 0.38 | 0.01 |
| Surface Erosion Depth | 2–16 | 8 | 1 |

Maps to the cave-carving pass and surface cave erosion pass in `chunk.ts`.

### 4. Rivers (3 parameters)

| Parameter | Range | Default | Step |
|-----------|-------|---------|------|
| Voronoi Scale | 50–500 | 200 | 10 |
| Edge Threshold | 0.01–0.20 | 0.08 | 0.01 |
| Max Carve Depth | 1–15 | 6 | 1 |

Maps to the Voronoi river channel pass in `chunk.ts`.

### 5. Biomes (5 parameters)

| Parameter | Range | Default | Step |
|-----------|-------|---------|------|
| Temp/Humidity Scale | 100–600 | 300 | 10 |
| Continent Scale | 200–1000 | 500 | 10 |
| Ocean Threshold | −0.60–0.00 | −0.30 | 0.01 |
| Beach Threshold | −0.40–0.10 | −0.15 | 0.01 |
| Mountain Threshold | 0.20–0.80 | 0.45 | 0.01 |

Maps to the noise scales and threshold constants in `biomes.ts`.

### 6. Ores (4 parameters)

| Parameter | Range | Default | Step |
|-----------|-------|---------|------|
| Scale | 2–20 | 6 | 1 |
| Iron Threshold | 0.30–0.80 | 0.55 | 0.01 |
| Iron Min Depth | 5–30 | 15 | 1 |
| Coal Threshold | 0.30–0.70 | 0.50 | 0.01 |

Maps to the ore placement pass in `chunk.ts`.

### Not Exposed

The following parameters remain hardcoded as they rarely need adjustment:
- `ErosionConfig.minSlope` (0.01) — prevents infinite erosion on flat terrain
- `ErosionConfig.erosionRadius` (2) — brush radius, changing it has minimal visible impact
- Cave persistence/lacunarity — always 0.5/2.0, standard fBm defaults
- Ore octaves/persistence/lacunarity — same reason

## Parameter Application

- **Live parameters:** Render radius, FPS limit (already live in current UI). These do not require regeneration.
- **Generation parameters:** All 6 sections above. Changes are batched and applied via a prominent **"Apply & Regenerate"** button at the bottom of the panel. This triggers `world.dispose()` and creates a new `World` with the updated config.

## Presets

- **Dropdown** at the top of the panel, below the title bar.
- **Built-in presets** (not editable, not deletable):
  - **Default** — all parameters at their default values
  - **Flat Plains** — low octaves, low height multiplier, no warp, erosion off
  - **Extreme Mountains** — high octaves, high persistence, large height multiplier, strong warp
  - **Island Archipelago** — low continent scale, low ocean threshold
  - **Cave Heavy** — low cave threshold, deep surface erosion
- **User presets:** Save button prompts for a name, stores the full parameter set in localStorage. Delete button removes the currently selected user preset.
- Loading a preset populates all sliders but does not auto-apply — the user still hits "Apply & Regenerate".

## Reset

- **Per-section reset:** Small reset icon (↺) in each section header. Resets only that section's sliders to defaults.
- **Global "Reset All":** Button in the title bar. Resets all sections to defaults.
- Neither triggers regeneration — the user still hits Apply.

## Data Flow

Currently, `WorldConfig` only carries `seed`, `waterLevel`, `baseHeight`, `enableErosion`, and `erosionDroplets`. The new design extends this:

1. Define a `GenerationParams` interface containing all 33 parameters grouped by section.
2. `WorldConfig` gains a `params: GenerationParams` field.
3. The params object is passed through to the worker via `WorkerRequest`.
4. `generateChunk` reads all values from `config.params` instead of hardcoded constants.
5. `createBiomeSampler` accepts the biome-related params instead of using hardcoded scales/thresholds.
6. The `erode()` function already accepts `ErosionConfig` — just pass the full config through.

## UI Integration

- The panel is a single new TypeScript module: `src/debugPanel.ts`.
- It creates its DOM programmatically (no changes to `index.html` structure beyond a toggle button in the toolbar).
- `main.ts` imports and initializes the panel, wiring the "Apply" callback to the regeneration flow.
- The existing toolbar controls for erosion toggle and droplet count are removed — they move into the panel.
- The existing seed, render radius, FPS limit, debug toggle, and mode button remain in the toolbar.

## Keyboard Shortcut

- `P` toggles the panel open/closed (when seed input is not focused).

## Styling

- Matches the existing dark theme: `#16213e` backgrounds, `#e94560` accents, `#e0e0e0` text.
- Sliders use the same `input[type="range"]` styling as the toolbar.
- Panel has a subtle box-shadow for depth over the viewport.
