import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World } from "./world";
import { CHUNK_SIZE, DEFAULT_CONFIG } from "./chunk";

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7EC8E3);
scene.fog = new THREE.Fog(0x7EC8E3, CHUNK_SIZE * 8, CHUNK_SIZE * 28);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, CHUNK_SIZE * 40);
const startY = DEFAULT_CONFIG.baseHeight + 20;
camera.position.set(CHUNK_SIZE, startY, CHUNK_SIZE * 2);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("canvas") as HTMLCanvasElement, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight - 80);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 30);
scene.add(dirLight);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(CHUNK_SIZE, DEFAULT_CONFIG.baseHeight, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxDistance = CHUNK_SIZE * 16;

// World
const seedInput = document.getElementById("seed") as HTMLInputElement;
const radiusSlider = document.getElementById("radius") as HTMLInputElement;
const radiusVal = document.getElementById("radius-val")!;
const regenerateBtn = document.getElementById("regenerate") as HTMLButtonElement;
const chunksDisplay = document.getElementById("chunks-loaded")!;
const pendingDisplay = document.getElementById("pending")!;
const fpsDisplay = document.getElementById("fps")!;

let world = new World(scene, { seed: Number(seedInput.value) || 42 });
let renderRadius = Number(radiusSlider.value);

function regenerate() {
  world.dispose();
  world = new World(scene, { seed: Number(seedInput.value) || 42 });
}

regenerateBtn.addEventListener("click", regenerate);
radiusSlider.addEventListener("input", () => {
  renderRadius = Number(radiusSlider.value);
  radiusVal.textContent = String(renderRadius);
});

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / (window.innerHeight - 80);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight - 80);
});

// Game loop
let lastTime = performance.now();
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Update world chunks based on camera target
  world.update(controls.target, renderRadius);
  chunksDisplay.textContent = String(world.loadedCount());
  pendingDisplay.textContent = String(world.pendingCount());

  renderer.render(scene, camera);

  // FPS counter
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fpsDisplay.textContent = String(frameCount);
    frameCount = 0;
    lastTime = now;
  }
}

animate();
