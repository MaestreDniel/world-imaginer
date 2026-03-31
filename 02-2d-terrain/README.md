# 02 - 2D Terrain

Side-scrolling terrain generation inspired by Terraria. Builds on the noise fundamentals from project 01 to create a complete 2D world with layers, caves, biomes, and water.

## Concepts covered

### Seeded noise
The Perlin noise implementation now accepts a **seed** that shuffles the permutation table. This means the same coordinates produce different terrain for different seeds — essential for generating unique worlds.

### Surface profile generation
The ground surface is a 1D noise curve — we sample fBm along the X axis only. The result is a height value for each column, creating the hills and valleys of the landscape.

```
surface_height[x] = midpoint + fbm(x / scale, 0) * amplitude
```

- **Scale** controls how wide the hills are (higher = gentler).
- **Amplitude** controls how tall the hills are.

### Material layers
Below the surface, blocks are assigned by depth:

| Depth from surface | Material |
|---|---|
| 0 | Grass (surface decoration) |
| 1-5 | Dirt |
| 5-30 | Stone |
| 30+ | Deep Stone |

Layer boundaries are perturbed by low-frequency noise so they aren't perfectly horizontal — just like real geology.

### Cave generation
Caves use **2D noise thresholding**: sample noise at every underground tile, and if the value exceeds a threshold, carve it out. This creates organic tunnel networks.

- **Cave scale** controls tunnel width (higher = wider tunnels).
- **Cave threshold** controls density (higher = more caves).

This is the same technique Terraria uses for its cave systems.

### Surface decoration
A second pass over the terrain applies context-sensitive surface blocks:
- **Grass** on normal surface tiles
- **Sand** near the water level (beach formation)
- **Snow** on high peaks

### Water filling
Any air block below the water level becomes water, creating lakes on the surface and partially flooded caves underground.

## Controls

| Control | Effect |
|---------|--------|
| **Seed** | Unique world identifier |
| **Surface scale** | Hill width |
| **Amplitude** | Hill height variation |
| **Cave scale** | Tunnel width |
| **Cave density** | How many caves |
| **Water level** | Sea level position |
| **Zoom** | Tile size in pixels |
| **Mouse drag** | Pan the camera |
| **Scroll wheel** | Zoom in/out |

## Running

```bash
npm install
npm run dev
```

## Key takeaways

- 1D noise profiles create convincing terrain surfaces.
- Depth-based layering with noise perturbation mimics geological strata.
- 2D noise thresholding is a simple but effective cave generation technique.
- Seeds make worlds reproducible — same seed, same world.
- These techniques stack: surface + layers + caves + water = a Terraria-like world from just noise functions.
