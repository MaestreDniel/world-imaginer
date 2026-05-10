import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World } from "./world";
import { CHUNK_SIZE, DEFAULT_CONFIG } from "./chunk";
import { createBiomeSampler, createBiomeDebugSampler, BIOME_DEFS } from "./biomes";
import { WalkController, CAMERA_HEIGHT } from "./walkController";
import { DEFAULT_PARAMS, cloneParams, type GenerationParams } from "./generationParams";
import { DebugPanel } from "./debugPanel";
import { createMapView, type MapViewHandle } from "./mapView";
import {
  createDayNightState,
  tickDayNight,
  sharedDayNightUniforms,
  type DayNightState,
} from "./dayNight";

// ── Scene ────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7EC8E3);
scene.fog = new THREE.Fog(0x7EC8E3, 0, 1); // color overwritten each frame by dayNight; near/far by updateFog()

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 1); // far set by updateFog()
camera.position.set(CHUNK_SIZE * 0, 8, CHUNK_SIZE * 0);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("canvas") as HTMLCanvasElement, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight - 80);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ── Audio ────────────────────────────────────────────────────────────────────
const listener = new THREE.AudioListener();
camera.add(listener);

const TRACKS = [
  '../public/assets/dry_hands.ogg',
  '../public/assets/sweden.ogg',
  '../public/assets/living_mice.ogg',
  '../public/assets/minecraft.ogg',
  '../public/assets/wet_hands.ogg',
  '../public/assets/danny.ogg',
  '../public/assets/mice_on_venus.ogg',
];

const sound = new THREE.Audio(listener);
const audioLoader = new THREE.AudioLoader();
let remaining = [...TRACKS];

function pickNextTrack(): string {
  if (remaining.length === 0) remaining = [...TRACKS];
  const idx = Math.floor(Math.random() * remaining.length);
  return remaining.splice(idx, 1)[0];
}

// Load and play a track, then set up the next one to play after a delay once it ends
function loadAndPlay(delay: number): void {
  const track = pickNextTrack();
  audioLoader.load(track, (buffer) => {
    if (sound.isPlaying) sound.stop();
    sound.setBuffer(buffer);
    sound.setLoop(false);
    sound.setVolume(0.5);
    setTimeout(() => {
      sound.play();
      sound.source!.onended = () => loadAndPlay(120000);
    }, delay);
  });
}

loadAndPlay(15000);

// ── Lighting ─────────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
scene.add(dirLight);

const dayNightState: DayNightState = createDayNightState();

// ── Controls ─────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(CHUNK_SIZE, 10, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxDistance = CHUNK_SIZE * 16;

// ── UI ───────────────────────────────────────────────────────────────────────
const seedInput      = document.getElementById("seed")         as HTMLInputElement;
const radiusSlider   = document.getElementById("radius")       as HTMLInputElement;
const radiusVal      = document.getElementById("radius-val")!;
const regenerateBtn  = document.getElementById("regenerate")   as HTMLButtonElement;
const debugToggle    = document.getElementById("debug")        as HTMLInputElement;
const debugOverlay   = document.getElementById("debug-overlay")!;
const fpsLimitSlider = document.getElementById("fpslimit")     as HTMLInputElement;
const fpsLimitVal    = document.getElementById("fpslimit-val")!;
const chunksDisplay  = document.getElementById("chunks-loaded")!;
const pendingDisplay = document.getElementById("pending")!;
const fpsDisplay     = document.getElementById("fps")!;
const modeBtn        = document.getElementById("mode")         as HTMLButtonElement;
const crosshair      = document.getElementById("crosshair")!;
const lockOverlay    = document.getElementById("lock-overlay")!;

function randomSeed(): number {
  return Math.floor(Math.random() * 999999);
}

let currentSeed = randomSeed();
seedInput.value = String(currentSeed);

let currentParams = cloneParams(DEFAULT_PARAMS);

let world = new World(scene, {
  seed: currentSeed,
  params: currentParams,
});
let biomeSampler      = createBiomeSampler(currentSeed, currentParams.biomes);
let biomeDebugSampler = createBiomeDebugSampler(currentSeed, currentParams, DEFAULT_CONFIG.waterLevel);
let renderRadius = Number(radiusSlider.value);

const mapCanvas       = document.getElementById("map-canvas")        as HTMLCanvasElement;
const mapTooltip      = document.getElementById("map-tooltip")!;
const mapCoordReadout = document.getElementById("map-coord-readout")!;

let isMapView = false;

const mapView: MapViewHandle = createMapView({
  canvas:         mapCanvas,
  tooltipEl:      mapTooltip,
  coordReadoutEl: mapCoordReadout,
  getSeedAndParams: () => ({
    seed:       currentSeed,
    params:     currentParams,
    waterLevel: DEFAULT_CONFIG.waterLevel,
  }),
  onTeleport: (wx, wz, surfaceY) => {
    camera.position.set(wx, surfaceY + 2, wz);
    controls.target.set(wx, surfaceY + 2, wz);
  },
});

function setView(mode: "3d" | "map"): void {
  isMapView = (mode === "map");
  if (isMapView) {
    renderer.domElement.style.display = "none";
    mapView.setCenter(camera.position.x, camera.position.z);
    mapView.show();
  } else {
    renderer.domElement.style.display = "block";
    mapView.hide();
  }
}

const debugPanel = new DebugPanel(
  currentParams,
  (newParams, randomizeSeed) => {
    currentParams = newParams;
    if (randomizeSeed) {
      currentSeed = randomSeed();
      seedInput.value = String(currentSeed);
    }
    rebuildWorld();
    mapView.refresh();
  },
  setView,
);
debugPanel.attachDayNight(dayNightState);

const paramsToggleBtn = document.getElementById("params-toggle") as HTMLButtonElement;
paramsToggleBtn.addEventListener("click", () => { debugPanel.toggle(); paramsToggleBtn.blur(); });

function updateFog(radius: number): void {
  const far  = radius * CHUNK_SIZE;
  const near = far * 0.6;
  (scene.fog as THREE.Fog).near = near;
  (scene.fog as THREE.Fog).far  = far;
  camera.far = far;
  camera.updateProjectionMatrix();
}

updateFog(renderRadius);

// ── Walk controller ───────────────────────────────────────────────────────────
const walkController = new WalkController(camera, world, renderer.domElement);

// Show/hide the "click to capture" overlay based on pointer-lock state
document.addEventListener("pointerlockchange", () => {
  if (mode === "walk") {
    const locked = document.pointerLockElement === renderer.domElement;
    lockOverlay.style.display = locked ? "none" : "block";
  }
});

// ── Mode switching ────────────────────────────────────────────────────────────
type Mode = "fly" | "walk";
let mode: Mode = "fly";

function setMode(next: Mode): void {
  if (next === mode) return;
  mode = next;

  if (mode === "walk") {
    controls.enabled = false;
    // Feet start at camera position minus eye height
    const startFeet = camera.position.clone();
    startFeet.y -= CAMERA_HEIGHT;
    walkController.enable(startFeet);
    crosshair.style.display    = "block";
    lockOverlay.style.display  = "block";
    modeBtn.textContent = "✈ Fly";
  } else {
    walkController.disable();
    controls.enabled = true;
    // Sync OrbitControls target so camera doesn't snap
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    controls.target.copy(camera.position).addScaledVector(dir, 10);
    controls.update();
    crosshair.style.display   = "none";
    lockOverlay.style.display = "none";
    modeBtn.textContent = "🚶 Walk";
  }
}

modeBtn.addEventListener("click", () => { setMode(mode === "fly" ? "walk" : "fly"); modeBtn.blur(); });

// ── World management ──────────────────────────────────────────────────────────
function rebuildWorld() {
  world.dispose();
  world = new World(scene, {
    seed: currentSeed,
    params: currentParams,
  });
  biomeSampler      = createBiomeSampler(currentSeed, currentParams.biomes);
  biomeDebugSampler = createBiomeDebugSampler(currentSeed, currentParams, DEFAULT_CONFIG.waterLevel);
  walkController.setWorld(world);
}

function regenerate() {
  const inputVal = Number(seedInput.value);
  if (inputVal !== currentSeed) {
    currentSeed = inputVal || randomSeed();
  } else {
    currentSeed = randomSeed();
  }
  seedInput.value = String(currentSeed);
  rebuildWorld();
}

regenerateBtn.addEventListener("click", regenerate);
radiusSlider.addEventListener("input", () => {
  renderRadius = Number(radiusSlider.value);
  radiusVal.textContent = String(renderRadius);
  updateFog(renderRadius);
});

debugToggle.addEventListener("change", () => {
  debugOverlay.style.display = debugToggle.checked ? "block" : "none";
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / (window.innerHeight - 80);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight - 80);
});

// ── Keyboard ──────────────────────────────────────────────────────────────────
const keysDown = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (e.target === seedInput) return;
  const key = e.key.toLowerCase();
  if (key === "f") { setMode(mode === "fly" ? "walk" : "fly"); return; }
  if (key === "p") { debugPanel.toggle(); return; }
  keysDown.add(key);
});
window.addEventListener("keyup", (e) => keysDown.delete(e.key.toLowerCase()));

function handleFlyMovement(): void {
  const speed = 1;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  if (keysDown.has("w") || keysDown.has("arrowup"))    { controls.target.addScaledVector(forward, speed);  camera.position.addScaledVector(forward, speed);  }
  if (keysDown.has("s") || keysDown.has("arrowdown"))  { controls.target.addScaledVector(forward, -speed); camera.position.addScaledVector(forward, -speed); }
  if (keysDown.has("a") || keysDown.has("arrowleft"))  { controls.target.addScaledVector(right,  -speed);  camera.position.addScaledVector(right,  -speed);  }
  if (keysDown.has("d") || keysDown.has("arrowright")) { controls.target.addScaledVector(right,   speed);  camera.position.addScaledVector(right,   speed);  }
  if (keysDown.has(" "))     { controls.target.y += speed; camera.position.y += speed; }
  if (keysDown.has("shift")) { controls.target.y -= speed; camera.position.y -= speed; }
}

// ── FPS limiter ───────────────────────────────────────────────────────────────
let fpsLimit = Number(fpsLimitSlider.value);
fpsLimitSlider.addEventListener("input", () => {
  fpsLimit = Number(fpsLimitSlider.value);
  fpsLimitVal.textContent = String(fpsLimit);
});

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastTime      = performance.now();
let frameCount    = 0;
let lastFrameTime = 0;
let prevTime      = performance.now();

function animate(timestamp: number) {
  requestAnimationFrame(animate);

  const frameBudget = 1000 / fpsLimit;
  if (timestamp - lastFrameTime < frameBudget) return;

  const dt = Math.min((timestamp - prevTime) / 1000, 0.1);
  prevTime      = timestamp;
  lastFrameTime = timestamp;

  const frame = tickDayNight(dayNightState, dt);
  sharedDayNightUniforms.uTimeOfDay.value = frame.skyLightFactor;
  dirLight.position.copy(frame.sunDir).multiplyScalar(200);
  dirLight.intensity = frame.sunIntensity;
  dirLight.color.copy(frame.sunColor);
  ambientLight.intensity = frame.ambientIntensity;
  (scene.background as THREE.Color).copy(frame.clearColor);
  (scene.fog as THREE.Fog).color.copy(frame.clearColor);
  debugPanel.updateDayNightReadout(frame);

  if (!isMapView) {
    if (mode === "fly") {
      handleFlyMovement();
      controls.update();
      world.update(controls.target, renderRadius);
    } else {
      walkController.update(dt, keysDown);
      world.update(walkController.feet, renderRadius);
    }

    chunksDisplay.textContent  = String(world.loadedCount());
    pendingDisplay.textContent = String(world.pendingCount());

    if (debugToggle.checked) {
      const pos = mode === "fly" ? controls.target : walkController.feet;
      const wx = Math.floor(pos.x);
      const wz = Math.floor(pos.z);
      const debug = biomeDebugSampler(wx, wz);
      const biomeName = BIOME_DEFS[debug.biome]?.name ?? "Unknown";
      debugOverlay.innerHTML =
        `Mode: ${mode}<br>` +
        `Pos: ${wx}, ${Math.floor(pos.y)}, ${wz}<br>` +
        `Chunk: ${Math.floor(pos.x / CHUNK_SIZE)}, ${Math.floor(pos.y / CHUNK_SIZE)}, ${Math.floor(pos.z / CHUNK_SIZE)}<br>` +
        `Biome: ${biomeName}<br>` +
        `Seed: ${currentSeed}<br>` +
        `Temperature: ${debug.temperature.toFixed(3)}<br>` +
        `Humidity: ${debug.humidity.toFixed(3)}<br>` +
        `Continentalness: ${debug.continentalness.toFixed(3)}<br>` +
        `Erosion: ${debug.erosion.toFixed(3)}<br>` +
        `Peaks/Valleys: ${debug.peaksValleys.toFixed(3)}<br>` +
        `Height: ${debug.height.toFixed(1)}`;
    }

    renderer.render(scene, camera);
  }

  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fpsDisplay.textContent = String(frameCount);
    frameCount = 0;
    lastTime   = now;
  }
}

requestAnimationFrame(animate);
