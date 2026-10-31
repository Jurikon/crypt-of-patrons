import * as THREE from 'three';
import type { Vec2 } from '../core/grid';
import { CELL } from './dims';

export type HighlightKind = 'intent' | 'target' | 'push' | 'strike';

/**
 * Cold colours on purpose: the world is orange and red (lava, fire), so danger is shown as a pale
 * ice-blue frame rather than a red fill that would read as more lava.
 */
const STYLE: Record<
  HighlightKind,
  { color: number; frame: number; fill: number; inset: number; y: number; pulse: boolean }
> = {
  intent: { color: 0xa8e8ff, frame: 0.95, fill: 0.16, inset: 0.06, y: 0.02, pulse: true },
  push: { color: 0x7fd0ff, frame: 0, fill: 0.55, inset: 0.34, y: 0.03, pulse: false },
  target: { color: 0xffe070, frame: 0.95, fill: 0.14, inset: 0.03, y: 0.035, pulse: false },
  strike: { color: 0xffffff, frame: 0.9, fill: 0.5, inset: 0.02, y: 0.04, pulse: false },
};

/** Border width as a fraction of the highlight size. */
const FRAME_WIDTH = 0.09;

export interface Highlight {
  readonly cell: Vec2;
  readonly kind: HighlightKind;
  /** 0..1 extra fade (used by short-lived strike flashes). */
  readonly fade?: number;
}

function frameGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5).lineTo(-0.5, -0.5);
  const i = 0.5 - FRAME_WIDTH;
  const hole = new THREE.Path();
  hole.moveTo(-i, -i).lineTo(-i, i).lineTo(i, i).lineTo(i, -i).lineTo(-i, -i);
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

interface Slot {
  readonly frame: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** Glowing cell markers on the floor, drawn from a pool each frame. */
export class Highlights {
  readonly group = new THREE.Group();
  private readonly pool: Slot[] = [];
  private readonly frameGeo = frameGeometry();
  private readonly fillGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  private material(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
  }

  draw(list: readonly Highlight[], now: number): void {
    const pulse = 0.7 + 0.3 * Math.sin(now / 170);
    list.forEach((h, i) => {
      let slot = this.pool[i];
      if (!slot) {
        slot = {
          frame: new THREE.Mesh(this.frameGeo, this.material()),
          fill: new THREE.Mesh(this.fillGeo, this.material()),
        };
        slot.frame.renderOrder = 3;
        slot.fill.renderOrder = 2;
        this.pool.push(slot);
        this.group.add(slot.frame, slot.fill);
      }
      const s = STYLE[h.kind];
      const size = CELL * (1 - s.inset * 2);
      const k = (s.pulse ? pulse : 1) * (1 - (h.fade ?? 0));
      for (const [mesh, opacity] of [
        [slot.frame, s.frame],
        [slot.fill, s.fill],
      ] as const) {
        mesh.visible = opacity > 0;
        mesh.scale.set(size, 1, size);
        mesh.position.set((h.cell.x + 0.5) * CELL, s.y, (h.cell.y + 0.5) * CELL);
        mesh.material.color.setHex(s.color);
        mesh.material.opacity = opacity * k;
      }
    });
    for (let i = list.length; i < this.pool.length; i++) {
      const slot = this.pool[i] as Slot;
      slot.frame.visible = false;
      slot.fill.visible = false;
    }
  }

  dispose(): void {
    this.frameGeo.dispose();
    this.fillGeo.dispose();
    for (const s of this.pool) {
      s.frame.material.dispose();
      s.fill.material.dispose();
    }
  }
}
