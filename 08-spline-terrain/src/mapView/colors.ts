import { Biome, type BiomeId } from "../biomes";

/**
 * Per-biome base color at sea level. Tweak to taste; not exposed
 * to the debug panel in the current spec.
 */
const BIOME_COLOR: Record<BiomeId, number> = {
  [Biome.Ocean]:          0x1E5A8A,
  [Biome.FrozenOcean]:    0x9CC4D6,
  [Biome.Beach]:          0xE8D8A0,
  [Biome.Desert]:         0xE6C77A,
  [Biome.Savanna]:        0xB6BC4D,
  [Biome.Plains]:         0x8FBE5A,
  [Biome.Forest]:         0x3F7B3A,
  [Biome.BirchForest]:    0x6FA055,
  [Biome.Taiga]:          0x4F7A6E,
  [Biome.Tundra]:         0xCBD9D8,
  [Biome.Mountains]:      0x8B7E70,
  [Biome.StonyPeaks]:     0xB0A89E,
  [Biome.WindsweptHills]: 0x6E8C5E,
};

/** Max water depth (in blocks) that produces additional darkening. */
const WATER_MAX_DEPTH = 30;
/** Darkening range for water: shallow → 0.3, deep → 0.8. */
const WATER_DARK_MIN  = 0.3;
const WATER_DARK_MAX  = 0.8;
/** Max land elevation (above water) that produces additional brightening. */
const LAND_MAX_HEIGHT = 60;
/** Brightening range for land: sea level → 0, peak → 0.4. */
const LAND_BRIGHT_MAX = 0.4;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Lerp a packed RGB color toward black by `t` (0..1). */
function darken(c: number, t: number): number {
  const r = ((c >> 16) & 0xff) * (1 - t);
  const g = ((c >>  8) & 0xff) * (1 - t);
  const b = ( c        & 0xff) * (1 - t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Lerp a packed RGB color toward white by `t` (0..1). */
function brighten(c: number, t: number): number {
  const r = ((c >> 16) & 0xff) + (255 - ((c >> 16) & 0xff)) * t;
  const g = ((c >>  8) & 0xff) + (255 - ((c >>  8) & 0xff)) * t;
  const b = ( c        & 0xff) + (255 - ( c        & 0xff)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * Final pixel color for a (biome, height) sample.
 * - Below or at waterLevel: water — darker as it gets deeper.
 * - Above waterLevel: land — brighter as it climbs.
 */
export function mapColor(biome: BiomeId, height: number, waterLevel: number): number {
  const base = BIOME_COLOR[biome];
  if (height <= waterLevel) {
    const depth = clamp01((waterLevel - height) / WATER_MAX_DEPTH);
    return darken(base, WATER_DARK_MIN + (WATER_DARK_MAX - WATER_DARK_MIN) * depth);
  }
  const above = clamp01((height - waterLevel) / LAND_MAX_HEIGHT);
  return brighten(base, above * LAND_BRIGHT_MAX);
}
