import * as THREE from 'three';
import type { Dir, Vec2 } from '../core/grid';
import { getEnemy, getSummon } from '../content';
import type { GameState, Intent } from '../sim';
import { cellCenter } from './cameraRig';
import { LAVA_Y } from './dims';
import type { Particles } from './fx';
import { BONES, CREATURES, type Bone, type CreatureSpec } from './look/creatureKit';
import { bonePieces, makeMaterial } from './look/creatures';

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
  readonly spec: CreatureSpec;
  readonly root: THREE.Group;
  /** The body: leans, recoils and carries the other bones. */
  readonly tilt: THREE.Group;
  readonly bones: Readonly<Record<Bone, THREE.Group>>;
  /** Lit materials of this unit alone (hit flashes); glowing ones are left out. */
  materials: THREE.MeshStandardMaterial[];
  /** Every material this unit made, for disposal. */
  owned: THREE.Material[];
  /** Resting glow (elites); hit flashes add to it. */
  readonly glow: THREE.Color;
  readonly height: number;
  readonly phase: number;
  yaw: number;
  armAngle: number;
}

/** A bone of a dead creature tumbling to the floor. */
interface Debris {
  readonly obj: THREE.Object3D;
  readonly vel: THREE.Vector3;
  readonly spin: THREE.Vector3;
  readonly start: number;
  /** Materials to free once the last piece of this body is gone. */
  readonly owned: THREE.Material[] | null;
  /** Height of its middle when lying on the floor. */
  readonly rest: number;
}

const DEBRIS_MS = 2600;
const GRAVITY = 9;

/**
 * What the renderer shows for one unit. It trails the simulation: events move it step by step,
 * and `sync` snaps it to the real state once playback is done.
 */
export interface UnitVisual {
  readonly id: string;
  readonly isPlayer: boolean;
  /** Fights on the players' side (a summon). */
  readonly ally: boolean;
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
  /** Rising out of the ground after being summoned. */
  spawnStart: number;
  /** Status ids currently on the unit, for the icons over its head. */
  statuses: string[];
  /** Elite trait (M6b). */
  affix?: string | undefined;
  rig: Rig | null;
}

const SPAWN_MS = 420;

const eyeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.75, 0.12) });
/** Allies' eyes burn cold green, so a raised skeleton never reads as an enemy. */
const allyEyeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.6, 1.3) });
const eyeGeometry = new THREE.SphereGeometry(1, 8, 6);
/** Elites stand a little taller. */
const ELITE_SCALE = 1.12;

export class UnitsView {
  readonly group = new THREE.Group();
  readonly units = new Map<string, UnitVisual>();
  constructor(private readonly fx: Particles) {}

  private readonly debris: Debris[] = [];

  private buildRig(type: string, ally: boolean, elite: boolean, seq: number): Rig {
    const modelId = ally ? getSummon(type).model : getEnemy(type).model;
    const spec = CREATURES[modelId] ?? (CREATURES.warrior as CreatureSpec);
    const root = new THREE.Group();
    const tilt = new THREE.Group();
    root.add(tilt);
    const bones = {} as Record<Bone, THREE.Group>;
    for (const b of BONES) {
      const g = b === 'body' ? tilt : new THREE.Group();
      const at = b === 'body' ? undefined : spec.bones[b];
      if (at) g.position.set(at[0], at[1], at[2]);
      if (g !== tilt) tilt.add(g);
      bones[b] = g;
    }
    // Allies are a shade greener: same bones, different master. Elites are tinted and glow red.
    const tint = new THREE.Color(ally ? 0xb8e0c0 : elite ? 0xffb8a8 : 0xffffff);
    const glow = new THREE.Color(elite ? 0x3a0400 : 0x000000);
    const owned: THREE.Material[] = [];
    const lit: THREE.MeshStandardMaterial[] = [];
    const byName = new Map<string, THREE.Material>();
    for (const [bone, pieces] of bonePieces(modelId, spec)) {
      for (const piece of pieces) {
        let m = byName.get(piece.mat);
        if (!m) {
          m = makeMaterial(modelId, piece.mat, spec.mats[piece.mat]!);
          if (m instanceof THREE.MeshStandardMaterial) {
            m.color.copy(tint);
            m.emissive.copy(glow);
            lit.push(m);
          }
          owned.push(m);
          byName.set(piece.mat, m);
        }
        const mesh = new THREE.Mesh(piece.geo, m);
        mesh.castShadow = true;
        bones[bone].add(mesh);
      }
    }
    for (const e of spec.eyes) {
      const eye = new THREE.Mesh(eyeGeometry, ally ? allyEyeMaterial : eyeMaterial);
      eye.position.set(e.at[0], e.at[1], e.at[2]);
      eye.scale.setScalar(e.r);
      bones[e.bone].add(eye);
    }
    const scale = (spec.scale ?? 1) * (elite ? ELITE_SCALE : 1);
    root.scale.setScalar(scale);
    this.group.add(root);
    return {
      spec,
      root,
      tilt,
      bones,
      materials: lit,
      owned,
      glow,
      height: spec.height * scale,
      phase: seq * 1.7,
      yaw: 0,
      armAngle: spec.poses.idle,
    };
  }

  private dropRig(v: UnitVisual): void {
    if (!v.rig) return;
    this.group.remove(v.rig.root);
    for (const m of v.rig.owned) m.dispose();
    v.rig = null;
  }

  /** Makes the visuals match `state` exactly (new room, restart, end of playback). */
  sync(state: GameState): void {
    const seen = new Set<string>();
    const upsert = (
      id: string,
      isPlayer: boolean,
      ally: boolean,
      type: string,
      u: {
        x: number;
        y: number;
        dir: Dir;
        hp: number;
        maxHp: number;
        statuses: readonly { id: string }[];
        elite?: boolean;
        affix?: string | undefined;
      },
      intent: Intent | null,
    ) => {
      seen.add(id);
      let v = this.units.get(id);
      if (!v) {
        v = {
          id,
          isPlayer,
          ally,
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
          spawnStart: -1e9,
          statuses: [],
          rig: null,
        };
        this.units.set(id, v);
      }
      v.statuses = u.statuses.map((s) => s.id);
      v.affix = u.affix;
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
        v.rig = this.buildRig(type, ally, 'elite' in u && u.elite === true, this.units.size);
        v.rig.yaw = yawFor(u.dir);
      }
      if (v.rig && !v.alive) this.dropRig(v);
    };
    for (const p of state.players) upsert(p.id, true, false, p.classId, p, null);
    for (const a of state.allies) upsert(a.id, false, true, a.type, a, null);
    for (const e of state.enemies) upsert(e.id, false, false, e.type, e, e.intent);
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      this.dropRig(v);
      this.units.delete(id);
    }
  }

  clear(): void {
    for (const v of this.units.values()) this.dropRig(v);
    this.units.clear();
    for (const d of this.debris) {
      this.group.remove(d.obj);
      if (d.owned) for (const m of d.owned) m.dispose();
    }
    this.debris.length = 0;
  }

  /** A summon appears mid-playback and climbs out of the ground. */
  spawn(id: string, type: string, ally: boolean, at: Vec2, dir: Dir, hp: number, now: number): void {
    if (this.units.has(id)) return;
    const v: UnitVisual = {
      id,
      isPlayer: false,
      ally,
      type,
      cell: { x: at.x, y: at.y },
      dir,
      hp,
      maxHp: ally ? getSummon(type).maxHp : getEnemy(type).maxHp,
      intent: null,
      alive: true,
      pos: cellCenter(at),
      tween: null,
      lunge: null,
      dying: null,
      flashStart: -1e9,
      strikeStart: -1e9,
      spawnStart: now,
      statuses: [],
      rig: this.buildRig(type, ally, false, this.units.size),
    };
    if (v.rig) v.rig.yaw = yawFor(dir);
    this.units.set(id, v);
  }

  setStatus(id: string, status: string, on: boolean): void {
    const v = this.units.get(id);
    if (!v) return;
    v.statuses = v.statuses.filter((s) => s !== status);
    if (on) v.statuses.push(status);
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
      // The body comes apart: every bone tumbles away from where the creature stands right now.
      this.update(now);
      const r = v.rig;
      r.root.updateMatrixWorld(true);
      const centre = r.root.position;
      // Each bone (and the body's own meshes) tumbles around its own middle and comes to rest on its
      // thinnest side, so nothing hangs in the air or sinks through the floor.
      const parts: { obj: THREE.Group; rest: number }[] = [];
      const box = new THREE.Box3();
      for (const b of BONES) {
        const g = r.bones[b];
        const meshes = g.children.filter((c) => c instanceof THREE.Mesh);
        if (!meshes.length) continue;
        box.makeEmpty();
        for (const m of meshes) box.expandByObject(m);
        const holder = new THREE.Group();
        box.getCenter(holder.position);
        this.group.add(holder);
        holder.updateMatrixWorld(true);
        for (const m of meshes) holder.attach(m);
        const size = box.getSize(new THREE.Vector3());
        parts.push({ obj: holder, rest: Math.max(0.03, Math.min(size.x, size.y, size.z) / 2) });
      }
      parts.forEach(({ obj, rest }, i) => {
        const out = obj.position.clone().sub(centre).setY(0);
        if (out.lengthSq() < 1e-4) out.set(Math.sin(i * 2.3), 0, Math.cos(i * 2.3));
        out.normalize().multiplyScalar(0.6 + ((i * 37) % 10) * 0.08);
        this.debris.push({
          obj,
          vel: new THREE.Vector3(out.x, 1.2 + ((i * 53) % 10) * 0.12, out.z),
          spin: new THREE.Vector3(((i * 29) % 7) - 3, ((i * 17) % 5) - 2, ((i * 41) % 7) - 3).multiplyScalar(1.2),
          start: now,
          owned: i === 0 ? r.owned : null,
          rest,
        });
      });
      // The materials now belong to the falling pieces.
      r.owned = [];
      r.root.visible = false;
      this.fx.dust(centre.clone(), now);
    }
  }

  /** Pieces of dead creatures fall, bounce once, lie still, then sink into the floor. */
  private updateDebris(now: number, dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      const age = now - d.start;
      const o = d.obj;
      if (age > DEBRIS_MS) {
        this.group.remove(o);
        if (d.owned) for (const m of d.owned) m.dispose();
        this.debris.splice(i, 1);
        continue;
      }
      if (age > DEBRIS_MS - 700) {
        o.position.y -= dt * 0.25;
        continue;
      }
      d.vel.y -= GRAVITY * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.spin.x * dt;
      o.rotation.y += d.spin.y * dt;
      o.rotation.z += d.spin.z * dt;
      if (o.position.y < d.rest) {
        o.position.y = d.rest;
        d.vel.multiplyScalar(0.35);
        d.vel.y = Math.abs(d.vel.y) > 0.4 ? Math.abs(d.vel.y) : 0;
        d.spin.multiplyScalar(0.4);
      }
    }
  }

  /** True while any unit is still moving, lunging, striking or dying. */
  isAnimating(now: number): boolean {
    for (const v of this.units.values()) {
      if (v.tween && now - v.tween.start < v.tween.dur) return true;
      if (now - v.spawnStart < SPAWN_MS) return true;
      if (v.lunge && now - v.lunge.start < v.lunge.dur) return true;
      if (v.dying && now - v.dying.start < v.dying.dur) return true;
    }
    return false;
  }

  private lastUpdate = 0;

  update(now: number): void {
    const s = now / 1000;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastUpdate) / 1000));
    this.lastUpdate = now;
    this.updateDebris(now, dt);
    for (const v of this.units.values()) {
      let walk = 0;
      let stride = 0;
      if (v.tween) {
        const t = Math.min(1, (now - v.tween.start) / v.tween.dur);
        v.pos.copy(v.tween.from).lerp(v.tween.to, ease(t));
        walk = Math.sin(t * Math.PI);
        stride = Math.sin(t * Math.PI * 2);
        if (t >= 1) v.tween = null;
      }
      const r = v.rig;
      if (!r) continue;
      const spec = r.spec;
      const gait = spec.gait;
      const still = gait === 'still';
      const p = v.pos.clone();
      // Idle breathing; a bob while stepping (a bounce without legs); floaters hover.
      if (!still) p.y += Math.sin(s * 1.8 + r.phase) * 0.012;
      if (gait === 'walk') p.y += walk * 0.05;
      if (gait === 'hop' || gait === 'slither') p.y += walk * 0.12;
      if (gait === 'float') p.y += 0.12 + Math.sin(s * 1.3 + r.phase) * 0.05;
      const rise = (now - v.spawnStart) / SPAWN_MS;
      if (rise >= 0 && rise < 1) p.y -= (1 - ease(rise)) * r.height;
      if (v.lunge) {
        const t = (now - v.lunge.start) / v.lunge.dur;
        if (t >= 1) v.lunge = null;
        else p.addScaledVector(v.lunge.dir, Math.sin(t * Math.PI) * v.lunge.dist);
      }

      // Turn smoothly to face the grid direction.
      const k = 1 - Math.exp(-14 * (1 / 60));
      r.yaw += angleDelta(r.yaw, yawFor(v.dir)) * k;

      // Striking arm: raised while an attack is telegraphed, swung through on the strike, at rest otherwise.
      const poses = spec.poses;
      const st = (now - v.strikeStart) / STRIKE_MS;
      let lean = 0;
      if (st >= 0 && st < 1) {
        r.armAngle = st < 0.35 ? poses.windup + (poses.strike - poses.windup) * ease(st / 0.35) : poses.strike;
        lean = Math.sin(Math.min(1, st / 0.5) * Math.PI) * 0.12;
      } else {
        const target = v.intent ? poses.windup : poses.idle;
        r.armAngle += (target - r.armAngle) * 0.12;
      }
      const b = r.bones;
      b.armR.rotation.x = r.armAngle;
      // Legs stride and the free arm swings against them; the head sways a little.
      b.legL.rotation.x = stride * 0.55;
      b.legR.rotation.x = -stride * 0.55;
      b.armL.rotation.x = -stride * 0.35 + Math.sin(s * 1.8 + r.phase) * 0.04;
      b.head.rotation.y = Math.sin(s * 0.7 + r.phase) * 0.15;
      b.head.rotation.x = Math.sin(s * 1.1 + r.phase) * 0.04;

      // Hit: white flash and a recoil.
      const f = (now - v.flashStart) / FLASH_MS;
      const hit = f >= 0 && f < 1 ? 1 - f : 0;
      for (const m of r.materials) m.emissive.copy(r.glow).addScalar(hit * 0.3);
      r.tilt.rotation.x = -0.3 * hit + lean + (still ? 0 : Math.sin(s * 0.9 + r.phase) * 0.02);
      r.tilt.rotation.y = gait === 'slither' ? Math.sin(s * 3 + r.phase) * 0.12 + stride * 0.2 : 0;
      r.tilt.rotation.z = still ? hit * 0.06 * Math.sin(now / 20) : 0;

      if (v.dying) {
        const t = Math.min(1, (now - v.dying.start) / v.dying.dur);
        if (v.dying.fall) {
          // Sink into the pit, tipping over, with a splash as it goes under.
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
