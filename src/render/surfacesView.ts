import * as THREE from 'three';
import type { Vec2 } from '../core/grid';
import { getSurface } from '../content';
import type { GameState } from '../sim';
import { CELL } from './dims';
import { propGeometry } from './modelMesh';
import { toonMaterial } from './toon';
import { PROPS } from './voxel/models';

const key = (id: string, at: Vec2) => `${id}:${at.x},${at.y}`;

/** Looks of surfaces that are patches or volumes rather than voxel props. */
const FLAT: Record<string, { color: number; opacity: number; glow?: boolean; volume?: number }> = {
  fire: { color: 0xff6a10, opacity: 0.7, glow: true },
  ice: { color: 0xcfeeff, opacity: 0.55 },
  blood: { color: 0x5a0606, opacity: 0.75 },
  smoke: { color: 0x9a9088, opacity: 0.55, volume: 2.1 },
  poisonCloud: { color: 0x6ad040, opacity: 0.32, volume: 1.4 },
  water: { color: 0x14506e, opacity: 0.8 },
  holyFire: { color: 0xfff0b0, opacity: 0.9, glow: true },
  current: { color: 0x2a8aa8, opacity: 0.55 },
};
const outline = new THREE.MeshBasicMaterial({ color: 0x2a0a08, side: THREE.BackSide });
const glow = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Corpses, traps and other things lying on floor cells, drawn as small voxel props. */
export class SurfacesView {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, THREE.Group>();
  private readonly material = toonMaterial();
  private readonly plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly arrow = new THREE.ShapeGeometry(
    new THREE.Shape([
      new THREE.Vector2(0, 0.42),
      new THREE.Vector2(0.32, 0.02),
      new THREE.Vector2(0.14, 0.02),
      new THREE.Vector2(0.14, -0.38),
      new THREE.Vector2(-0.14, -0.38),
      new THREE.Vector2(-0.14, 0.02),
      new THREE.Vector2(-0.32, 0.02),
    ]),
  ).rotateX(-Math.PI / 2);
  private readonly arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfefff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /** Makes the props match the state exactly (new room, end of playback). */
  sync(state: GameState): void {
    const want = new Set(state.surfaces.map((s) => key(s.id, s)));
    for (const [k, g] of this.items) {
      if (want.has(k)) continue;
      this.drop(k, g);
    }
    for (const s of state.surfaces) this.add(s.id, s);
  }

  add(id: string, at: Vec2): void {
    const k = key(id, at);
    if (this.items.has(k)) return;
    const prop = PROPS[id];
    if (!prop) {
      const flat = this.flat(id);
      if (!flat) return;
      flat.position.set((at.x + 0.5) * CELL, 0, (at.y + 0.5) * CELL);
      this.group.add(flat);
      this.items.set(k, flat);
      return;
    }
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

  /** Surfaces without a voxel prop: a glowing or tinted patch, or a volume of smoke or gas. */
  private flat(id: string): THREE.Group | null {
    const flow = getSurface(id).flow;
    const look = FLAT[flow !== undefined ? 'current' : id];
    if (!look) return null;
    const g = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(look.color).multiplyScalar(look.glow ? 1.8 : 1),
      transparent: true,
      opacity: look.opacity,
      depthWrite: false,
      blending: look.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: !look.glow,
    });
    g.userData.material = material;
    const mesh = look.volume ? new THREE.Mesh(this.box, material) : new THREE.Mesh(this.plane, material);
    if (look.volume) {
      mesh.scale.set(CELL * 0.98, look.volume, CELL * 0.98);
      mesh.position.y = look.volume / 2;
    } else {
      mesh.scale.set(CELL * 0.9, 1, CELL * 0.9);
      mesh.position.y = 0.012;
    }
    g.userData.pulse = look.glow ? 1 : 0;
    g.add(mesh);
    if (flow !== undefined) {
      // A pale chevron pointing downstream (north = −Z).
      const arrow = new THREE.Mesh(this.arrow, this.arrowMaterial);
      arrow.position.y = 0.02;
      arrow.rotation.y = -flow * (Math.PI / 2);
      g.add(arrow);
    }
    return g;
  }

  /** Fire flickers, smoke drifts. */
  update(now: number): void {
    for (const g of this.items.values()) {
      if (!g.userData.pulse) continue;
      const m = (g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = 0.55 + 0.25 * Math.sin(now / 90 + g.position.x * 3 + g.position.z);
    }
  }

  remove(id: string, at: Vec2): void {
    const k = key(id, at);
    const g = this.items.get(k);
    if (g) this.drop(k, g);
  }

  private drop(k: string, g: THREE.Group): void {
    this.group.remove(g);
    this.items.delete(k);
    (g.userData.material as THREE.Material | undefined)?.dispose();
  }

  clear(): void {
    for (const [k, g] of [...this.items]) this.drop(k, g);
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.plane.dispose();
    this.box.dispose();
    this.arrow.dispose();
    this.arrowMaterial.dispose();
  }
}
