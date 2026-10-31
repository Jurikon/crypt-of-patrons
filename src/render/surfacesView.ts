import * as THREE from 'three';
import type { Vec2 } from '../core/grid';
import type { GameState } from '../sim';
import { CELL } from './dims';
import { propGeometry } from './modelMesh';
import { toonMaterial } from './toon';
import { PROPS } from './voxel/models';

const key = (id: string, at: Vec2) => `${id}:${at.x},${at.y}`;
const outline = new THREE.MeshBasicMaterial({ color: 0x2a0a08, side: THREE.BackSide });
const glow = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Corpses, traps and other things lying on floor cells, drawn as small voxel props. */
export class SurfacesView {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, THREE.Group>();
  private readonly material = toonMaterial();

  /** Makes the props match the state exactly (new room, end of playback). */
  sync(state: GameState): void {
    const want = new Set(state.surfaces.map((s) => key(s.id, s)));
    for (const [k, g] of this.items) {
      if (want.has(k)) continue;
      this.group.remove(g);
      this.items.delete(k);
    }
    for (const s of state.surfaces) this.add(s.id, s);
  }

  add(id: string, at: Vec2): void {
    const k = key(id, at);
    const prop = PROPS[id];
    if (this.items.has(k) || !prop) return;
    const geo = propGeometry(prop);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo.mesh, this.material), new THREE.Mesh(geo.outline, outline));
    if (geo.glow) g.add(new THREE.Mesh(geo.glow, glow));
    // A little seeded variety so every corpse does not lie the same way.
    g.rotation.y = ((at.x * 7 + at.y * 13) % 4) * (Math.PI / 2) + ((at.x * 3 + at.y) % 3) * 0.3;
    g.position.set((at.x + 0.5) * CELL, 0.005, (at.y + 0.5) * CELL);
    this.group.add(g);
    this.items.set(k, g);
  }

  remove(id: string, at: Vec2): void {
    const k = key(id, at);
    const g = this.items.get(k);
    if (!g) return;
    this.group.remove(g);
    this.items.delete(k);
  }

  clear(): void {
    for (const g of this.items.values()) this.group.remove(g);
    this.items.clear();
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
