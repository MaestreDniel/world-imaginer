# 08 — Spline-based terrain shaping

Climate-driven, anchor-blended spline pipeline for column heights.

Column height is produced by three climate noise fields
(continentalness, erosion, peaks & valleys) fed into a nested pair of
anchor-blended splines:

```
continentalness  ─► continent spline           ─► baseHeight
erosion          ─► erosion spline per cont.   ─► erosionAdjust
peaksValleys     ─► pv spline per erosion      ─► pvAdjust

finalHeight = clamp(baseHeight + erosionAdjust + pvAdjust,
                    minHeight, maxHeight)
```

Biomes are picked from climate values plus the resulting height:
Ocean / Beach / Mountains come from continentalness and erosion
thresholds; Desert / Tundra / Plains / Forest / Swamp / Savanna come
from the existing (temperature, humidity) matrix.

Spline tables, climate noise knobs, and the world Y-extent are all
editable at runtime from the debug panel.

See `docs/superpowers/specs/2026-04-19-spline-terrain-shaping-design.md`
for the full design.

## Running

```bash
npm install
npm run dev
```

Or via Docker: `docker compose up spline-terrain` (port 5181).
