import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World } from "./world";
import { CHUNK_SIZE, DEFAULT_CONFIG } from "./chunk";
import { createBiomeSampler, createBiomeDebugSampler, BIOME_DEFS } from "./biomes";

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7EC8E3);
scene.fog = new THREE.Fog(0x7EC8E3, CHUNK_SIZE * 8, CHUNK_SIZE * 28);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, CHUNK_SIZE * 40);
const startY = DEFAULT_CONFIG.baseHeight + 30;
camera.position.set(CHUNK_SIZE * 2, startY, CHUNK_SIZE * 3);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("canvas") as HTMLCanvasElement, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight - 80);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(80, 120, 40);
scene.add(dirLight);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(CHUNK_SIZE, DEFAULT_CONFIG.baseHeight, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxDistance = CHUNK_SIZE * 16;

// UI
const seedInput = document.getElementById("seed") as HTMLInputElement;
const radiusSlider = document.getElementById("radius") as HTMLInputElement;
const radiusVal = document.getElementById("radius-val")!;
const regenerateBtn = document.getElementById("regenerate") as HTMLButtonElement;
const debugToggle = document.getElementById("debug") as HTMLInputElement;
const debugOverlay = document.getElementById("debug-overlay")!;
const fpsLimitSlider = document.getElementById("fpslimit") as HTMLInputElement;
const fpsLimitVal = document.getElementById("fpslimit-val")!;
const chunksDisplay = document.getElementById("chunks-loaded")!;
const pendingDisplay = document.getElementById("pending")!;
const fpsDisplay = document.getElementById("fps")!;

function randomSeed(): number {
  return Math.floor(Math.random() * 999999);
}

// Start with a random seed
let currentSeed = randomSeed();
seedInput.value = String(currentSeed);

let world = new World(scene, { seed: currentSeed });
let biomeSampler = createBiomeSampler(currentSeed);
let biomeDebugSampler = createBiomeDebugSampler(currentSeed);
let renderRadius = Number(radiusSlider.value);

function regenerate() {
  // Use the input value if the user changed it, otherwise pick a new random seed
  const inputVal = Number(seedInput.value);
  if (inputVal !== currentSeed) {
    currentSeed = inputVal || randomSeed();
  } else {
    currentSeed = randomSeed();
  }
  seedInput.value = String(currentSeed);

  world.dispose();
  world = new World(scene, { seed: currentSeed });
  biomeSampler = createBiomeSampler(currentSeed);
  biomeDebugSampler = createBiomeDebugSampler(currentSeed);
}

regenerateBtn.addEventListener("click", regenerate);
radiusSlider.addEventListener("input", () => {
  renderRadius = Number(radiusSlider.value);
  radiusVal.textContent = String(renderRadius);
});

// Debug toggle
debugToggle.addEventListener("change", () => {
  debugOverlay.style.display = debugToggle.checked ? "block" : "none";
});

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / (window.innerHeight - 80);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight - 80);
});

// WASD keyboard movement
const keysDown = new Set<string>();
window.addEventListener("keydown", (e) => {
  // Don't capture keys when typing in the seed input
  if (e.target === seedInput) return;
  keysDown.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => keysDown.delete(e.key.toLowerCase()));

function handleKeyboardMovement() {
  const speed = 1.5;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  let moved = false;
  if (keysDown.has("w") || keysDown.has("arrowup")) {
    controls.target.addScaledVector(forward, speed);
    camera.position.addScaledVector(forward, speed);
    moved = true;
  }
  if (keysDown.has("s") || keysDown.has("arrowdown")) {
    controls.target.addScaledVector(forward, -speed);
    camera.position.addScaledVector(forward, -speed);
    moved = true;
  }
  if (keysDown.has("a") || keysDown.has("arrowleft")) {
    controls.target.addScaledVector(right, -speed);
    camera.position.addScaledVector(right, -speed);
    moved = true;
  }
  if (keysDown.has("d") || keysDown.has("arrowright")) {
    controls.target.addScaledVector(right, speed);
    camera.position.addScaledVector(right, speed);
    moved = true;
  }
  if (keysDown.has(" ")) {
    controls.target.y += speed;
    camera.position.y += speed;
    moved = true;
  }
  if (keysDown.has("shift")) {
    controls.target.y -= speed;
    camera.position.y -= speed;
    moved = true;
  }
  return moved;
}

// FPS limiter
let fpsLimit = Number(fpsLimitSlider.value);
fpsLimitSlider.addEventListener("input", () => {
  fpsLimit = Number(fpsLimitSlider.value);
  fpsLimitVal.textContent = String(fpsLimit);
});

// Game loop
let lastTime = performance.now();
let frameCount = 0;
let lastFrameTime = 0;

function animate(timestamp: number) {
  requestAnimationFrame(animate);

  // Throttle: skip frame if not enough time has passed
  const frameBudget = 1000 / fpsLimit;
  if (timestamp - lastFrameTime < frameBudget) return;
  lastFrameTime = timestamp;

  handleKeyboardMovement();
  controls.update();
  world.update(controls.target, renderRadius);

  chunksDisplay.textContent = String(world.loadedCount());
  pendingDisplay.textContent = String(world.pendingCount());

  // Debug overlay
  if (debugToggle.checked) {
    const t = controls.target;
    const wx = Math.floor(t.x);
    const wz = Math.floor(t.z);
    const debug = biomeDebugSampler(wx, wz);
    const biomeName = BIOME_DEFS[debug.biome]?.name ?? "Unknown";
    debugOverlay.innerHTML =
      `Pos: ${wx}, ${Math.floor(t.y)}, ${wz}<br>` +
      `Chunk: ${Math.floor(t.x / CHUNK_SIZE)}, ${Math.floor(t.y / CHUNK_SIZE)}, ${Math.floor(t.z / CHUNK_SIZE)}<br>` +
      `Biome: ${biomeName}<br>` +
      `Seed: ${currentSeed}<br>` +
      `<br>` +
      `Temperature: ${debug.temperature.toFixed(3)}<br>` +
      `Humidity: ${debug.humidity.toFixed(3)}<br>` +
      `Continent: ${debug.continent.toFixed(3)}`;
  }

  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fpsDisplay.textContent = String(frameCount);
    frameCount = 0;
    lastTime = now;
  }
}

requestAnimationFrame(animate);
