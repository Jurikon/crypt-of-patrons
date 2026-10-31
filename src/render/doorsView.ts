import * as THREE from 'three';
import { dirVec } from '../core/grid';
import type { RewardKind } from '../content';
import type { GameState } from '../sim';
import { CELL } from './dims';

/** Portal colour per reward, so a door reads at a glance (labels add the words). */
export const REWARD_COLORS: Record<RewardKind, number> = {
  ability: 0xffd060,
  modifier: 0x80d0ff,
  upgrade: 0x8aff9a,
  rest: 0xffb0c8,
  elite: 0xff4a3a,
  boss: 0xb070ff,
  initiation: 0xffffff,
  treasure: 0xffa020,
};

/** How far into the door cell the arch's back (the planks) sits; the portal hangs just in front. */
const RECESS = 0.76;
const WIDTH = 1.15;
const HEIGHT = 1.75;

/** Glowing portals in the arches of the doors that are open, coloured by what lies behind them. */
export class DoorsView {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  private portals: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; phase: number }[] = [];
  private shownKey = '';

  /** Shows a portal in every offered door (none while fighting). */
  sync(state: GameState): void {
    const run = state.run;
    const offers = run?.phase === 'doors' ? run.doors : [];
    const key = `${state.seed}:${run?.depth}:${offers.map((o) => `${o.door}${o.reward}`).join(',')}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.clear();
    for (const [i, o] of offers.entries()) {
      const door = state.room.doors[o.door];
      if (!door) continue;
      const d = dirVec(door.dir);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(REWARD_COLORS[o.reward]).multiplyScalar(1.6),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      const back = CELL / 2 - RECESS;
      mesh.position.set(
        (door.x + 0.5 + (d.x * back) / CELL) * CELL,
        HEIGHT / 2 + 0.02,
        (door.y + 0.5 + (d.y * back) / CELL) * CELL,
      );
      mesh.rotation.y = Math.atan2(d.x, d.y);
      this.group.add(mesh);
      this.portals.push({ mesh, phase: i * 1.9 });
    }
  }

  update(now: number): void {
    for (const p of this.portals) p.mesh.material.opacity = 0.65 + 0.25 * Math.sin(now / 320 + p.phase);
  }

  clear(): void {
    for (const p of this.portals) {
      this.group.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.portals = [];
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
  }
}
