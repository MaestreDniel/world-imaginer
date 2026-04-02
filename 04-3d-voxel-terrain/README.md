# 04 - 3D Voxel Terrain

The jump to 3D — a Minecraft-style voxel world rendered with Three.js. Extends every concept from the 2D projects into three dimensions: 3D Perlin noise, cubic chunks, greedy meshing, and dynamic chunk loading.

## Concepts covered

### 3D Perlin noise
Project 01's 2D Perlin noise is extended to 3D by adding a Z axis to the grid lookup and using 12 gradient directions (cube edges) instead of 4. This is critical for 3D caves — they need to twist and turn through all three axes.

### Cubic chunks
Instead of 2D vertical slices, chunks are now 32x32x32 cubes. The world is infinite along X and Z, with multiple chunk layers stacking vertically. Each chunk generates independently using the same deterministic noise approach.

### Terrain generation pipeline (3D)
1. **Heightmap** — 2D fBm defines surface height at each (x, z). Same as project 02/03 but now it's the Y coordinate where ground starts.
2. **Material layers** — Depth below surface determines block type (grass → dirt → stone → deep stone).
3. **3D caves** — 3D fBm thresholding carves tunnels that wind through all three axes.
4. **Ore pockets** — 3D noise at small scale creates clusters of coal and iron.
5. **Surface details** — Sand near water, snow on peaks.

### Greedy meshing
The key optimisation that makes voxel rendering practical:

1. **Face culling** — Only render faces between solid and transparent blocks. Interior faces are invisible and discarded.
2. **Greedy merging** — Adjacent coplanar faces of the same block type are merged into larger rectangles. A flat 32x32 grass surface becomes a few quads instead of 1024.

This reduces vertex count by 80-95% compared to naive rendering.

### Dynamic chunk loading
The `World` class loads chunks within a configurable radius around the camera and unloads distant ones. Chunks are generated, then meshed with correct neighbor lookups for seamless boundaries.

### Directional shading
Each face direction gets a different brightness (top = full, sides = 70-80%, bottom = 50%). This simple trick adds depth without complex lighting calculations.

## Controls

| Control | Effect |
|---------|--------|
| **Left mouse** | Orbit camera |
| **Right mouse** | Pan camera |
| **Scroll wheel** | Zoom |
| **Render radius** | How many chunks to load (1-6) |
| **Seed** | World identifier |

## Running

```bash
npm install
npm run dev
```

## Key takeaways

- 3D Perlin noise enables volumetric features like caves that twist through all three axes.
- Greedy meshing is essential — naive voxel rendering is impossibly slow.
- Cubic chunks extend the 2D chunk system naturally — same lazy loading, same LRU pattern.
- The same noise layering approach (surface + caves + ores) works in 3D with minimal changes.
- Three.js + vertex colors + Lambert shading gives decent visuals with zero textures.
