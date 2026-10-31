import * as THREE from 'three';
import type { Dir, Vec2 } from '../core/grid';
import { getEnemy } from '../content';
import type { GameState, Intent } from '../sim';
import { cellCenter } from './cameraRig';
import { PIT_DEPTH } from './roomMesh';
import { SPRITE_ASPECT, spriteTexture } from './sprites';

const SPRITE_H = 1.65;
const FLASH_MS = 220;

const ease = (t: number) => 1 - (1 - t) ** 3;

interface Tween {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  dur: number;
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
  dying: { start: number; dur: number; fall: boolean } | null;
  flashStart: number;
  sprite: THREE.Sprite | null;
}

export class UnitsView {
  readonly group = new THREE.Group();
  readonly units = new Map<string, UnitVisual>();

  /** Makes the visuals match `state` exactly (new room, undo, end of playback). */
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
          sprite: null,
        };
        if (!isPlayer) {
          const mat = new THREE.SpriteMaterial({ map: spriteTexture(getEnemy(type).sprite), transparent: true });
          mat.alphaTest = 0.5;
          v.sprite = new THREE.Sprite(mat);
          v.sprite.scale.set(SPRITE_H * SPRITE_ASPECT, SPRITE_H, 1);
          this.group.add(v.sprite);
        }
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
      if (v.sprite) {
        v.sprite.visible = v.alive;
        (v.sprite.material as THREE.SpriteMaterial).opacity = 1;
      }
    };
    for (const p of state.players) upsert(p.id, true, p.classId, p, null);
    for (const e of state.enemies) upsert(e.id, false, e.type, e, e.intent);
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      if (v.sprite) {
        this.group.remove(v.sprite);
        v.sprite.material.dispose();
      }
      this.units.delete(id);
    }
  }

  clear(): void {
    for (const v of this.units.values()) {
      if (v.sprite) {
        this.group.remove(v.sprite);
        v.sprite.material.dispose();
      }
    }
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

  flash(id: string, now: number): void {
    const v = this.units.get(id);
    if (v) v.flashStart = now;
  }

  die(id: string, now: number, dur: number, fall: boolean): void {
    const v = this.units.get(id);
    if (!v || v.dying) return;
    v.dying = { start: now, dur, fall };
  }

  update(now: number): void {
    for (const v of this.units.values()) {
      if (v.tween) {
        const t = Math.min(1, (now - v.tween.start) / v.tween.dur);
        v.pos.copy(v.tween.from).lerp(v.tween.to, ease(t));
        if (t >= 1) v.tween = null;
      }
      if (!v.sprite) continue;
      const p = v.pos.clone();
      p.y = SPRITE_H / 2;
      if (v.lunge) {
        const t = (now - v.lunge.start) / v.lunge.dur;
        if (t >= 1) v.lunge = null;
        else p.addScaledVector(v.lunge.dir, Math.sin(t * Math.PI) * v.lunge.dist);
      }
      const mat = v.sprite.material as THREE.SpriteMaterial;
      if (v.dying) {
        const t = Math.min(1, (now - v.dying.start) / v.dying.dur);
        if (v.dying.fall) p.y -= t * t * PIT_DEPTH * 1.2;
        else p.y -= t * SPRITE_H * 0.35;
        mat.opacity = v.dying.fall ? 1 - t * 0.6 : 1 - t;
        if (t >= 1) {
          v.alive = false;
          v.sprite.visible = false;
        }
      }
      const f = (now - v.flashStart) / FLASH_MS;
      if (f >= 0 && f < 1) mat.color.setRGB(1, 0.35 + 0.65 * f, 0.3 + 0.7 * f);
      else mat.color.setRGB(1, 1, 1);
      v.sprite.position.copy(p);
    }
  }

  /** Visual centre of a unit's head, for labels. */
  headPosition(v: UnitVisual): THREE.Vector3 {
    const p = v.pos.clone();
    p.y = v.isPlayer ? 1.6 : (v.sprite?.position.y ?? SPRITE_H / 2) + SPRITE_H * 0.62;
    return p;
  }
}
