import * as THREE from 'three';
import type { Dir, Vec2 } from '../core/grid';
import type { GameEvent, Room } from '../sim';
import { CELL } from './roomMesh';

export const EYE_HEIGHT = 1.35;
const STEP_MS = 150;
const TURN_MS = 150;
const BUMP_MS = 160;
const TOP_MS = 320;
const BOB_AMPLITUDE = 0.06;
const BUMP_DISTANCE = 0.22;
const LOOK_YAW_LIMIT = THREE.MathUtils.degToRad(70);
const LOOK_PITCH_LIMIT = THREE.MathUtils.degToRad(40);
const LOOK_SENSITIVITY = 0.0025;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** World-space centre of a cell, at floor level. */
export function cellCenter(p: Vec2): THREE.Vector3 {
  return new THREE.Vector3((p.x + 0.5) * CELL, 0, (p.y + 0.5) * CELL);
}

/** Camera yaw for a grid direction; three.js cameras look down −Z (north) at yaw 0. */
const yawFor = (d: Dir) => (-d * Math.PI) / 2;

interface Tween<T> {
  from: T;
  to: T;
  start: number;
  duration: number;
}

/**
 * Turns simulation events into smooth camera motion. Purely visual: it never changes game state.
 * Mouse look and top view are offsets on top of the grid pose.
 */
export class CameraRig {
  private pos: Tween<THREE.Vector3>;
  private yaw: Tween<number>;
  private bump: { dir: THREE.Vector3; start: number } | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private topTarget = 0;
  private topFrom = 0;
  private topStart = 0;
  private topValue = 0;
  private topPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    room: Room,
    player: { x: number; y: number; dir: Dir },
    now: number,
  ) {
    const p = cellCenter(player);
    this.pos = { from: p.clone(), to: p.clone(), start: now, duration: STEP_MS };
    const yaw = yawFor(player.dir);
    this.yaw = { from: yaw, to: yaw, start: now, duration: TURN_MS };
    this.setRoom(room);
  }

  /** Recomputes the overhead pose so the whole room fits the view. */
  setRoom(room: Room): void {
    const w = room.grid.w * CELL;
    const h = room.grid.h * CELL;
    const center = new THREE.Vector3(w / 2, 0, h / 2);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitH = h / 2 / Math.tan(vFov / 2);
    const fitW = w / 2 / Math.tan(hFov / 2);
    const height = Math.max(fitH, fitW) * 1.08 + 1;
    this.topPose.pos.set(center.x, height, center.z);
    // Look straight down with north at the top of the screen, like the minimap.
    this.topPose.quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));
  }

  /** Snaps to a pose without animating (new room, reset). */
  snap(room: Room, player: { x: number; y: number; dir: Dir }, now: number): void {
    const p = cellCenter(player);
    this.pos = { from: p.clone(), to: p.clone(), start: now, duration: STEP_MS };
    const yaw = yawFor(player.dir);
    this.yaw = { from: yaw, to: yaw, start: now, duration: TURN_MS };
    this.bump = null;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.setRoom(room);
  }

  onEvent(e: GameEvent, now: number): void {
    switch (e.type) {
      case 'moved':
        this.pos = { from: this.currentPos(now), to: cellCenter(e.to), start: now, duration: STEP_MS };
        break;
      case 'turned': {
        // Accumulate yaw instead of wrapping, so the turn always takes the short way round.
        const delta = (e.to - e.from + 4) % 4 === 1 ? -Math.PI / 2 : Math.PI / 2;
        this.yaw = { from: this.currentYaw(now), to: this.yaw.to + delta, start: now, duration: TURN_MS };
        break;
      }
      case 'bumped': {
        const at = cellCenter(e.at);
        const dir = at.sub(this.pos.to).setY(0).normalize();
        this.bump = { dir, start: now };
        break;
      }
      default:
        break;
    }
  }

  look(dx: number, dy: number): void {
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * LOOK_SENSITIVITY, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * LOOK_SENSITIVITY, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT);
  }

  setTopView(on: boolean, now: number): void {
    const target = on ? 1 : 0;
    if (target === this.topTarget) return;
    this.topFrom = this.topValue;
    this.topTarget = target;
    this.topStart = now;
  }

  /** 0 = first person, 1 = fully overhead. */
  get topBlend(): number {
    return this.topValue;
  }

  /** True while a step, turn or bump is playing; input is buffered meanwhile. */
  isBusy(now: number): boolean {
    return (
      now - this.pos.start < this.pos.duration ||
      now - this.yaw.start < this.yaw.duration ||
      (this.bump !== null && now - this.bump.start < BUMP_MS)
    );
  }

  update(now: number): void {
    // First-person pose.
    const pos = this.currentPos(now);
    const stepT = Math.min(1, (now - this.pos.start) / this.pos.duration);
    const moving = this.pos.from.distanceToSquared(this.pos.to) > 1e-6 && stepT < 1;
    const bob = moving ? Math.sin(stepT * Math.PI) * BOB_AMPLITUDE : 0;
    pos.y = EYE_HEIGHT + bob;

    let shakeRoll = 0;
    if (this.bump) {
      const bt = (now - this.bump.start) / BUMP_MS;
      if (bt >= 1) {
        this.bump = null;
      } else {
        const push = Math.sin(bt * Math.PI) * BUMP_DISTANCE;
        pos.addScaledVector(this.bump.dir, push);
        pos.y -= Math.sin(bt * Math.PI) * 0.04;
        shakeRoll = Math.sin(bt * Math.PI * 6) * (1 - bt) * 0.025;
      }
    }

    const yaw = this.currentYaw(now) + this.lookYaw;
    const fpQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, yaw, shakeRoll, 'YXZ'));

    // Blend towards the overhead pose.
    const tt = Math.min(1, (now - this.topStart) / TOP_MS);
    this.topValue = this.topFrom + (this.topTarget - this.topFrom) * easeInOut(tt);
    const k = this.topValue;
    this.camera.position.copy(pos).lerp(this.topPose.pos, k);
    this.camera.quaternion.copy(fpQuat).slerp(this.topPose.quat, k);
  }

  /** Interpolated grid position (floor level), without bob or bump. */
  currentPos(now: number): THREE.Vector3 {
    const t = Math.min(1, (now - this.pos.start) / this.pos.duration);
    return this.pos.from.clone().lerp(this.pos.to, easeOut(t));
  }

  /** Interpolated yaw without mouse look. */
  currentYaw(now: number): number {
    const t = Math.min(1, (now - this.yaw.start) / this.yaw.duration);
    return this.yaw.from + (this.yaw.to - this.yaw.from) * easeOut(t);
  }
}
