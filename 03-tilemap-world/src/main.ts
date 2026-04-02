import { World } from "./world";
import { renderWorld, type Camera } from "./renderer";
import { BLOCK_DEFS } from "./blocks";
import { WORLD_H } from "./chunk";
import { DEFAULT_CONFIG } from "./chunk";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const seedInput = document.getElementById("seed") as HTMLInputElement;
const zoomSlider = document.getElementById("zoom") as HTMLInputElement;
const zoomVal = document.getElementById("zoom-val")!;
const regenerateBtn = document.getElementById("regenerate") as HTMLButtonElement;
const coordsDisplay = document.getElementById("coords")!;
const chunksDisplay = document.getElementById("chunks-loaded")!;

function resizeCanvas() {
  const toolbar = document.querySelector(".toolbar") as HTMLElement;
  const legend = document.querySelector(".legend") as HTMLElement;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - toolbar.offsetHeight - legend.offsetHeight;
}
resizeCanvas();

// State
let world = new World({ seed: Number(seedInput.value) || 42 });
const camera: Camera = { x: -256, y: DEFAULT_CONFIG.surfaceY * 4 - 200, tileSize: 4 };

function render() {
  camera.tileSize = Number(zoomSlider.value);
  zoomVal.textContent = zoomSlider.value;

  renderWorld(ctx, world, camera);

  // HUD info
  const tileX = Math.floor(camera.x / camera.tileSize + canvas.width / camera.tileSize / 2);
  const tileY = Math.floor(camera.y / camera.tileSize + canvas.height / camera.tileSize / 2);
  coordsDisplay.textContent = `${tileX}, ${tileY}`;
  chunksDisplay.textContent = String(world.loadedChunks().length);
}

function regenerate() {
  world = new World({ seed: Number(seedInput.value) || 42 });
  render();
}

regenerateBtn.addEventListener("click", regenerate);

zoomSlider.addEventListener("input", render);
window.addEventListener("resize", () => { resizeCanvas(); render(); });

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
  // Clamp vertical
  camera.y = Math.max(0, Math.min(WORLD_H * camera.tileSize - canvas.height, camera.y));
  render();
});

window.addEventListener("mouseup", () => {
  dragging = false;
  canvas.style.cursor = "grab";
});

canvas.style.cursor = "grab";

// Zoom with scroll
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const newSize = camera.tileSize + (e.deltaY < 0 ? 1 : -1);
  if (newSize >= 1 && newSize <= 16) {
    camera.tileSize = newSize;
    zoomSlider.value = String(newSize);
    render();
  }
}, { passive: false });

// Keyboard pan (arrow keys / WASD)
const keysDown = new Set<string>();
window.addEventListener("keydown", (e) => keysDown.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keysDown.delete(e.key.toLowerCase()));

function tick() {
  const speed = 6;
  let moved = false;
  if (keysDown.has("arrowleft") || keysDown.has("a")) { camera.x -= speed; moved = true; }
  if (keysDown.has("arrowright") || keysDown.has("d")) { camera.x += speed; moved = true; }
  if (keysDown.has("arrowup") || keysDown.has("w")) { camera.y -= speed; moved = true; }
  if (keysDown.has("arrowdown") || keysDown.has("s")) { camera.y += speed; moved = true; }
  if (moved) {
    camera.y = Math.max(0, Math.min(WORLD_H * camera.tileSize - canvas.height, camera.y));
    render();
  }
  requestAnimationFrame(tick);
}

// Block tooltip on hover
canvas.addEventListener("mousemove", (e) => {
  if (dragging) return;
  const tileX = Math.floor((camera.x + e.offsetX) / camera.tileSize);
  const tileY = Math.floor((camera.y + e.offsetY) / camera.tileSize);
  const block = world.getBlock(tileX, tileY);
  const def = BLOCK_DEFS[block];
  canvas.title = def ? `${def.name} (${tileX}, ${tileY})` : "";
});

render();
requestAnimationFrame(tick);
