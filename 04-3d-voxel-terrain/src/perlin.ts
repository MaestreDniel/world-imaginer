/**
 * Seeded Perlin noise — 2D and 3D variants.
 *
 * Same 2D implementation as previous projects, plus a 3D extension
 * needed for underground cave carving in three dimensions.
 */

function createPermutation(seed: number): Uint8Array {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;

  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };

  for (let i = 255; i > 0; i--) {
    const j = next() % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  return p;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad2D(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : -x;
  const v = h === 0 || h === 2 ? y : -y;
  return u + v;
}

/**
 * 3D gradient — uses 12 gradient directions (edges of a cube).
 */
function grad3D(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function createNoise(seed: number) {
  const p = createPermutation(seed);

  function perlin2D(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = p[p[xi] + yi];
    const ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi];
    const bb = p[p[xi + 1] + yi + 1];
    return lerp(
      lerp(grad2D(aa, xf, yf), grad2D(ba, xf - 1, yf), u),
      lerp(grad2D(ab, xf, yf - 1), grad2D(bb, xf - 1, yf - 1), u),
      v,
    );
  }

  function perlin3D(x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const aaa = p[p[p[xi] + yi] + zi];
    const aab = p[p[p[xi] + yi] + zi + 1];
    const aba = p[p[p[xi] + yi + 1] + zi];
    const abb = p[p[p[xi] + yi + 1] + zi + 1];
    const baa = p[p[p[xi + 1] + yi] + zi];
    const bab = p[p[p[xi + 1] + yi] + zi + 1];
    const bba = p[p[p[xi + 1] + yi + 1] + zi];
    const bbb = p[p[p[xi + 1] + yi + 1] + zi + 1];

    return lerp(
      lerp(
        lerp(grad3D(aaa, xf, yf, zf), grad3D(baa, xf - 1, yf, zf), u),
        lerp(grad3D(aba, xf, yf - 1, zf), grad3D(bba, xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(grad3D(aab, xf, yf, zf - 1), grad3D(bab, xf - 1, yf, zf - 1), u),
        lerp(grad3D(abb, xf, yf - 1, zf - 1), grad3D(bbb, xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  }

  function fbm2D(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * perlin2D(x * frequency, y * frequency);
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / maxAmp;
  }

  function fbm3D(x: number, y: number, z: number, octaves: number, persistence: number, lacunarity: number): number {
    let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * perlin3D(x * frequency, y * frequency, z * frequency);
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / maxAmp;
  }

  return { perlin2D, perlin3D, fbm2D, fbm3D };
}
