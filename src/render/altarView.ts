import * as THREE from 'three';
import { getCell, type Vec2 } from '../core/grid';
import { getPatron } from '../content';
import type { GameState } from '../sim';
import { CELL } from './dims';
import { PROPS } from './look/creatureKit';
import { buildProp } from './look/creatures';

/**
 * Where the altar stands: against the wall farthest from the way in, at the edge of a floor cell, so it
 * never takes the middle of a cell where the fight happens. Returns the cell and the wall's direction.
 */
function altarSpot(state: GameState): { x: number; y: number; wall: Vec2 } {
  const { grid, spawn } = state.room;
  let best = { x: spawn.x, y: spawn.y, wall: { x: 0, y: -1 } };
  let bestD = -1;
  for (let y = 1; y < grid.h - 1; y++)
    for (let x = 1; x < grid.w - 1; x++) {
      if (getCell(grid, x, y) !== 'floor') continue;
      for (const w of [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ]) {
        if (getCell(grid, x + w.x, y + w.y) !== 'wall') continue;
        const d = (x - spawn.x) ** 2 + (y - spawn.y) ** 2;
        if (d > bestD) {
          bestD = d;
          best = { x, y, wall: w };
        }
      }
    }
  return best;
}

/**
 * An altar room's sigil: a ring on the floor and a low stone with the patron's colour. Dim while the
 * fight lasts, it lights up once the room is cleared and the gifts are offered.
 */
export class AltarView {
  readonly group = new THREE.Group();
  private readonly ring = new THREE.RingGeometry(0.55, 0.78, 40).rotateX(-Math.PI / 2);
  private readonly inner = new THREE.CircleGeometry(0.42, 6).rotateX(-Math.PI / 2);
  /** The patron's light: always there (adding lights recompiles shaders), off outside altar rooms. */
  private readonly light = new THREE.PointLight(0xffffff, 0, 6, 1.3);
  private materials: THREE.Material[] = [];
  private glow: THREE.MeshBasicMaterial | null = null;
  private lit = false;
  private shownKey = '';

  constructor() {
    this.group.add(this.light);
  }

  sync(state: GameState): void {
    const patron = state.run?.patron ?? null;
    const lit = state.run?.phase !== 'combat';
    const key = `${state.seed}:${state.run?.act}:${state.run?.depth}:${patron}`;
    this.lit = lit;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.clear();
    if (!patron) return;
    const spot = altarSpot(state);
    const color = new THREE.Color(getPatron(patron).color);
    this.glow = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.7),
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const centre = new THREE.Vector3((spot.x + 0.5) * CELL, 0, (spot.y + 0.5) * CELL);
    // The altar against the wall, facing into the room; the patron's sign glows on its front.
    const { group: altar, materials } = buildProp('patronAltar', PROPS.patronAltar!);
    this.materials = materials;
    altar.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    altar.position.copy(centre).add(new THREE.Vector3(spot.wall.x * 0.62, 0, spot.wall.y * 0.62));
    altar.rotation.y = Math.atan2(-spot.wall.x, -spot.wall.y);
    const sign = new THREE.Mesh(this.inner, this.glow);
    sign.rotation.x = Math.PI / 2;
    sign.scale.setScalar(0.35);
    sign.position.set(0, 0.5, 0.29);
    altar.add(sign);
    // A sigil on the floor in front of it.
    const ring = new THREE.Mesh(this.ring, this.glow);
    ring.position.copy(centre).setY(0.02);
    this.group.add(altar, ring);
    this.light.color.copy(color);
    this.light.position.copy(altar.position).add(new THREE.Vector3(-spot.wall.x * 0.6, 1.4, -spot.wall.y * 0.6));
  }

  /** Lit: a slow bright pulse; unlit: a faint glow. */
  update(now: number): void {
    if (!this.glow) return;
    this.glow.opacity = this.lit ? 0.7 + 0.25 * Math.sin(now / 260) : 0.18 + 0.05 * Math.sin(now / 600);
    this.light.intensity = (this.lit ? 2.6 : 0.8) * (0.9 + 0.1 * Math.sin(now / 260));
  }

  clear(): void {
    for (const c of [...this.group.children]) if (c !== this.light) this.group.remove(c);
    this.glow?.dispose();
    this.glow = null;
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.light.intensity = 0;
  }

  dispose(): void {
    this.clear();
    this.ring.dispose();
    this.inner.dispose();
  }
}
