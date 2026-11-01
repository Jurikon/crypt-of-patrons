import * as THREE from 'three';
import { planks, solid } from './textures';

/**
 * The hero's hands in front of the camera (MV): what the class fights with, swinging on every action.
 * Knight: a sword and a shield; Rogue: two daggers; Necromancer: a staff topped with a glowing skull.
 * Hidden from above.
 */

const SWING_MS = 320;

type Kit = { root: THREE.Group; right: THREE.Group; left: THREE.Group; restR: number; restL: number };

const mat = (t: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.1, ...extra });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}

/** A gauntleted forearm and fist, the base of every kit. */
function arm(gauntlet: THREE.Material) {
  const g = new THREE.Group();
  g.add(box(0.14, 0.14, 0.42, gauntlet, 0, 0, 0.1), box(0.16, 0.14, 0.14, gauntlet, 0, 0.02, -0.14));
  return g;
}

function knight(): Kit {
  const root = new THREE.Group();
  const gauntlet = mat(solid(0xc8c8cc, 171, 0x8a8a90), { metalness: 0.15 });
  const steel = mat(solid(0xb0b4bc, 172, 0x8a9098), { metalness: 0.15, roughness: 0.4 });
  const right = arm(gauntlet);
  const sword = new THREE.Group();
  sword.add(box(0.04, 0.16, 0.04, mat(planks(0x3a2414, 174)), 0, 0.02, 0));
  sword.add(box(0.26, 0.03, 0.05, mat(solid(0xc89a30, 177, 0xffe080), { metalness: 0.2 }), 0, 0.1, 0));
  sword.add(box(0.1, 0.72, 0.02, steel, 0, 0.47, 0), box(0.02, 0.72, 0.024, mat(solid(0xe8eaf0, 175)), 0, 0.47, 0));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 4), steel);
  tip.position.set(0, 0.9, 0);
  tip.rotation.y = Math.PI / 4;
  tip.scale.z = 0.25;
  sword.add(tip);
  sword.position.set(0, 0, -0.16);
  sword.rotation.set(-0.75, 0, -0.25);
  right.add(sword);
  right.position.set(0.32, -0.32, -0.55);
  right.rotation.set(0.1, -0.2, 0.1);
  const left = arm(gauntlet);
  const shieldT = solid(0x6a4424, 176, 0x8a2018);
  left.add(box(0.34, 0.42, 0.04, mat(shieldT, { metalness: 0 }), 0.04, 0.05, -0.12));
  left.add(box(0.36, 0.03, 0.045, steel, 0.04, 0.27, -0.12), box(0.36, 0.03, 0.045, steel, 0.04, -0.17, -0.12));
  left.position.set(-0.5, -0.42, -0.62);
  left.rotation.set(0.05, 0.55, -0.15);
  root.add(right, left);
  return { root, right, left, restR: 0.1, restL: 0.05 };
}

function rogue(): Kit {
  const root = new THREE.Group();
  const leather = mat(solid(0x3a2a20, 181, 0x1a120c), { metalness: 0 });
  const steel = mat(solid(0xc0c4cc, 182, 0x8a9098), { metalness: 0.15, roughness: 0.35 });
  const dagger = () => {
    const d = new THREE.Group();
    d.add(box(0.035, 0.12, 0.035, mat(planks(0x2a1a10, 183)), 0, 0.02, 0));
    d.add(box(0.14, 0.025, 0.04, steel, 0, 0.08, 0));
    d.add(box(0.06, 0.32, 0.015, steel, 0, 0.25, 0));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.1, 4), steel);
    tip.position.set(0, 0.45, 0);
    tip.rotation.y = Math.PI / 4;
    tip.scale.z = 0.3;
    d.add(tip);
    d.position.set(0, 0, -0.16);
    d.rotation.set(-1.0, 0, 0);
    return d;
  };
  const right = arm(leather);
  right.add(dagger());
  right.position.set(0.3, -0.34, -0.55);
  right.rotation.set(0.1, -0.15, 0.1);
  const left = arm(leather);
  left.add(dagger());
  left.position.set(-0.3, -0.36, -0.56);
  left.rotation.set(0.1, 0.15, -0.1);
  root.add(right, left);
  return { root, right, left, restR: 0.1, restL: 0.1 };
}

function necromancer(): Kit {
  const root = new THREE.Group();
  const sleeve = mat(solid(0x2a1a2e, 191, 0x140a18), { metalness: 0 });
  const bone = mat(solid(0xd8ccae, 192, 0x8a7a5a), { metalness: 0 });
  const right = new THREE.Group();
  right.add(box(0.16, 0.16, 0.42, sleeve, 0, 0, 0.1), box(0.12, 0.1, 0.12, bone, 0, 0.02, -0.14));
  const staff = new THREE.Group();
  staff.add(box(0.05, 1.1, 0.05, mat(planks(0x3a2a1a, 193), { metalness: 0 }), 0, 0.3, 0));
  const skull = box(0.14, 0.14, 0.14, bone, 0, 0.92, 0);
  staff.add(skull);
  const glow = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.05, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.1, 0.5) }),
  );
  glow.position.set(0, 0.92, 0.075);
  staff.add(glow);
  staff.position.set(0, 0, -0.14);
  staff.rotation.set(-0.35, 0, -0.1);
  right.add(staff);
  right.position.set(0.32, -0.42, -0.6);
  right.rotation.set(0.1, -0.2, 0.05);
  const left = new THREE.Group();
  left.add(box(0.16, 0.16, 0.42, sleeve, 0, 0, 0.1), box(0.12, 0.1, 0.12, bone, 0, 0.02, -0.14));
  left.position.set(-0.42, -0.44, -0.62);
  left.rotation.set(0.15, 0.3, -0.1);
  root.add(right, left);
  return { root, right, left, restR: 0.1, restL: 0.15 };
}

const KITS: Record<string, () => Kit> = { knight, rogue, necromancer };

export class HandsView {
  readonly group = new THREE.Group();
  private kit: Kit | null = null;
  private classId = '';
  private swingStart = -1e9;

  /** Shows the kit of a class (a new kit only when the class changes). */
  setClass(classId: string): void {
    if (classId === this.classId) return;
    this.classId = classId;
    if (this.kit) {
      this.group.remove(this.kit.root);
      this.kit.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.kit = (KITS[classId] ?? knight)();
    this.group.add(this.kit.root);
  }

  /** The hero acts: a quick chop with the right hand. */
  swing(now: number): void {
    this.swingStart = now;
  }

  update(now: number, top: number): void {
    const k = this.kit;
    this.group.visible = top < 0.5;
    if (!k) return;
    const s = (now - this.swingStart) / SWING_MS;
    const chop = s >= 0 && s < 1 ? Math.sin(s * Math.PI) : 0;
    const sway = Math.sin(now / 600) * 0.008;
    k.right.rotation.x = k.restR - chop * 1.3;
    k.right.position.y = (k.right.userData.y ??= k.right.position.y) + chop * 0.12 + sway;
    k.left.position.y = (k.left.userData.y ??= k.left.position.y) + Math.sin(now / 600 + 1) * 0.008;
    k.left.rotation.x = k.restL;
  }
}
