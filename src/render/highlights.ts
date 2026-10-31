import * as THREE from 'three';
import type { Vec2 } from '../core/grid';
import { CELL } from './roomMesh';

export type HighlightKind = 'intent' | 'target' | 'push' | 'strike';

const STYLE: Record<HighlightKind, { color: number; opacity: number; inset: number; y: number }> = {
  intent: { color: 0xff2a14, opacity: 0.42, inset: 0.08, y: 0.02 },
  push: { color: 0xff9a20, opacity: 0.4, inset: 0.22, y: 0.03 },
  target: { color: 0xffd040, opacity: 0.5, inset: 0.04, y: 0.035 },
  strike: { color: 0xff6040, opacity: 0.8, inset: 0, y: 0.04 },
};

export interface Highlight {
  readonly cell: Vec2;
  readonly kind: HighlightKind;
  /** 0..1 extra fade (used by short-lived strike flashes). */
  readonly fade?: number;
}

/** Glowing floor quads, drawn from a pool each frame. */
export class Highlights {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  draw(list: readonly Highlight[], now: number): void {
    const pulse = 0.75 + 0.25 * Math.sin(now / 180);
    list.forEach((h, i) => {
      let mesh = this.pool[i];
      if (!mesh) {
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        });
        mesh = new THREE.Mesh(this.geometry, mat);
        mesh.renderOrder = 2;
        this.pool.push(mesh);
        this.group.add(mesh);
      }
      const s = STYLE[h.kind];
      const size = CELL * (1 - s.inset * 2);
      mesh.visible = true;
      mesh.scale.set(size, 1, size);
      mesh.position.set((h.cell.x + 0.5) * CELL, s.y, (h.cell.y + 0.5) * CELL);
      mesh.material.color.setHex(s.color);
      mesh.material.opacity = s.opacity * (h.kind === 'intent' ? pulse : 1) * (1 - (h.fade ?? 0));
    });
    for (let i = list.length; i < this.pool.length; i++) (this.pool[i] as THREE.Mesh).visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.pool) m.material.dispose();
  }
}
