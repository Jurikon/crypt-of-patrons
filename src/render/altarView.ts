import * as THREE from 'three';
import { getCell } from '../core/grid';
import { getPatron } from '../content';
import type { GameState } from '../sim';
import { CELL } from './dims';
import { toonMaterial } from './toon';

/** The floor cell closest to the middle of the room: where the altar stands. */
function centreCell(state: GameState): { x: number; y: number } {
  const { interior, grid } = state.room;
  const cx = interior.x + (interior.w - 1) / 2;
  const cy = interior.y + (interior.h - 1) / 2;
  let best = { x: Math.round(cx), y: Math.round(cy) };
  let bestD = Infinity;
  for (let y = interior.y; y < interior.y + interior.h; y++)
    for (let x = interior.x; x < interior.x + interior.w; x++) {
      if (getCell(grid, x, y) !== 'floor') continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
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
  private readonly stone = new THREE.CylinderGeometry(0.22, 0.3, 0.32, 6);
  private readonly stoneMaterial = toonMaterial({ vertexColors: false, color: 0x5a524c });
  private glow: THREE.MeshBasicMaterial | null = null;
  private lit = false;
  private shownKey = '';

  sync(state: GameState): void {
    const patron = state.run?.patron ?? null;
    const lit = state.run?.phase !== 'combat';
    const key = `${state.seed}:${state.run?.depth}:${patron}`;
    this.lit = lit;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.clear();
    if (!patron) return;
    const at = centreCell(state);
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
    const g = new THREE.Group();
    const ring = new THREE.Mesh(this.ring, this.glow);
    ring.position.y = 0.02;
    const inner = new THREE.Mesh(this.inner, this.glow);
    inner.position.y = 0.015;
    const stone = new THREE.Mesh(this.stone, this.stoneMaterial);
    stone.position.y = 0.16;
    const cap = new THREE.Mesh(this.inner, this.glow);
    cap.scale.setScalar(0.5);
    cap.position.y = 0.33;
    g.add(ring, inner, stone, cap);
    g.position.set((at.x + 0.5) * CELL, 0, (at.y + 0.5) * CELL);
    this.group.add(g);
  }

  /** Lit: a slow bright pulse; unlit: a faint glow. */
  update(now: number): void {
    if (!this.glow) return;
    this.glow.opacity = this.lit ? 0.7 + 0.25 * Math.sin(now / 260) : 0.18 + 0.05 * Math.sin(now / 600);
  }

  clear(): void {
    this.group.clear();
    this.glow?.dispose();
    this.glow = null;
  }

  dispose(): void {
    this.clear();
    this.ring.dispose();
    this.inner.dispose();
    this.stone.dispose();
    this.stoneMaterial.dispose();
  }
}
