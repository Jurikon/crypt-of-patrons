import * as THREE from 'three';
import type { Dir, Vec2 } from '../core/grid';
import { getEnemy } from '../content';
import type { GameState, Intent } from '../sim';
import { cellCenter } from './cameraRig';
import { LAVA_Y } from './dims';
import type { Particles } from './fx';
import { modelGeometry, type ModelGeometry } from './modelMesh';
import { toonMaterial } from './toon';
import { MODELS, modelHeight } from './voxel/models';

const FLASH_MS = 240;
const STRIKE_MS = 300;
const FALL_DEPTH = 1.8;

const ease = (t: number) => 1 - (1 - t) ** 3;

/** Facing angle for a grid direction; models face +Z at angle 0, so north (−Z) is π. */
const yawFor = (d: Dir) => Math.PI - (d * Math.PI) / 2;

/** Shortest signed difference between two angles. */
const angleDelta = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

interface Tween {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  dur: number;
}

/** The three.js objects of one enemy. */
interface Rig {
  readonly geo: ModelGeometry;
  readonly root: THREE.Group;
  readonly tilt: THREE.Group;
  readonly arm: THREE.Group;
  readonly material: THREE.MeshToonMaterial;
  readonly height: number;
  readonly phase: number;
  yaw: number;
  armAngle: number;
}

/**
 * What the renderer shows for one unit. It trails the simulation: events move it step by step,
 * and `sync` snaps it to the real state once playback is done.
 */
export interface UnitVisual {
  readonly id: string;
  readonly isPlayer: boolean;
  readonly type: string;
  cell: Vec2;
  dir: Dir;
  hp: number;
  maxHp: number;
  intent: Intent | null;
  alive: boolean;
  /** Current world position at floor level. */
  pos: THREE.Vector3;
  tween: Tween | null;
  lunge: { dir: THREE.Vector3; start: number; dur: number; dist: number } | null;
  dying: { start: number; dur: number; fall: boolean; splashed: boolean } | null;
  flashStart: number;
  strikeStart: number;
  rig: Rig | null;
}

const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x2a0a08, side: THREE.BackSide });
const eyeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.75, 0.12) });

export class UnitsView {
  readonly group = new THREE.Group();
  readonly units = new Map<string, UnitVisual>();
  constructor(private readonly fx: Particles) {}

  private buildRig(type: string, seq: number): Rig {
    const model = MODELS[getEnemy(type).model] ?? (MODELS.warrior as (typeof MODELS)[string]);
    const geo = modelGeometry(model);
    const material = toonMaterial({ emissive: 0x000000 });
    const root = new THREE.Group();
    const tilt = new THREE.Group();
    root.add(tilt);
    tilt.add(new THREE.Mesh(geo.body.mesh, material), new THREE.Mesh(geo.body.outline, outlineMaterial));
    tilt.add(new THREE.Mesh(geo.eyes, eyeMaterial));
    const arm = new THREE.Group();
    arm.position.copy(geo.pivot);
    arm.add(new THREE.Mesh(geo.arm.mesh, material), new THREE.Mesh(geo.arm.outline, outlineMaterial));
    tilt.add(arm);
    this.group.add(root);
    return {
      geo,
      root,
      tilt,
      arm,
      material,
      height: modelHeight(model),
      phase: seq * 1.7,
      yaw: 0,
      armAngle: model.poses.idle,
    };
  }

  private dropRig(v: UnitVisual): void {
    if (!v.rig) return;
    this.group.remove(v.rig.root);
    v.rig.material.dispose();
    v.rig = null;
  }

  /** Makes the visuals match `state` exactly (new room, restart, end of playback). */
  sync(state: GameState): void {
    const seen = new Set<string>();
    const upsert = (
      id: string,
      isPlayer: boolean,
      type: string,
      u: { x: number; y: number; dir: Dir; hp: number; maxHp: number },
      intent: Intent | null,
    ) => {
      seen.add(id);
      let v = this.units.get(id);
      if (!v) {
        v = {
          id,
          isPlayer,
          type,
          cell: { x: u.x, y: u.y },
          dir: u.dir,
          hp: u.hp,
          maxHp: u.maxHp,
          intent,
          alive: true,
          pos: cellCenter(u),
          tween: null,
          lunge: null,
          dying: null,
          flashStart: -1e9,
          strikeStart: -1e9,
          rig: null,
        };
        this.units.set(id, v);
      }
      v.cell = { x: u.x, y: u.y };
      v.pos = cellCenter(u);
      v.dir = u.dir;
      v.hp = u.hp;
      v.maxHp = u.maxHp;
      v.intent = intent;
      v.alive = u.hp > 0;
      v.tween = null;
      v.lunge = null;
      v.dying = null;
      if (!isPlayer && v.alive && !v.rig) {
        v.rig = this.buildRig(type, this.units.size);
        v.rig.yaw = yawFor(u.dir);
      }
      if (v.rig && !v.alive) this.dropRig(v);
    };
    for (const p of state.players) upsert(p.id, true, p.classId, p, null);
    for (const e of state.enemies) upsert(e.id, false, e.type, e, e.intent);
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      this.dropRig(v);
      this.units.delete(id);
    }
  }

  clear(): void {
    for (const v of this.units.values()) this.dropRig(v);
    this.units.clear();
  }

  moveTo(id: string, to: Vec2, now: number, dur: number): void {
    const v = this.units.get(id);
    if (!v) return;
    v.tween = { from: v.pos.clone(), to: cellCenter(to), start: now, dur };
    v.cell = { x: to.x, y: to.y };
  }

  lungeTowards(id: string, target: Vec2, now: number, dur: number, dist = 0.6): void {
    const v = this.units.get(id);
    if (!v) return;
    const dir = cellCenter(target).sub(cellCenter(v.cell)).setY(0);
    if (dir.lengthSq() < 1e-6) return;
    v.lunge = { dir: dir.normalize(), start: now, dur, dist };
  }

  /** Plays the attack swing (the arm was already raised while the attack was telegraphed). */
  strike(id: string, now: number): void {
    const v = this.units.get(id);
    if (v) v.strikeStart = now;
  }

  flash(id: string, now: number): void {
    const v = this.units.get(id);
    if (v) v.flashStart = now;
  }

  die(id: string, now: number, dur: number, fall: boolean): void {
    const v = this.units.get(id);
    if (!v || v.dying) return;
    v.dying = { start: now, dur, fall, splashed: false };
    if (!fall && v.rig) {
      // Shatter: every voxel flies apart from where the model stands right now.
      this.update(now);
      const r = v.rig;
      r.root.updateMatrixWorld(true);
      const pieces: { pos: THREE.Vector3; color: THREE.Color }[] = [];
      for (const p of r.geo.body.voxels)
        pieces.push({ pos: p.pos.clone().applyMatrix4(r.tilt.matrixWorld), color: p.color });
      for (const p of r.geo.arm.voxels)
        pieces.push({ pos: p.pos.clone().applyMatrix4(r.arm.matrixWorld), color: p.color });
      this.fx.shatter(pieces, r.geo.model.voxel, r.root.position.clone(), now);
      r.root.visible = false;
    }
  }

  /** True while any unit is still moving, lunging, striking or dying. */
  isAnimating(now: number): boolean {
    for (const v of this.units.values()) {
      if (v.tween && now - v.tween.start < v.tween.dur) return true;
      if (v.lunge && now - v.lunge.start < v.lunge.dur) return true;
      if (v.dying && now - v.dying.start < v.dying.dur) return true;
    }
    return false;
  }

  update(now: number): void {
    const s = now / 1000;
    for (const v of this.units.values()) {
      let walk = 0;
      if (v.tween) {
        const t = Math.min(1, (now - v.tween.start) / v.tween.dur);
        v.pos.copy(v.tween.from).lerp(v.tween.to, ease(t));
        walk = Math.sin(t * Math.PI);
        if (t >= 1) v.tween = null;
      }
      const r = v.rig;
      if (!r) continue;
      const p = v.pos.clone();
      // Idle breathing and a hop while stepping.
      p.y += Math.sin(s * 1.8 + r.phase) * 0.015 + walk * 0.08;
      if (v.lunge) {
        const t = (now - v.lunge.start) / v.lunge.dur;
        if (t >= 1) v.lunge = null;
        else p.addScaledVector(v.lunge.dir, Math.sin(t * Math.PI) * v.lunge.dist);
      }

      // Turn smoothly to face the grid direction.
      const k = 1 - Math.exp(-14 * (1 / 60));
      r.yaw += angleDelta(r.yaw, yawFor(v.dir)) * k;

      // Arm: raised while an attack is telegraphed, swung through on the strike, at rest otherwise.
      const poses = r.geo.model.poses;
      const st = (now - v.strikeStart) / STRIKE_MS;
      if (st >= 0 && st < 1) {
        r.armAngle = st < 0.35 ? poses.windup + (poses.strike - poses.windup) * ease(st / 0.35) : poses.strike;
      } else {
        const target = v.intent ? poses.windup : poses.idle;
        r.armAngle += (target - r.armAngle) * 0.12;
      }
      r.arm.rotation.x = r.armAngle;

      // Hit: white flash and a recoil.
      const f = (now - v.flashStart) / FLASH_MS;
      const hit = f >= 0 && f < 1 ? 1 - f : 0;
      r.material.emissive.setScalar(hit * 0.9);
      r.tilt.rotation.x = -0.3 * hit + Math.sin(s * 0.9 + r.phase) * 0.02;

      if (v.dying) {
        const t = Math.min(1, (now - v.dying.start) / v.dying.dur);
        if (v.dying.fall) {
          // Sink into the lava, tipping over, with a splash as it goes under.
          p.y = LAVA_Y + 0.3 - t * t * FALL_DEPTH;
          r.tilt.rotation.z = t * 0.9;
          if (!v.dying.splashed && t > 0.25) {
            v.dying.splashed = true;
            this.fx.splash(new THREE.Vector3(p.x, LAVA_Y, p.z), now);
          }
        }
        if (t >= 1) {
          v.alive = false;
          r.root.visible = false;
        }
      }
      r.root.position.copy(p);
      r.root.rotation.y = r.yaw;
    }
  }

  /** World position of the strike point (weapon height) for projectiles. */
  muzzle(v: UnitVisual): THREE.Vector3 {
    return v.pos.clone().setY(1.05);
  }

  /** Visual centre of a unit's head, for labels. */
  headPosition(v: UnitVisual): THREE.Vector3 {
    const p = v.pos.clone();
    p.y = v.isPlayer ? 1.6 : (v.rig?.root.position.y ?? 0) + (v.rig?.height ?? 1.5) + 0.12;
    return p;
  }
}
