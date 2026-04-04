# Biome-Based Grass Color Variants

**Project**: 07-advanced-terrain
**Date**: 2026-04-04

## Goal

Replace the single flat grass color with per-biome grass colors derived from a programmatic temperature/humidity gradient. Grass color transitions smoothly at biome edges over ~5-9 blocks.

## Design

### 1. Grass Color Gradient Function

A pure function `grassColorFromClimate(temperature: number, humidity: number): [number, number, number]` maps the 2D climate space to an RGB color via bilinear interpolation between four corner colors:

| Corner     | Climate         | Color Target                  |
|------------|-----------------|-------------------------------|
| Hot+Dry    | temp high, humid low  | Sandy yellow-brown       |
| Hot+Wet    | temp high, humid high | Bright warm green        |
| Cold+Dry   | temp low, humid low   | Muted grey-green         |
| Cold+Wet   | temp low, humid high  | Dark teal/turquoise green|

- **X axis (humidity)**: low → dry brown, high → vivid green
- **Y axis (temperature)**: high → warm/bright yellow-green shift, low → cool turquoise shift

Each biome's grass color is computed once by evaluating this function at the biome's representative (temperature, humidity) midpoint, derived from the thresholds in `biomeFromNoise`. Colors are cached per biome at initialization.

### 2. Per-Column Color Blending at Biome Edges

Extend `computeBlendedBiomeParams` to also output a blended grass color per column (`grassColors: Uint32Array`, packed RGB).

Instead of picking the dominant biome's grass color, weighted-average the grass colors of all biomes in the existing kernel, using `biomeCounts[]` as weights. This produces:

- Deep inside a biome: 100% that biome's color (all kernel cells match)
- At a biome edge: smooth gradient over the kernel diameter

The transition width is controlled by the existing `BLEND_RADIUS` (currently 4, yielding a 9x9 kernel ~9 block transition). No new parameter is needed.

Non-grass biomes (Desert, Ocean, Tundra, Mountains) contribute to the average but it has no visual effect since those columns won't have Grass blocks.

### 3. Data Flow Through the Worker Pipeline

`generateChunk` currently returns `ChunkData` (`Uint8Array` of block IDs). It will additionally return `grassColors: Uint32Array` (one packed RGB per column, `CHUNK_SIZE * CHUNK_SIZE` entries).

The worker posts both arrays to the main thread. The `World` class stores `grassColors` alongside chunk block data. `buildChunkMesh` receives the `grassColors` array as an additional parameter.

### 4. Mesher Changes

**Color lookup**: When the mesher encounters a `Block.Grass` face, it reads the column's color from `grassColors[z * CHUNK_SIZE + x]` instead of `BLOCK_DEFS[Block.Grass].color`. All other blocks continue using `BLOCK_DEFS`.

**Greedy merge constraint**: During width/height expansion, if the candidate face is Grass and its column's grass color differs from the starting face's color, expansion stops. This prevents merging grass faces with different tints.

Impact on performance: within a biome interior all columns share the same color, so merging works as before. At edges, the ~9-column transition zone produces per-column quads — a small fraction of total faces.

### 5. DeadGrass Consolidation

`Block.DeadGrass` is removed. Savanna's `surfaceBlock` changes from `Block.DeadGrass` to `Block.Grass`. Its warm+dry climate position naturally produces a brownish grass color through the gradient function.

This gives Savanna-to-Plains transitions the same smooth color blending as any other grass biome boundary.

## Files Modified

| File | Change |
|------|--------|
| `src/blocks.ts` | Remove `DeadGrass` block, re-number subsequent IDs |
| `src/biomes.ts` | Add `grassColorFromClimate`, per-biome color cache, extend `computeBlendedBiomeParams` to output `grassColors` |
| `src/chunk.ts` | Return `grassColors` alongside `ChunkData` from `generateChunk` |
| `src/mesher.ts` | Accept `grassColors`, use for Grass blocks, add color check to greedy merge |
| `src/worker.ts` | Pass `grassColors` through worker message |
| `src/world.ts` | Store and forward `grassColors` to mesher |
