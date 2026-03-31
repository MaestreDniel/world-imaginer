import { fbm } from "./perlin";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const width = canvas.width;
const height = canvas.height;

// UI elements
const scaleSlider = document.getElementById("scale") as HTMLInputElement;
const octavesSlider = document.getElementById("octaves") as HTMLInputElement;
const persistenceSlider = document.getElementById("persistence") as HTMLInputElement;
const lacunaritySlider = document.getElementById("lacunarity") as HTMLInputElement;

const scaleVal = document.getElementById("scale-val")!;
const octavesVal = document.getElementById("octaves-val")!;
const persistenceVal = document.getElementById("persistence-val")!;
const lacunarityVal = document.getElementById("lacunarity-val")!;

function render() {
  const scale = Number(scaleSlider.value);
  const octaves = Number(octavesSlider.value);
  const persistence = Number(persistenceSlider.value) / 100;
  const lacunarity = Number(lacunaritySlider.value) / 10;

  // Update displayed values
  scaleVal.textContent = String(scale);
  octavesVal.textContent = String(octaves);
  persistenceVal.textContent = persistence.toFixed(2);
  lacunarityVal.textContent = lacunarity.toFixed(1);

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Convert pixel coords to noise space using the scale parameter
      const nx = x / scale;
      const ny = y / scale;

      // Get noise value in [-1, 1], map to [0, 255]
      const noise = fbm(nx, ny, octaves, persistence, lacunarity);
      const brightness = Math.floor((noise + 1) * 0.5 * 255);

      const i = (y * width + x) * 4;
      data[i] = brightness;     // R
      data[i + 1] = brightness; // G
      data[i + 2] = brightness; // B
      data[i + 3] = 255;        // A
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// Re-render when any slider changes
for (const slider of [scaleSlider, octavesSlider, persistenceSlider, lacunaritySlider]) {
  slider.addEventListener("input", render);
}

// Initial render
render();
