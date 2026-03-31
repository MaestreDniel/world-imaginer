import { generateTerrain, DEFAULT_CONFIG, type TerrainConfig } from "./terrain";
import { renderTerrain, type Camera } from "./renderer";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// Resize canvas to fill viewport
function resizeCanvas() {
  canvas.width = window.innerWidth;
  const toolbar = document.querySelector('.toolbar') as HTMLElement;
  const legend = document.querySelector('.legend') as HTMLElement;
  canvas.height = window.innerHeight - toolbar.offsetHeight - legend.offsetHeight;
}
resizeCanvas();
window.addEventListener("resize", () => {
  resizeCanvas();
  render();
});

// UI bindings
const seedInput = document.getElementById("seed") as HTMLInputElement;
const surfaceScaleSlider = document.getElementById("surfaceScale") as HTMLInputElement;
const surfaceAmpSlider = document.getElementById("surfaceAmplitude") as HTMLInputElement;
const caveScaleSlider = document.getElementById("caveScale") as HTMLInputElement;
const caveThreshSlider = document.getElementById("caveThreshold") as HTMLInputElement;
const waterSlider = document.getElementById("waterLevel") as HTMLInputElement;
const zoomSlider = document.getElementById("zoom") as HTMLInputElement;
const regenerateBtn = document.getElementById("regenerate") as HTMLButtonElement;

const surfaceScaleVal = document.getElementById("surfaceScale-val")!;
const surfaceAmpVal = document.getElementById("surfaceAmplitude-val")!;
const caveScaleVal = document.getElementById("caveScale-val")!;
const caveThreshVal = document.getElementById("caveThreshold-val")!;
const waterVal = document.getElementById("waterLevel-val")!;
const zoomVal = document.getElementById("zoom-val")!;

function readConfig(): TerrainConfig {
  return {
    ...DEFAULT_CONFIG,
    seed: Number(seedInput.value) || 42,
    surfaceScale: Number(surfaceScaleSlider.value),
    surfaceAmplitude: Number(surfaceAmpSlider.value),
    caveScale: Number(caveScaleSlider.value),
    caveThreshold: Number(caveThreshSlider.value) / 100,
    waterLevel: Number(waterSlider.value) / 100,
  };
}

function updateLabels() {
  surfaceScaleVal.textContent = surfaceScaleSlider.value;
  surfaceAmpVal.textContent = surfaceAmpSlider.value;
  caveScaleVal.textContent = caveScaleSlider.value;
  caveThreshVal.textContent = (Number(caveThreshSlider.value) / 100).toFixed(2);
  waterVal.textContent = (Number(waterSlider.value) / 100).toFixed(2);
  zoomVal.textContent = zoomSlider.value;
}

// State
let grid = generateTerrain(readConfig());
const camera: Camera = { x: 0, y: 0, tileSize: 4 };

function render() {
  camera.tileSize = Number(zoomSlider.value);
  updateLabels();
  renderTerrain(ctx, grid, camera);
}

function regenerate() {
  grid = generateTerrain(readConfig());
  render();
}

// Controls
regenerateBtn.addEventListener("click", regenerate);

for (const slider of [surfaceScaleSlider, surfaceAmpSlider, caveScaleSlider, caveThreshSlider, waterSlider]) {
  slider.addEventListener("change", regenerate);
}
zoomSlider.addEventListener("input", render);

// Pan with mouse drag
let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  camera.x -= e.clientX - lastX;
  camera.y -= e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  render();
});

window.addEventListener("mouseup", () => {
  dragging = false;
  canvas.style.cursor = "grab";
});

canvas.style.cursor = "grab";

// Zoom with scroll wheel
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const newSize = camera.tileSize + (e.deltaY < 0 ? 1 : -1);
  if (newSize >= 1 && newSize <= 16) {
    camera.tileSize = newSize;
    zoomSlider.value = String(newSize);
    render();
  }
}, { passive: false });

// Initial render — center camera on the terrain
camera.x = (DEFAULT_CONFIG.width * camera.tileSize - canvas.width) / 2;
camera.y = (DEFAULT_CONFIG.height * 0.2) * camera.tileSize;
render();
