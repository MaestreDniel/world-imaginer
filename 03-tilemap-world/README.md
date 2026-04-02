# 03 - Tilemap World

An infinite, chunk-based 2D world generator — the Terraria/Minecraft approach. Builds on projects 01 and 02 by introducing chunk-based loading, ore generation, tree placement, and a world manager with LRU caching.

## Concepts covered

### Chunk-based generation
The world is divided into vertical slices called **chunks**, each 32 tiles wide and 256 tiles tall. Chunks are generated **on demand** as the camera moves — scroll left or right forever and new terrain keeps appearing.

This works because noise is deterministic: the same seed + coordinates always produce the same output. Chunks can be generated in any order, independently. This is exactly how Minecraft works.

### World manager with LRU cache
The `World` class tracks loaded chunks in a `Map<number, Chunk>`. When the cache exceeds 64 chunks, the least recently accessed ones are evicted. This keeps memory bounded even in an infinite world.

### Ore generation
A separate noise field identifies pockets of ore inside stone layers:
- **Coal** appears at medium depth (depth > 8)
- **Iron** appears deeper (depth > 15)

The ore noise uses a smaller scale (8 vs 25 for caves) to create tight clusters rather than large veins.

### Tree placement
Trees are placed on grass tiles using noise-driven selection (~15% of eligible columns). Each tree has:
- A **trunk** of variable height (4-7 blocks of wood)
- A **diamond-shaped canopy** of leaves

Using noise instead of `Math.random()` ensures trees appear in the same positions every time for a given seed.

### Block interactions on hover
Hovering over any tile shows its block type and world coordinates as a tooltip — useful for understanding the generation.

## Controls

| Control | Effect |
|---------|--------|
| **Seed** | World identifier |
| **Zoom** | Tile size (1-16 px) |
| **Mouse drag** | Pan the camera |
| **Scroll wheel** | Zoom in/out |
| **WASD / Arrows** | Pan with keyboard |
| **Hover** | Shows block name and coordinates |

The HUD shows your current world position and how many chunks are loaded.

## Running

```bash
npm install
npm run dev
```

## Key takeaways

- Chunk-based loading makes infinite worlds possible with finite memory.
- Deterministic noise means chunks can be generated independently and in any order.
- Multiple noise fields (surface, caves, ores, trees) layer different features without interfering.
- LRU eviction keeps memory bounded — old chunks are discarded and regenerated on demand.
- This architecture (chunk manager + lazy generation + LRU cache) is the foundation used by Minecraft, Terraria, and most open-world voxel games.
