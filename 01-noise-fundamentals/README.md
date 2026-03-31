# 01 - Noise Fundamentals

The foundation of procedural terrain generation: noise functions.

## Concepts covered

### Perlin Noise
Perlin noise is a gradient noise function invented by Ken Perlin in 1983. Unlike pure random noise (which looks like TV static), Perlin noise is **coherent** — nearby points have similar values, creating smooth, natural-looking patterns.

The algorithm works in four steps:
1. **Grid**: Divide space into a regular grid of unit cells.
2. **Gradients**: Assign a pseudo-random gradient vector to each grid corner (using a permutation table for repeatability).
3. **Dot products**: For any point, compute the dot product between each corner's gradient and the vector from that corner to the point.
4. **Interpolation**: Blend the dot products using a smooth fade curve (`6t⁵ - 15t⁴ + 10t³`) to get the final value.

### Fractal Brownian Motion (fBm)
A single layer of Perlin noise produces smooth blobs. Real terrain has detail at every scale — mountains *and* rocks. fBm achieves this by layering multiple **octaves** of noise:

- Each octave has higher **frequency** (more detail) and lower **amplitude** (less influence).
- **Persistence** controls how quickly amplitude drops (lower = smoother).
- **Lacunarity** controls how quickly frequency grows (typically 2.0).

The result is a rich, multi-scale texture that resembles natural heightmaps.

### Parameters to explore
| Parameter | Effect |
|-----------|--------|
| **Scale** | Zoom level — larger values = bigger features |
| **Octaves** | Number of noise layers — more = finer detail |
| **Persistence** | Amplitude falloff per octave — lower = smoother |
| **Lacunarity** | Frequency multiplier per octave — higher = more detail separation |

## Running

```bash
npm install
npm run dev
```

Open the browser and use the sliders to see how each parameter affects the noise.

## Key takeaways

- Perlin noise provides the smooth, coherent randomness needed for terrain.
- fBm layers noise at different scales to create complexity from simplicity.
- These same parameters (scale, octaves, persistence, lacunarity) will appear in every terrain generation project going forward.
