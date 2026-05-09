# 09 — Density Terrain

Prototype: replace 08's heightmap pipeline with a 3D density field. Splines drive `(offset, factor, jaggedness)` 2D fields; density is sampled on a coarse cell grid and trilerped per voxel. Caves, cliffs, and overhangs all emerge from the single density field.

See `docs/superpowers/specs/2026-05-10-09-density-terrain-design.md` for the design.

Port: 5182.

## Running

```bash
npm install
npm run dev
```

Or via Docker: `docker compose up spline-terrain` (port 5181).
