import * as THREE from 'three';
import type { FirePoint } from './look/rooms';

/**
 * Particles: floating embers, brazier flames, lava splashes and dust, all drawn as tiny cubes
 * in one instanced mesh. Colours above 1 glow through the bloom pass. Purely cosmetic, so it may use
 * Math.random.
 */

const CAPACITY = 900;
const EMBERS = 80;
const FLAMES_PER_BRAZIER = 16;
const GRAVITY = -9;

interface Ember {
  x: number;
  y: number;
  z: number;
  vy: number;
  ph: number;
}

interface Flame {
  base: FirePoint;
  ox: number;
  oz: number;
  life: number;
  speed: number;
}

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  start: number;
  dur: number;
  size: number;
  color: THREE.Color;
  /** Bounces on the floor (debris) instead of falling through (sparks). */
  floor: number | null;
  gravity: number;
}

interface Arrow {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  dur: number;
  mesh: THREE.Mesh;
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshBasicMaterial({ fog: false });
  private readonly arrowGeo = new THREE.BoxGeometry(0.035, 0.035, 0.55);
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.1, 0.7) });
  private embers: Ember[] = [];
  private flames: Flame[] = [];
  private bits: Bit[] = [];
  private arrows: Arrow[] = [];
  private spawnCells: THREE.Vector3[] = [];
  private cellSize = 2;
  private lastNow = 0;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  enabled = true;

  constructor() {
    this.mesh = new THREE.InstancedMesh(this.box, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  /** New room: embers drift over the open cells, flames burn in the braziers. */
  setRoom(openCells: THREE.Vector3[], cellSize: number, braziers: readonly FirePoint[]): void {
    this.spawnCells = openCells;
    this.cellSize = cellSize;
    this.embers = [];
    for (let i = 0; i < EMBERS && openCells.length > 0; i++) {
      const e = this.newEmber();
      e.y = Math.random() * 2.4;
      this.embers.push(e);
    }
    this.flames = [];
    for (const b of braziers)
      for (let i = 0; i < FLAMES_PER_BRAZIER; i++) {
        const f = this.newFlame(b);
        f.life = Math.random();
        this.flames.push(f);
      }
    this.bits = [];
    for (const a of this.arrows) this.group.remove(a.mesh);
    this.arrows = [];
  }

  private newEmber(): Ember {
    const cell = this.spawnCells[Math.floor(Math.random() * this.spawnCells.length)] as THREE.Vector3;
    return {
      x: cell.x + (Math.random() - 0.5) * this.cellSize,
      y: Math.random() * 0.3,
      z: cell.z + (Math.random() - 0.5) * this.cellSize,
      vy: 0.12 + Math.random() * 0.18,
      ph: Math.random() * 6.28,
    };
  }

  private newFlame(base: FirePoint): Flame {
    return {
      base,
      ox: (Math.random() - 0.5) * 0.22,
      oz: (Math.random() - 0.5) * 0.22,
      life: 0,
      speed: 1.1 + Math.random() * 0.8,
    };
  }

  /** A burst of sparks, e.g. when something falls into lava. */
  splash(at: THREE.Vector3, now: number, count = 40): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 2.2;
      this.bits.push({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: Math.cos(a) * s * 0.6,
        vy: 2 + Math.random() * 3.5,
        vz: Math.sin(a) * s * 0.6,
        start: now,
        dur: 600 + Math.random() * 700,
        size: 0.05 + Math.random() * 0.06,
        color: new THREE.Color(2.2, 0.7 + Math.random() * 0.6, 0.12),
        floor: null,
        gravity: GRAVITY,
      });
    }
  }

  /** A puff of dust and bone chips where a creature falls apart. */
  dust(at: THREE.Vector3, now: number, count = 26): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.3 + Math.random() * 1.2;
      const k = 0.35 + Math.random() * 0.3;
      this.bits.push({
        x: at.x + Math.cos(a) * 0.2,
        y: at.y + Math.random() * 0.8,
        z: at.z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * s,
        vy: 0.4 + Math.random() * 1.6,
        vz: Math.sin(a) * s,
        start: now,
        dur: 700 + Math.random() * 600,
        size: 0.03 + Math.random() * 0.04,
        color: new THREE.Color(k, k * 0.9, k * 0.75),
        floor: 0,
        gravity: GRAVITY,
      });
    }
  }

  /** An arrow flying from an archer to where its shot lands. */
  arrow(from: THREE.Vector3, to: THREE.Vector3, now: number, dur: number): void {
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    this.group.add(mesh);
    this.arrows.push({ from, to, start: now, dur, mesh });
  }

  update(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const t = now / 1000;
    let n = 0;
    const put = (x: number, y: number, z: number, s: number, color: THREE.Color) => {
      if (n >= CAPACITY) return;
      this.m.makeScale(s, s, s).setPosition(x, y, z);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, color);
      n++;
    };

    if (this.enabled) {
      for (let i = 0; i < this.embers.length; i++) {
        let e = this.embers[i] as Ember;
        e.y += e.vy * dt;
        e.x += Math.sin(t * 0.7 + e.ph) * 0.004;
        if (e.y > 2.5) e = this.embers[i] = this.newEmber();
        const tw = 0.6 + 0.4 * Math.sin(t * 4 + e.ph);
        const fade = Math.min(1, (2.5 - e.y) * 2);
        put(e.x, e.y, e.z, 0.022, this.c.setRGB(1.25 * tw * fade, 0.85 * tw * fade, 0.28 * tw * fade));
      }
      for (let i = 0; i < this.flames.length; i++) {
        let f = this.flames[i] as Flame;
        f.life += dt * f.speed;
        if (f.life >= 1) f = this.flames[i] = this.newFlame(f.base);
        const shrink = 1 - f.life * 0.7;
        const s = (1 - f.life) * 0.12 + 0.025;
        put(
          f.base.x + f.ox * shrink,
          f.base.y + f.life * 0.45,
          f.base.z + f.oz * shrink,
          s,
          this.c.setRGB(2.4, Math.max(0.2, 1.5 - f.life * 1.3), Math.max(0, 0.5 - f.life * 0.8)),
        );
      }
    }

    this.bits = this.bits.filter((b) => now - b.start < b.dur);
    for (const b of this.bits) {
      b.vy += b.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.floor !== null && b.y < b.floor + b.size / 2) {
        b.y = b.floor + b.size / 2;
        b.vy = Math.abs(b.vy) * 0.3;
        b.vx *= 0.6;
        b.vz *= 0.6;
      }
      const age = (now - b.start) / b.dur;
      const s = b.size * (age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1);
      put(b.x, b.y, b.z, s, b.color);
    }

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.arrows = this.arrows.filter((a) => {
      const k = (now - a.start) / a.dur;
      if (k >= 1) {
        this.group.remove(a.mesh);
        return false;
      }
      a.mesh.position.copy(a.from).lerp(a.to, Math.max(0, k));
      a.mesh.lookAt(a.to);
      return true;
    });
  }

  /** True while something that gameplay waits for is in flight (arrows). Debris never blocks. */
  isBusy(now: number): boolean {
    return this.arrows.some((a) => now - a.start < a.dur);
  }

  dispose(): void {
    this.mesh.dispose();
    this.box.dispose();
    this.material.dispose();
    this.arrowGeo.dispose();
    this.arrowMat.dispose();
  }
}
