/**
 * Seeded Perlin noise — 2D and 3D variants. Same as project 04.
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

  /**
   * Voronoi / Worley noise — 2D.
   *
   * Divides the plane into a grid of cells. Each cell contains one
   * pseudo-random feature point (jittered from cell center using the
   * seeded permutation table). Returns the distance to the Nth closest
   * feature point (n=0 → closest, n=1 → second closest).
   *
   * Common uses:
   * - F1 (n=0): rounded cell shapes — continent blobs, biome territories
   * - F2-F1 (difference): Voronoi edges — river networks, cracks
   */
  function voronoi2D(x: number, y: number): { f1: number; f2: number; cellX: number; cellY: number } {
    const xi = Math.floor(x);
    const yi = Math.floor(y);

    let f1 = 1e10;
    let f2 = 1e10;
    let nearestCellX = 0;
    let nearestCellY = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;

        // Deterministic jitter from permutation table
        const h = p[((cx & 255) + p[(cy & 255)]) & 511];
        const jx = (h & 15) / 15.0;        // 0..1
        const jy = ((h >> 4) & 15) / 15.0; // 0..1

        const fx = cx + jx;
        const fy = cy + jy;

        const distSq = (x - fx) * (x - fx) + (y - fy) * (y - fy);

        if (distSq < f1) {
          f2 = f1;
          f1 = distSq;
          nearestCellX = cx;
          nearestCellY = cy;
        } else if (distSq < f2) {
          f2 = distSq;
        }
      }
    }

    return {
      f1: Math.sqrt(f1),
      f2: Math.sqrt(f2),
      cellX: nearestCellX,
      cellY: nearestCellY,
    };
  }

  return { perlin2D, perlin3D, fbm2D, fbm3D, voronoi2D };
}
