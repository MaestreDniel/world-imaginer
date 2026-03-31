/**
 * Classic Perlin noise implementation in 2D.
 *
 * Based on Ken Perlin's improved noise (2002).
 * Reference: https://mrl.cs.nyu.edu/~perlin/noise/
 *
 * How it works:
 * 1. For each point, find the unit grid cell that contains it.
 * 2. For each corner of that cell, compute a pseudo-random gradient vector.
 * 3. Compute the dot product between the gradient and the distance vector
 *    from the corner to the point.
 * 4. Interpolate between the dot products using a fade (smoothstep) curve
 *    so the result is smooth and continuous.
 *
 * The output is a value roughly in the range [-1, 1].
 */

// Permutation table — a shuffled array of 0-255, doubled to avoid wrapping.
const permutation = [
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
  140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
  247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,
  57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
  74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,
  60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
  65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
  200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
  52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,
  207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
  119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,
  129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
  218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,
  81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
  184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,
  222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
];

const p = new Uint8Array(512);
for (let i = 0; i < 512; i++) p[i] = permutation[i & 255];

/** Fade curve: 6t^5 - 15t^4 + 10t^3 — gives C2 continuity (smooth second derivative). */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/**
 * Compute gradient dot product.
 * Uses the hash to pick one of 4 gradient directions: (1,1), (-1,1), (1,-1), (-1,-1)
 * then dots it with (x, y).
 */
function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : -x;
  const v = h === 0 || h === 2 ? y : -y;
  return u + v;
}

/** Compute 2D Perlin noise at coordinates (x, y). Returns a value roughly in [-1, 1]. */
export function perlin2D(x: number, y: number): number {
  // Find the unit grid cell
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;

  // Relative position within the cell
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  // Fade curves for interpolation
  const u = fade(xf);
  const v = fade(yf);

  // Hash the 4 corners of the cell
  const aa = p[p[xi] + yi];
  const ab = p[p[xi] + yi + 1];
  const ba = p[p[xi + 1] + yi];
  const bb = p[p[xi + 1] + yi + 1];

  // Gradient dot products at each corner, then bilinear interpolation
  return lerp(
    lerp(grad(aa, xf, yf),     grad(ba, xf - 1, yf),     u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v,
  );
}

/**
 * Fractal Brownian Motion (fBm) — layers multiple octaves of noise.
 *
 * Each octave doubles the frequency (controlled by lacunarity) and reduces
 * the amplitude (controlled by persistence), adding finer detail on top of
 * the broad shape. This is how real terrain works: large mountains + small rocks.
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param octaves - Number of noise layers (more = more detail)
 * @param persistence - How much each octave's amplitude shrinks (0-1)
 * @param lacunarity - How much each octave's frequency grows (typically 2.0)
 */
export function fbm(
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * perlin2D(x * frequency, y * frequency);
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  // Normalize to [-1, 1]
  return value / maxAmplitude;
}
