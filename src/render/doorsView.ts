import * as THREE from 'three';
import { dirVec } from '../core/grid';
import { getPatron, type RewardKind } from '../content';
import type { GameState } from '../sim';
import { CELL } from './dims';
import { mulberry, planks, solid } from './look/textures';

/** Light colour per reward, so a door reads at a glance (labels add the words). */
export const REWARD_COLORS: Record<RewardKind, number> = {
  ability: 0xffd060,
  modifier: 0x80d0ff,
  upgrade: 0x8aff9a,
  rest: 0xffb0c8,
  elite: 0xff4a3a,
  boss: 0xb070ff,
  initiation: 0xffffff,
  treasure: 0xffa020,
  altar: 0xffffff,
  gold: 0xffc830,
  merchant: 0xff9a40,
  event: 0xc890ff,
};

/** The doorway between the stone posts (look/rooms: posts at ±0.86, 0.28 wide; lintel at 2.3). */
const OPEN_W = 1.44;
const OPEN_H = 2.3;
/** How far the door swings open, away from the room into the passage. */
const OPEN_ANGLE = 1.8;
const OPEN_MS = 1100;
/** At most this many doors are offered at once; their lights always exist (adding lights recompiles shaders). */
const MAX_LIT = 4;
/** The blaze at the end of the passage reaches its vault (the cathedral's is the tallest). */
const GLOW_H = 6;
/** How far the light spills into the room. */
const SPILL = 3.2;

interface DoorRig {
  readonly hinge: THREE.Group;
  /** The hinge's turn when shut. */
  readonly shut: number;
  /** Offered doors: the light behind them and its colour. */
  readonly lit: {
    readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    readonly rays: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    readonly pool: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    readonly light: THREE.PointLight;
    readonly phase: number;
  } | null;
}

/**
 * Soft light: brightest along the middle (u = 0.5) and near the door (v = 0), fading to nothing at
 * every edge, so no shaft or pool ever shows a hard border. The alpha of the rays and the floor pool.
 */
function softTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 64);
  for (let x = 0; x < 64; x++) {
    const across = Math.sin((x / 63) * Math.PI) ** 2;
    for (let y = 0; y < 64; y++) {
      const v = y / 63;
      // A quick rise just past the door (no seam where a shaft starts), then a long fade.
      const along = Math.min(1, v * 8) * (1 - v) ** 1.8;
      const a = Math.round(255 * across * along);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Shafts of light from the doorway (local z = 0, the opening) slanting down into the room (local −z).
 * Each shaft is two crossed strips widening as they go, so it reads as a soft beam from any side.
 * Seeded, so a door always pours the same way.
 */
function raysGeometry(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const pos: number[] = [];
  const uv: number[] = [];
  const quv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  const strip = (from: THREE.Vector3, to: THREE.Vector3, side: THREE.Vector3, w0: number, w1: number) => {
    const corners = [
      from.clone().addScaledVector(side, -w0 / 2),
      from.clone().addScaledVector(side, w0 / 2),
      to.clone().addScaledVector(side, w1 / 2),
      to.clone().addScaledVector(side, -w1 / 2),
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(corners[i]!.x, corners[i]!.y, corners[i]!.z);
      uv.push(quv[i]![0], quv[i]![1]);
    }
  };
  for (let i = 0; i < 9; i++) {
    const from = new THREE.Vector3((r() - 0.5) * (OPEN_W - 0.3), 0.5 + r() * (OPEN_H - 0.7), 0.05);
    // Down and into the room, fanning out a little to the sides.
    const dir = new THREE.Vector3((r() - 0.5) * 0.5, -0.35 - r() * 0.25, -1).normalize();
    const to = from.clone().addScaledVector(dir, SPILL * (0.7 + r() * 0.5));
    const flat = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(flat, dir).normalize();
    const w = 0.25 + r() * 0.35;
    strip(from, to, flat, w, w * 2.4);
    strip(from, to, up, w, w * 2.4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** The patch of light on the floor in front of the door: a trapezoid widening into the room. */
function poolGeometry(): THREE.BufferGeometry {
  const w0 = OPEN_W / 2;
  const w1 = OPEN_W / 2 + 0.9;
  const pos = [-w0, 0, 0, w0, 0, 0, w1, 0, -SPILL, -w0, 0, 0, w1, 0, -SPILL, -w1, 0, -SPILL];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Wooden doors in every doorway, shut while fighting. Once the room is cleared the offered doors
 * swing open and light pours out of them in the colour of what lies behind.
 */
export class DoorsView {
  readonly group = new THREE.Group();
  private readonly leafGeometry = new THREE.BoxGeometry(OPEN_W - 0.04, OPEN_H - 0.03, 0.08);
  private readonly bandGeometry = new THREE.BoxGeometry(OPEN_W - 0.02, 0.07, 0.1);
  private readonly ringGeometry = new THREE.TorusGeometry(0.07, 0.014, 6, 14);
  private readonly glowGeometry = new THREE.PlaneGeometry(CELL, GLOW_H);
  private readonly poolGeo = poolGeometry();
  private readonly raysMap = softTexture();
  private readonly wood = new THREE.MeshStandardMaterial({ map: planks(0x4a2e18, 501), roughness: 0.85 });
  private readonly iron = new THREE.MeshStandardMaterial({
    map: solid(0x3a3634, 502, 0x5a3010),
    roughness: 0.5,
    metalness: 0.3,
  });
  private readonly lights: THREE.PointLight[] = [];
  private doors: DoorRig[] = [];
  private openStart = -1e9;
  private shownKey = '';

  constructor() {
    for (let i = 0; i < MAX_LIT; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 7, 1.4);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  /** Builds the doors of the room; the offered ones open (animated from `now` when they just opened). */
  sync(state: GameState, now = -1e9): void {
    const run = state.run;
    const offers = run?.phase === 'doors' ? run.doors : [];
    const roomKey = `${state.seed}:${run?.act}:${run?.depth}`;
    const key = `${roomKey}:${offers.map((o) => `${o.door}${o.reward}${o.patron ?? ''}`).join(',')}`;
    if (key === this.shownKey) return;
    const sameRoom = this.shownKey.startsWith(`${roomKey}:`);
    this.shownKey = key;
    this.clear();
    // Doors that open while we watch swing; doors already open (a reload) are shown open.
    this.openStart = sameRoom ? now : -1e9;
    let lit = 0;
    for (const [i, door] of state.room.doors.entries()) {
      const offer = offers.find((o) => o.door === i);
      const inward = dirVec(door.dir);
      const out = { x: -inward.x, y: -inward.y };
      const ry = Math.atan2(out.x, out.y);
      // Centre of the doorway, on the face between the room and the door cell.
      const face = new THREE.Vector3((door.x + 0.5 + inward.x * 0.5) * CELL, 0, (door.y + 0.5 + inward.y * 0.5) * CELL);
      const across = new THREE.Vector3(out.y, 0, -out.x); // local +X
      const outV = new THREE.Vector3(out.x, 0, out.y); // local +Z

      const hinge = new THREE.Group();
      hinge.position
        .copy(face)
        .addScaledVector(across, OPEN_W / 2)
        .addScaledVector(outV, 0.06);
      hinge.rotation.y = ry;
      const leaf = new THREE.Mesh(this.leafGeometry, this.wood);
      leaf.position.set(-OPEN_W / 2, OPEN_H / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      hinge.add(leaf);
      for (const y of [0.4, 1.15, 1.9]) {
        const band = new THREE.Mesh(this.bandGeometry, this.iron);
        band.position.set(-OPEN_W / 2, y, 0);
        hinge.add(band);
      }
      const ring = new THREE.Mesh(this.ringGeometry, this.iron);
      ring.position.set(-OPEN_W + 0.22, 1.05, -0.06);
      hinge.add(ring);
      this.group.add(hinge);

      let rig: DoorRig['lit'] = null;
      if (offer && lit < MAX_LIT) {
        const color = new THREE.Color(offer.patron ? getPatron(offer.patron).color : REWARD_COLORS[offer.reward]);
        const additive = (c: THREE.Color, map: THREE.Texture | null) =>
          new THREE.MeshBasicMaterial({
            color: c,
            ...(map ? { alphaMap: map } : {}),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
          });
        // The far end of the passage blazes with light; rays and a pool of it spill into the room.
        const glow = new THREE.Mesh(this.glowGeometry, additive(color.clone().multiplyScalar(1.15), null));
        glow.position
          .copy(face)
          .addScaledVector(outV, CELL * 0.95)
          .setY(GLOW_H / 2);
        glow.rotation.y = ry;
        const rays = new THREE.Mesh(
          raysGeometry(door.x * 31 + door.y * 17),
          additive(color.clone().multiplyScalar(0.45), this.raysMap),
        );
        const pool = new THREE.Mesh(this.poolGeo, additive(color.clone().multiplyScalar(0.7), this.raysMap));
        for (const m of [rays, pool]) {
          m.position.copy(face);
          m.rotation.y = ry;
        }
        pool.position.y = 0.012;
        const light = this.lights[lit]!;
        light.color.copy(color);
        light.position.copy(face).addScaledVector(outV, 0.7).setY(1.4);
        this.group.add(glow, rays, pool);
        rig = { glow, rays, pool, light, phase: lit * 1.9 };
        lit++;
      }
      this.doors.push({ hinge, shut: ry, lit: rig });
    }
  }

  update(now: number): void {
    const t = Math.min(1, Math.max(0, (now - this.openStart) / OPEN_MS));
    // The door gives a little, then swings wide and settles.
    const swing = t < 0.15 ? (t / 0.15) * 0.08 : 0.08 + (1 - (1 - (t - 0.15) / 0.85) ** 3) * 0.92;
    for (const d of this.doors) {
      if (!d.lit) continue;
      d.hinge.rotation.y = d.shut + swing * OPEN_ANGLE;
      const pulse = 0.92 + 0.08 * Math.sin(now / 380 + d.lit.phase);
      const k = swing * pulse;
      d.lit.glow.material.opacity = Math.min(1, swing * 1.4);
      d.lit.rays.material.opacity = 0.9 * k;
      d.lit.pool.material.opacity = 0.8 * k;
      d.lit.light.intensity = 4 * k;
    }
  }

  clear(): void {
    for (const d of this.doors) {
      this.group.remove(d.hinge);
      if (d.lit) {
        this.group.remove(d.lit.glow, d.lit.rays, d.lit.pool);
        d.lit.glow.material.dispose();
        d.lit.rays.geometry.dispose();
        d.lit.rays.material.dispose();
        d.lit.pool.material.dispose();
      }
    }
    for (const l of this.lights) l.intensity = 0;
    this.doors = [];
  }

  dispose(): void {
    this.clear();
    for (const g of [this.leafGeometry, this.bandGeometry, this.ringGeometry, this.glowGeometry, this.poolGeo])
      g.dispose();
    this.raysMap.dispose();
    this.wood.dispose();
    this.iron.dispose();
  }
}
