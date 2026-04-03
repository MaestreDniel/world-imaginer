import * as THREE from "three";
import type { World } from "./world";

export const CAMERA_HEIGHT = 1.6; // eye level above feet

const PLAYER_WIDTH  = 0.6;
const PLAYER_HEIGHT = 1.8;
const HALF_W        = PLAYER_WIDTH / 2;
const GRAVITY       = -28;
const JUMP_VY       = 10;
const WALK_SPEED    = 5;
const MOUSE_SENS    = 0.002;
const MAX_PITCH     = Math.PI / 2 - 0.01;

export class WalkController {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private canvas: HTMLElement;

  readonly feet = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private yaw   = 0;
  private pitch = 0;
  private grounded = false;
  private _active  = false;
  private locked   = false;

  private boundMouseMove     = (e: MouseEvent) => this.onMouseMove(e);
  private boundLockChange    = () => this.onLockChange();
  private boundCanvasClick   = () => { if (this._active) this.canvas.requestPointerLock(); };

  constructor(camera: THREE.PerspectiveCamera, world: World, canvas: HTMLElement) {
    this.camera = camera;
    this.world  = world;
    this.canvas = canvas;
    camera.rotation.order = "YXZ";
  }

  get active(): boolean { return this._active; }

  setWorld(world: World): void { this.world = world; }

  enable(startPos: THREE.Vector3): void {
    this._active = true;
    this.feet.copy(startPos);
    this.velocity.set(0, 0, 0);
    this.grounded = false;

    // Derive yaw/pitch from current camera direction for a smooth transition
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw   = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));

    document.addEventListener("mousemove",        this.boundMouseMove);
    document.addEventListener("pointerlockchange", this.boundLockChange);
    this.canvas.addEventListener("click",          this.boundCanvasClick);
    this.canvas.requestPointerLock();
  }

  disable(): void {
    this._active = false;
    this.locked  = false;
    document.removeEventListener("mousemove",        this.boundMouseMove);
    document.removeEventListener("pointerlockchange", this.boundLockChange);
    this.canvas.removeEventListener("click",          this.boundCanvasClick);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    this.yaw   -= e.movementX * MOUSE_SENS;
    this.pitch -= e.movementY * MOUSE_SENS;
    this.pitch  = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  private onLockChange(): void {
    this.locked = document.pointerLockElement === this.canvas;
  }

  /** Returns true if the player AABB at (fx, fy, fz) overlaps any solid block. */
  private overlaps(fx: number, fy: number, fz: number): boolean {
    const x0 = Math.floor(fx - HALF_W),               x1 = Math.floor(fx + HALF_W);
    const y0 = Math.floor(fy),                         y1 = Math.floor(fy + PLAYER_HEIGHT - 0.001);
    const z0 = Math.floor(fz - HALF_W),               z1 = Math.floor(fz + HALF_W);
    for (let bx = x0; bx <= x1; bx++)
      for (let by = y0; by <= y1; by++)
        for (let bz = z0; bz <= z1; bz++)
          if (this.world.isSolid(bx, by, bz)) return true;
    return false;
  }

  update(dt: number, keysDown: Set<string>): void {
    if (!this._active) return;

    // ── Horizontal movement ──────────────────────────────────────────────
    let dx = 0, dz = 0;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (keysDown.has("w") || keysDown.has("arrowup"))    { dx -= sy; dz -= cy; }
    if (keysDown.has("s") || keysDown.has("arrowdown"))  { dx += sy; dz += cy; }
    if (keysDown.has("a") || keysDown.has("arrowleft"))  { dx -= cy; dz += sy; }
    if (keysDown.has("d") || keysDown.has("arrowright")) { dx += cy; dz -= sy; }
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 1e-6) { dx = dx / len * WALK_SPEED; dz = dz / len * WALK_SPEED; }
    this.velocity.x = dx;
    this.velocity.z = dz;

    // ── Ground check — test if there is solid ground just below feet ────
    if (this.grounded) {
      const stillOnGround = this.overlaps(this.feet.x, this.feet.y - 0.05, this.feet.z);
      if (!stillOnGround) this.grounded = false;
    }

    // ── Jump ─────────────────────────────────────────────────────────────
    if (keysDown.has(" ") && this.grounded) {
      this.velocity.y = JUMP_VY;
      this.grounded   = false;
    }

    // ── Gravity ──────────────────────────────────────────────────────────
    if (!this.grounded) this.velocity.y += GRAVITY * dt;

    // ── Resolve X ────────────────────────────────────────────────────────
    const nx = this.feet.x + this.velocity.x * dt;
    if (!this.overlaps(nx, this.feet.y, this.feet.z)) {
      this.feet.x = nx;
    } else {
      this.velocity.x = 0;
    }

    // ── Resolve Y ────────────────────────────────────────────────────────
    const ny = this.feet.y + this.velocity.y * dt;
    if (!this.overlaps(this.feet.x, ny, this.feet.z)) {
      this.feet.y = ny;
    } else {
      if (this.velocity.y < 0) {
        // Landing: snap feet to the top of the blocking block
        this.feet.y  = Math.floor(ny) + 1;
        this.grounded = true;
      }
      this.velocity.y = 0;
    }

    // ── Resolve Z ────────────────────────────────────────────────────────
    const nz = this.feet.z + this.velocity.z * dt;
    if (!this.overlaps(this.feet.x, this.feet.y, nz)) {
      this.feet.z = nz;
    } else {
      this.velocity.z = 0;
    }

    // ── Update camera ────────────────────────────────────────────────────
    this.camera.position.set(this.feet.x, this.feet.y + CAMERA_HEIGHT, this.feet.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
