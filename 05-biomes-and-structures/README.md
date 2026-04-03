# 05 - Biomes & Structures

Layered noise fields for biome selection and procedural structure placement. The world is no longer uniform — deserts, forests, tundra, mountains, and oceans each have distinct terrain, blocks, and vegetation.

## Concepts covered

### Biome selection via noise fields
The core technique: two independent noise fields sampled at large scale (~300 blocks) create a 2D parameter space.

- **Temperature** — ranges from cold (-1) to hot (+1)
- **Humidity** — ranges from dry (-1) to wet (+1)
- **Continent** — a third field at even larger scale (~400 blocks) separates land from ocean

The (temperature, humidity) pair maps to a biome:

| | Dry | Moderate | Wet |
|---|---|---|---|
| **Hot** | Desert | Savanna | Savanna |
| **Temperate** | Plains | Birch Forest | Forest |
| **Cold** | Tundra | Tundra | Taiga |

Plus: Ocean (low continent), Beach (continent edge), Mountains (high continent).

### Biome-modulated terrain
Each biome defines:
- **heightScale** — how much the base noise amplitude is multiplied. Mountains = 2.0x, Ocean = 0.3x.
- **heightOffset** — vertical shift. Mountains sit higher, oceans lower.
- **surfaceBlock / subSurfaceBlock** — what the top layers are made of.

### Procedural structures

| Structure | Biomes | Shape |
|-----------|--------|-------|
| Oak trees | Plains, Forest, Savanna | Short trunk, round canopy |
| Birch trees | Birch Forest | Tall trunk, small canopy |
| Spruce trees | Taiga, Mountains, Tundra | Tall trunk, conical canopy |
| Cacti | Desert | 2-3 block column |
| Desert pyramids | Desert | Stepped sandstone, hollow interior |
| Igloos | Tundra | Snow brick dome with entrance |
| Village houses | Plains, Savanna | Cobblestone+planks, door and windows |

Tree density varies per biome: dense forests (15-18%) vs sparse savanna (2%). Placement uses noise so trees are deterministic — same seed, same forest.

### Biome-specific details
- **Ice** forms on water in Tundra and Taiga
- **Gravel patches** appear on ocean floor
- **Snow caps** on mountain peaks below base height
- **Red sand** as desert sub-surface layer

### Cave system
Caves are carved using 3D fBm noise. Two passes work together:
- **Deep caves** — 3D noise at scale 30 with threshold 0.45. Creates wide tunnel networks underground.
- **Surface erosion** — separate 3D noise at scale 16 with threshold 0.38-0.54 (gradient over top 8 blocks). Creates irregular openings where caves breach the surface.

## Tuning guide

All procedural generation in this project comes down to **noise parameters** and **thresholds**. Here's how to tweak them.

### Biome distribution

Biome boundaries are threshold comparisons against temperature and humidity noise in `biomes.ts:getBiome()`.

```
temp > 0.2   → hot biomes (desert/savanna)
temp > -0.15 → temperate biomes (plains/forest)
temp ≤ -0.15 → cold biomes (tundra/taiga)
```

**To make a biome more common**, widen its threshold range. For example, desert triggers when `temp > 0.2 && humid ≤ 0.15`. Lowering the temp threshold to `0.1` or raising the humid threshold to `0.25` both make deserts appear more.

**Noise scale** (`biomes.ts`, ~300-400 for temperature/humidity/continent) controls how large biome regions are. Lower scale = smaller, more fragmented biomes. Higher = vast continents of the same biome.

### Cave size and frequency

Caves are controlled by two values in `chunk.ts`:

| Parameter | Location | Effect |
|-----------|----------|--------|
| **Noise scale** | `caveNoise.fbm3D(wx / 30, wy / 30, wz / 30, ...)` | Divider controls tunnel width. Higher = wider tunnels. 20 = narrow, 30 = medium, 50 = huge caverns |
| **Threshold** | `caveVal > 0.45` | Higher = fewer caves. 0.35 = swiss cheese, 0.45 = moderate, 0.55 = rare |

The **surface cave opening** gradient in the same function controls how often caves reach the surface:
```
threshold = 0.42 + (depth - 2) * 0.005
```
At depth=2 (just below grass), threshold is 0.42 — lower means more surface openings.

### Surface erosion

The erosion pass (`chunk.ts`, erosion noise section) creates separate irregular pockets near the surface:

| Parameter | Current | Effect |
|-----------|---------|--------|
| Scale | `wx / 16` | Lower = rougher/smaller holes. Higher = smoother/larger |
| Base threshold | `0.38` | Lower = more erosion. Higher = less |
| Depth gradient | `+ dy * 0.02` | How quickly erosion fades with depth. Higher = surface-only |
| Max depth | `dy <= 8` | How deep the erosion pass reaches |

### Structure spawn rates

Structures are placed at chunk centers based on a per-chunk noise value (`chunk.ts`, structure section):

```
structVal > 0.2  → ~20% of eligible chunks
structVal > 0.3  → ~15%
structVal > 0.4  → ~10%
structVal > 0.5  → ~5%
```

The noise value is sampled once per chunk using `structNoise.perlin2D(chunkX * 1.17, chunkZ * 1.17)`. The `1.17` multiplier prevents alignment with chunk grid — changing it shifts which chunks get structures.

### Terrain shape per biome

Each biome definition in `biomes.ts` has:

| Field | Effect | Example |
|-------|--------|---------|
| `heightScale` | Multiplier on terrain amplitude | 0.3 (flat ocean) → 2.0 (mountains) |
| `heightOffset` | Vertical shift from base height | -8 (ocean below water) → +10 (mountains above) |
| `treeDensity` | Fraction of eligible columns that get trees | 0.02 (sparse) → 0.18 (dense forest) |

### General noise tuning principles

1. **Scale** (the divider in `noise(x / scale)`) controls feature size. It's the most impactful parameter.
2. **Threshold** controls density/frequency. Small changes (±0.05) have big effects.
3. **Octaves** add detail layers. 3 = smooth blobs, 5 = rough detail. More octaves = slower.
4. **Persistence** controls how much each octave contributes. 0.3 = smooth, 0.5 = moderate, 0.7 = noisy.
5. Always test with multiple seeds — a single seed can be misleading about frequency.

## Running

```bash
npm install
npm run dev
```

Explore by orbiting the camera — you'll cross through biome boundaries and see terrain change from desert to forest to tundra. Try different seeds for different biome layouts.

## Key takeaways

- Multiple noise fields at different scales create rich, varied worlds.
- Biomes are a mapping function: noise parameters → terrain rules.
- Each biome is a self-contained recipe (blocks, height, vegetation).
- Structure placement is just a final decoration pass using noise for positioning.
- Tuning procedural generation is mostly about adjusting **scale** and **threshold** — small changes cascade into very different worlds.
- This is fundamentally how Minecraft's biome system works — temperature + humidity → biome lookup.
