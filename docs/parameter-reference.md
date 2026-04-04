# World Generation Parameter Reference

Quick reference for all tunable parameters in the debug panel. Each entry explains what the parameter controls and what happens when you increase or decrease it.

---

## Terrain Noise

These control the primary terrain shape — the hills, valleys, and overall landform.

| Parameter | Default | Effect |
|-----------|---------|--------|
| **Scale** | 80 | How "zoomed in" the noise is. **Higher** = broader, smoother hills with gentle slopes. **Lower** = tighter, more frequent hills packed closer together. Think of it as the wavelength of the terrain. |
| **Octaves** | 5 | Number of noise layers stacked together. **Higher** = more fine detail on top of the large shapes (craggy surfaces, small bumps). **Lower** = smoother, blobby terrain with no fine detail. Each octave adds progressively smaller features. |
| **Persistence** | 0.5 | How much each successive octave contributes relative to the previous one. **Higher** (toward 1.0) = small details are as strong as large features, creating rough/noisy terrain. **Lower** (toward 0) = small details fade out, terrain stays smooth. |
| **Lacunarity** | 2.0 | Frequency multiplier between octaves. **Higher** = each octave's detail is much finer than the last (sharp detail jumps). **Lower** (toward 1.0) = octaves are similar in scale, producing muddier detail. 2.0 is the standard doubling. |
| **Warp Strength** | 3.0 | How much domain warping distorts the terrain. **Higher** = dramatic swirling cliff formations, overhangs, alien-looking landscapes. **Lower** (0) = no warping, standard fBm terrain. This is the "Inigo Quilez" technique — it feeds noise back into itself to distort coordinates. |
| **Warp Iterations** | 1 | How many times the warp is applied recursively. **0** = no warping at all. **1** = single warp pass (organic cliffs). **2+** = increasingly chaotic, surreal terrain with deep folds. Each iteration amplifies the distortion. |
| **Height Multiplier** | 20 | Vertical scale factor. **Higher** = taller mountains, deeper valleys, more dramatic elevation changes. **Lower** = flatter world, subtle height variation. This is multiplied by the biome's heightScale, so mountains get this effect amplified further. |

---

## Erosion

Simulates water droplets flowing downhill, carving channels and depositing sediment. Creates realistic drainage patterns and smooths sharp edges.

| Parameter | Default | Effect |
|-----------|---------|--------|
| **Enabled** | On | Master toggle. Off = raw noise terrain with no hydraulic erosion. On = droplets carve and smooth the terrain. |
| **Droplets** | 250 | Number of water particles simulated per chunk. **Higher** = smoother, more eroded terrain with visible channels and valleys. **Lower** = subtle erosion, terrain stays closer to raw noise. Very high values (3000+) are slow but produce dramatically sculpted landscapes. |
| **Erosion Rate** | 0.3 | How aggressively each droplet carves into terrain on steep slopes. **Higher** = deep cuts, pronounced valleys and gorges. **Lower** = gentle smoothing, less material removed. |
| **Deposition Rate** | 0.3 | How quickly sediment settles when droplets slow down (flat areas, depressions). **Higher** = sediment piles up fast, filling valleys and creating alluvial fans. **Lower** = sediment stays suspended longer, spreads more evenly. |
| **Inertia** | 0.3 | How much a droplet's previous direction influences its next step (0–1). **Higher** = droplets flow in straighter lines, carving longer channels. **Lower** = droplets follow the gradient more tightly, creating tighter meandering paths. |
| **Max Lifetime** | 48 | Maximum steps each droplet simulates. **Higher** = droplets travel further, creating longer erosion channels that span more terrain. **Lower** = short-lived droplets, erosion concentrated near spawn points. |
| **Evaporation Rate** | 0.02 | Water loss per step. **Higher** = droplets die faster (similar effect to reducing lifetime but more gradual). **Lower** = droplets persist longer, carrying sediment further downhill. |
| **Gravity** | 10 | How much slope accelerates droplets. **Higher** = droplets rush down steep slopes, eroding aggressively on cliffs but depositing quickly on flats. **Lower** = more uniform speed, more even erosion regardless of slope. |

---

## Caves

Controls the underground cave network and surface cave openings.

| Parameter | Default | Effect |
|-----------|---------|--------|
| **Scale** | 30 | Size of cave features. **Higher** = wider, more spacious cave chambers and tunnels. **Lower** = tighter, more claustrophobic cave networks with narrow passages. |
| **Octaves** | 3 | Detail layers in cave noise. **Higher** = more irregular cave walls with nooks and side passages. **Lower** = smoother, more tubular caves. |
| **Threshold** | 0.45 | The noise value above which solid rock is carved into air. **Lower** = more caves (more of the noise field exceeds the threshold). **Higher** = fewer, sparser caves. At 0.2 the underground is mostly hollow; at 0.7 caves are extremely rare. |
| **Surface Erosion Scale** | 16 | Size of the surface-breach noise field. **Higher** = larger cave openings at the surface. **Lower** = smaller, more scattered surface holes. |
| **Surface Erosion Threshold** | 0.38 | How easily caves breach the surface. **Lower** = more surface openings (craters, exposed caverns). **Higher** = surface stays mostly intact, caves stay underground. |
| **Surface Erosion Depth** | 8 | How deep below the surface the breach effect reaches. **Higher** = deeper surface erosion creating cliff faces and overhangs. **Lower** = only the very top layer gets carved, creating shallow pockmarks. |

---

## Rivers

Rivers are carved using Voronoi noise — channels form along the boundaries between Voronoi cells, creating natural-looking branching river networks.

| Parameter | Default | Effect |
|-----------|---------|--------|
| **Voronoi Scale** | 200 | Spacing between river channels. **Higher** = rivers are far apart, large landmasses between them. **Lower** = dense river network, many channels close together (like a delta or swamp). |
| **Edge Threshold** | 0.08 | Width of the river channels. **Higher** = wider rivers and floodplains. **Lower** = narrow streams, razor-thin channels. This controls how far from the Voronoi cell boundary the carving extends. |
| **Max Carve Depth** | 6 | How deep rivers cut into terrain. **Higher** = deep river gorges and canyons. **Lower** = shallow streams that barely indent the surface. Rivers always carve down toward water level. |

---

## Biomes

Controls how the world is divided into climate zones (desert, forest, tundra, etc.) using temperature, humidity, and continent noise fields.

| Parameter | Default | Effect |
|-----------|---------|--------|
| **Temp/Humidity Scale** | 300 | How gradually temperature and humidity change across the map. **Higher** = massive biome regions spanning hundreds of blocks, slow transitions. **Lower** = small, fragmented biomes that change rapidly as you walk. |
| **Continent Scale** | 500 | Size of continental landmasses (Voronoi-based). **Higher** = huge continents with vast interiors far from ocean. **Lower** = smaller islands, more coastline, archipelago-style worlds. |
| **Ocean Threshold** | -0.30 | Continental noise value below which terrain becomes ocean. **Higher** (toward 0) = more ocean, smaller landmasses. **Lower** (toward -0.6) = less ocean, more land. |
| **Beach Threshold** | -0.15 | Continental noise value below which coastal terrain becomes beach. **Higher** = wider beach strips along coastlines. **Lower** = narrower beaches, sharper land-to-ocean transitions. Must be above Ocean Threshold. |
| **Mountain Threshold** | 0.45 | Continental noise value above which terrain becomes mountainous. **Lower** = mountains appear more frequently, even near coasts. **Higher** = mountains only in deep continental interiors, rarer overall. |

---

## Ores

Controls underground resource placement. Ores are placed using 3D noise — clusters form where noise exceeds a threshold at sufficient depth.

| Parameter | Default | Effect |
|-----------|---------|--------|
| **Scale** | 6 | Size of ore clusters. **Higher** = larger, sparser ore veins. **Lower** = tiny, frequent ore specks scattered densely. |
| **Iron Threshold** | 0.55 | Noise value required for iron to appear. **Lower** = more iron ore throughout the world. **Higher** = rarer iron, only in the strongest noise peaks. |
| **Iron Min Depth** | 15 | Minimum depth below surface for iron to spawn. **Higher** = iron only deep underground. **Lower** = iron appears closer to the surface. |
| **Coal Threshold** | 0.50 | Noise value required for coal. **Lower** = abundant coal. **Higher** = scarce coal. Coal appears at shallower depths than iron (depth > 8, which is hardcoded). |

---

## Tips for Experimentation

- **Flat world for testing structures:** Set terrain scale=200, octaves=1, heightMultiplier=3, erosion off
- **Dramatic cliffs:** Increase warpStrength to 6-8 and warpIterations to 2
- **Swiss cheese underground:** Lower cave threshold to 0.30
- **Wide rivers:** Increase edge threshold to 0.15 and max carve depth to 12
- **Tiny islands:** Set continent scale to 200, ocean threshold to -0.10
- **Heavily eroded badlands:** Set droplets to 4000, erosion rate to 0.6, gravity to 20
