# 06 - Biome Blending

Smooth terrain transitions at biome boundaries. Project 05 introduced biomes with different height parameters, but adjacent biomes with very different `heightScale` or `heightOffset` values created vertical cliff walls. This project solves that with a box-filter averaging approach over a 9x9 kernel.

## Concepts covered

### The cliff wall problem

Each column's height is computed as:

```
height = baseHeight + heightOffset + noise * 20 * heightScale
```

When two adjacent columns belong to different biomes — say Mountains (`heightScale=2.0`, `heightOffset=+10`) next to Plains (`heightScale=0.5`, `heightOffset=0`) — the height can jump by 30+ blocks in a single column. Since there's no interpolation, the result is a sheer vertical wall.

### Biome blending via box-filter averaging

The fix: instead of using a single biome's parameters per column, sample biomes in a radius around the column and average their height parameters.

**Algorithm:**

1. For each chunk, build a padded grid of biome IDs covering `(CHUNK_SIZE + 2*R) x (CHUNK_SIZE + 2*R)`, where `R=4` (the blend radius).
2. For each column, sweep a 9x9 kernel (81 samples) over the padded grid.
3. Average `heightScale` and `heightOffset` across all samples in the kernel.
4. Use the blended values in the height formula.

**What gets blended vs. what stays discrete:**

- **Blended:** `heightScale` and `heightOffset` — these control terrain shape and are interpolated for smooth slopes.
- **Discrete:** Surface block, sub-surface block, tree type, structure eligibility — these use the **dominant biome** (most frequent in the kernel) so block transitions remain visually clean.

### Performance

The padded grid is `40x40 = 1600` biome lookups per chunk (each involving 3 fBm calls). This is a ~56% increase over the original `32x32 = 1024` lookups, but:

- Chunk generation runs in Web Workers off the main thread
- The kernel averaging itself is just array reads — negligible cost
- Results are amortized: each padded cell is computed once, read up to 81 times

### Sea-level coordinate system

Water level and base height are both `0`. Y=0 is the ocean surface — a natural reference point:

- **Positive Y:** land, mountains (peaks reach ~+50)
- **Negative Y:** ocean floor, deep caves (down to ~-14)
- The debug overlay Y coordinate directly tells you how far above or below sea level you are

## Additional features

### Walk / Fly mode

The camera can operate in two modes, toggled with `F` or the toolbar button:

- **Fly mode** (default) — free-roaming orbital camera. Orbit with LMB, pan with RMB, scroll to zoom, WASD to translate.
- **Walk mode** — first-person human perspective. Click the canvas to capture the mouse (pointer lock). WASD to move, Space to jump, Esc to release the mouse.

Walk mode implements a full physics loop:
- **Gravity** — constant downward acceleration (~28 units/s²), zeroed when grounded.
- **AABB collision** — the player is a 0.6 × 1.8 axis-aligned bounding box. Each frame, X/Y/Z movement is resolved independently against the voxel grid so corners don't clip.
- **Landing snap** — on downward collision, feet are snapped to the exact top face of the blocking block to prevent floating.
- **Edge detection** — each frame checks if solid ground still exists 0.05 units below feet; if not, the player is marked airborne and gravity resumes immediately (no jump required to fall off ledges).

Block data for collision queries is transferred from Web Workers alongside the mesh buffers (zero-copy via `ArrayBuffer` transfer), so no extra generation pass is needed.

### Ambient audio

A shuffle-bag playlist of Minecraft ambient tracks plays with a short initial delay. Each track plays once through before the next is selected; the full list is exhausted before any track repeats.

## Running

```bash
cd 06-biome-blending
npm install
npm run dev        # http://localhost:5179
```

Or via Docker:

```bash
docker compose up biome-blending   # port 5179
```

## Tuning

### Blend radius

The `BLEND_RADIUS` constant in `biomes.ts` controls the transition zone width. The kernel is `(2*R+1)^2` samples.

| Radius | Kernel | Transition width | Performance impact |
|--------|--------|------------------|--------------------|
| 2 | 5x5 (25) | 4 blocks | Minimal — still some visible steps |
| 4 | 9x9 (81) | 8 blocks | Current default — smooth transitions |
| 8 | 17x17 (289) | 16 blocks | Very smooth — noticeable gen slowdown |

Higher radii produce smoother slopes but increase the padded grid size and kernel iterations.

### Height parameters per biome

These are the raw values before blending. The blended result at any column is an average weighted by surrounding biome distribution:

| Biome | heightScale | heightOffset | Notes |
|-------|------------|-------------|-------|
| Ocean | 0.3 | -8 | Flat, well below sea level |
| Beach | 0.2 | -2 | Very flat, near sea level |
| Desert | 0.5 | 0 | Moderate terrain |
| Savanna | 0.6 | 0 | Slightly rolling |
| Plains | 0.5 | 0 | Moderate, baseline |
| Forest | 0.7 | +2 | Slightly elevated |
| Birch Forest | 0.6 | +1 | Between plains and forest |
| Taiga | 0.8 | +3 | Elevated, hilly |
| Tundra | 0.4 | 0 | Flat cold terrain |
| Mountains | 2.0 | +10 | Tall, dramatic terrain |
