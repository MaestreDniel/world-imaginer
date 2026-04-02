# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Research repository for procedural terrain generation (Minecraft/Terraria-inspired). Each numbered subfolder is an independent Vite+TypeScript project — there is no monorepo tooling or shared dependencies between them.

## Commands

Every project uses the same scripts. Run from inside the project directory (e.g. `cd 02-2d-terrain`):

```bash
npm install        # install dependencies
npm run dev        # start Vite dev server
npm run build      # tsc && vite build
```

There are no tests, linters, or formatters configured.

### Docker

All projects can run via `docker-compose.yml` at the repo root. They join the external `maestre-web_app-network` network.

```bash
docker compose up noise-fundamentals   # port 5174
docker compose up 2d-terrain           # port 5175
```

## Architecture

### Noise layer (each project's `src/perlin.ts`)

The core building block across all projects. Two variants exist:

- **01**: Static permutation table, exports bare `perlin2D` and `fbm` functions.
- **02+**: `createNoise(seed)` factory that returns `{ perlin2D, fbm }` with a seeded (Fisher-Yates + LCG) permutation table, enabling reproducible worlds.

When adding a new project, copy the seeded version from `02-2d-terrain/src/perlin.ts`.

### Rendering pattern

Projects render to a `<canvas>` via `ImageData` pixel manipulation (not `fillRect` calls). Project 02 introduces a `Camera` abstraction for pan/zoom over worlds larger than the viewport.

### Terrain generation pipeline (project 02)

`generateTerrain(config)` returns a `Uint8Array[]` grid (row-major, indexed `grid[y][x]`). The pipeline runs in five sequential passes:

1. **Surface profile** — 1D fBm along X axis
2. **Material layers** — depth-based block assignment with noise-perturbed boundaries
3. **Cave carving** — 2D noise thresholding + entrance shaft pass
4. **Surface decoration** — grass/sand/snow based on elevation and water proximity
5. **Water fill** — BFS flood-fill from sky, fills at/below water level

Block types are a `const enum` (`Block`), so they compile to plain integers.

## Conventions

- TypeScript strict mode, ES2020 target, bundler module resolution.
- No external runtime dependencies — only `vite` and `typescript` as dev deps.
- Canvas-based rendering; no frameworks or UI libraries.
- New projects follow the `NN-project-name` naming pattern and get their own entry in `docker-compose.yml` with a unique port (5174 + N).
