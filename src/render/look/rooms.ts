import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getCell, type CellType, type Grid } from '../../core/grid';
import { CELL } from '../dims';
import {
  bricks,
  checker,
  flagstones,
  flameTexture,
  mulberry,
  pixelTexture,
  planks,
  releaseTexture,
  repeatTexture,
  skullFace,
  solid,
  stainedGlass,
} from './textures';

/**
 * Rooms in the MV look: textured stone built from the generator's cells, each biome its own place
 * (owner: "only the textures change, the rooms are all the same"). The crypt is low, ribbed, its walls
 * full of burial niches; the catacombs are mossy and damp under stone arches with chains hanging down;
 * the cathedral is tall, with columns, stained glass and light. Gameplay never sees any of this: the
 * cells (floor, wall, pillar, pit, door) are exactly the simulation's.
 */

export interface FirePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RoomLook {
  readonly height: number;
  readonly fog: number;
  readonly fogDensity: number;
  readonly ambient: number;
  readonly ambientGround: number;
  readonly torch: number;
  readonly exposure: number;
  readonly wall: THREE.Texture;
  readonly floor: THREE.Texture;
  readonly ceiling: THREE.Texture;
  readonly trim: THREE.Texture;
  /** What a pit glows with far below. */
  readonly pitGlow: number;
  readonly pillar: 'square' | 'round' | 'column';
  readonly decor: 'niches' | 'chains' | 'windows';
  readonly ribs: 'beams' | 'arches';
}

const looks = new Map<string, RoomLook>();

/** The look of a biome (textures are made once and kept). */
export function roomLook(biome: string): RoomLook {
  const known = looks.get(biome);
  if (known) return known;
  const look: RoomLook =
    biome === 'catacombs'
      ? {
          height: 3.2,
          fog: 0x08120f,
          fogDensity: 0.04,
          ambient: 0x2a4a40,
          ambientGround: 0x0a1410,
          torch: 0xd8e89a,
          exposure: 1.05,
          wall: bricks(0x56665a, 0x1c2420, 11, 1, true),
          floor: flagstones(0x4e5e54, 12),
          ceiling: bricks(0x3a4a40, 0x141c18, 13, 0.5),
          trim: bricks(0x46564a, 0x141c18, 14, 0.5),
          pitGlow: 0x0a3036,
          pillar: 'round',
          decor: 'chains',
          ribs: 'arches',
        }
      : biome === 'cathedral'
        ? {
            height: 5.6,
            fog: 0x1a140e,
            fogDensity: 0.025,
            ambient: 0x5a4c3c,
            ambientGround: 0x1a1208,
            torch: 0xffd890,
            exposure: 0.95,
            wall: bricks(0x9a8e78, 0x4a4234, 21),
            floor: checker(0xa8a092, 0x1e1a18, 22),
            ceiling: bricks(0x8a806c, 0x3a3428, 23),
            trim: bricks(0xa89c86, 0x5a5042, 25),
            pitGlow: 0x3a2a10,
            pillar: 'column',
            decor: 'windows',
            ribs: 'beams',
          }
        : {
            height: 3.0,
            fog: 0x0c0806,
            fogDensity: 0.04,
            ambient: 0x4a3828,
            ambientGround: 0x140c08,
            torch: 0xffa850,
            exposure: 1.05,
            wall: bricks(0x86735e, 0x2a2018, 1),
            floor: flagstones(0x76685a, 2),
            ceiling: bricks(0x5a4c3e, 0x1a1410, 3),
            trim: bricks(0x9a8a72, 0x5a4c3e, 37),
            pitGlow: 0x3a1408,
            pillar: 'square',
            decor: 'niches',
            ribs: 'beams',
          };
  looks.set(biome, look);
  return look;
}

export interface RoomMeshes {
  readonly group: THREE.Group;
  /** Hidden in top view so the camera can see in. */
  readonly ceiling: THREE.Group;
  readonly torches: readonly FirePoint[];
  readonly lights: readonly { light: THREE.PointLight; base: number; phase: number }[];
  /** Redraw the living flames (call every few frames). */
  readonly flicker: () => void;
  dispose(): void;
}

/** Unit of wall and ceiling textures, in metres: 1.5 tiles per cell. */
const UNIT = CELL / 1.5;
const OPEN: readonly CellType[] = ['floor', 'pillar', 'pit', 'door'];
const DOOR_H = 2.3;
const PIT_DEPTH = 1.8;
const SIDES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Builds the meshes of a room. `seed` varies the decoration (which faces get niches, torches…). */
/** A carpet laid from a cell in a direction, as far as the floor goes (the cathedral's boss hall). */
export interface Carpet {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

export function buildRoom(grid: Grid, look: RoomLook, seed: number, carpet: Carpet | null = null): RoomMeshes {
  const group = new THREE.Group();
  const ceiling = new THREE.Group();
  group.add(ceiling);
  const H = look.height;
  const r = mulberry(seed);
  const disposables: { dispose(): void }[] = [];

  // ---- materials, and geometry buckets merged per material at the end ----
  const std = (map: THREE.Texture, color = 0xffffff, roughness = 0.9) => {
    const m = new THREE.MeshStandardMaterial({ map, color, roughness, metalness: 0 });
    disposables.push(m);
    return m;
  };
  const wallM = std(look.wall);
  const floorM = std(look.floor, 0xffffff, 0.8);
  const ceilM = std(look.ceiling);
  const trimM = std(look.trim);
  const pitM = std(look.wall, 0x3a3a3a);
  const darkM = new THREE.MeshBasicMaterial({ color: 0x020101 });
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.pitGlow).multiplyScalar(1.4) });
  disposables.push(darkM, glowM);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const ceilBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (m: THREE.Material, g: THREE.BufferGeometry, inCeiling = false) => {
    const b = inCeiling ? ceilBuckets : buckets;
    if (!b.has(m)) b.set(m, []);
    b.get(m)!.push(g.index ? g.toNonIndexed() : g);
  };
  /** A quad w×h facing +Z, its texture repeated (u, v) times, then placed. */
  const quad = (w: number, h: number, u: number, v: number, at: THREE.Vector3, ry: number, rx = 0) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')));
    g.translate(at.x, at.y, at.z);
    return g;
  };
  const placed = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
    g.rotateY(ry);
    g.translate(x, y, z);
    return g;
  };

  const cell = (x: number, y: number): CellType => getCell(grid, x, y);
  const isOpen = (t: CellType) => OPEN.includes(t);
  const centre = (x: number, y: number) => new THREE.Vector3((x + 0.5) * CELL, 0, (y + 0.5) * CELL);
  /** Turn that makes a +Z quad face along (nx, nz). */
  const facing = (nx: number, nz: number) => Math.atan2(nx, nz);

  const faces: { at: THREE.Vector3; ry: number; nx: number; nz: number; cell: [number, number] }[] = [];

  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      const t = cell(x, y);
      if (!isOpen(t)) continue;
      const c = centre(x, y);
      // Floor, or a pit: a dark well with a glow far below.
      if (t === 'pit') {
        put(glowM, quad(CELL, CELL, 1, 1, c.clone().setY(-PIT_DEPTH), 0, -Math.PI / 2));
      } else put(floorM, quad(CELL, CELL, 1, 1, c, 0, -Math.PI / 2));
      put(ceilM, quad(CELL, CELL, CELL / UNIT, CELL / UNIT, c.clone().setY(H), 0, Math.PI / 2), true);

      for (const [dx, dy] of SIDES) {
        const n = cell(x + dx, y + dy);
        const at = c.clone().add(new THREE.Vector3((dx * CELL) / 2, 0, (dy * CELL) / 2));
        const ry = facing(-dx, -dy);
        // Pit walls going down wherever the neighbour is not a pit.
        if (t === 'pit' && n !== 'pit')
          put(pitM, quad(CELL, PIT_DEPTH, CELL / UNIT, PIT_DEPTH / UNIT, at.clone().setY(-PIT_DEPTH / 2), ry));
        if (isOpen(n)) {
          // Above a doorway opening, seen from the room: the lintel wall and a stone frame.
          if (n === 'door' && t !== 'door') {
            put(wallM, quad(CELL, H - DOOR_H, CELL / UNIT, (H - DOOR_H) / UNIT, at.clone().setY((H + DOOR_H) / 2), ry));
            const inward = new THREE.Vector3(-dx, 0, -dy);
            const side = new THREE.Vector3(dy, 0, -dx);
            for (const s of [-1, 1])
              put(
                trimM,
                placed(
                  new THREE.BoxGeometry(0.28, DOOR_H, 0.24),
                  at.x + side.x * s * 0.86 + inward.x * 0.1,
                  DOOR_H / 2,
                  at.z + side.z * s * 0.86 + inward.z * 0.1,
                  ry,
                ),
              );
            put(
              trimM,
              placed(
                new THREE.BoxGeometry(CELL, 0.3, 0.26),
                at.x + inward.x * 0.1,
                DOOR_H + 0.1,
                at.z + inward.z * 0.1,
                ry,
              ),
            );
          }
          continue;
        }
        // A wall (or the dark end of a passage behind a door).
        if (t === 'door' && n === 'wall' && cell(x - dx, y - dy) !== 'wall' && isOpen(cell(x - dx, y - dy))) {
          put(darkM, quad(CELL, H, 1, 1, at.clone().setY(H / 2), ry));
          continue;
        }
        put(wallM, quad(CELL, H, CELL / UNIT, H / UNIT, at.clone().setY(H / 2), ry));
        if (t !== 'door') faces.push({ at, ry, nx: -dx, nz: -dy, cell: [x, y] });
      }

      if (t === 'pillar') pillar(c);
    }

  function pillar(c: THREE.Vector3) {
    const pm = std(repeatOf(look.trim, 1.5, H / 1.2));
    if (look.pillar === 'square') put(pm, placed(new THREE.BoxGeometry(0.95, H, 0.95), c.x, H / 2, c.z));
    else if (look.pillar === 'round') put(pm, placed(new THREE.CylinderGeometry(0.46, 0.52, H, 12), c.x, H / 2, c.z));
    else {
      put(pm, placed(new THREE.CylinderGeometry(0.42, 0.48, H - 0.8, 14), c.x, (H - 0.8) / 2 + 0.3, c.z));
      put(trimM, placed(new THREE.BoxGeometry(1.15, 0.3, 1.15), c.x, 0.15, c.z));
      put(trimM, placed(new THREE.BoxGeometry(1.15, 0.5, 1.15), c.x, H - 0.25, c.z));
    }
  }

  // ---- ribs and beams across the ceiling (hidden in top view with it) ----
  const width = grid.w * CELL;
  if (look.ribs === 'beams') {
    const beam = std(repeatOf(look.trim, width / UNIT, 0.25));
    for (let y = 1; y < grid.h; y += 2)
      put(beam, placed(new THREE.BoxGeometry(width, 0.32, 0.45), width / 2, H - 0.16, y * CELL), true);
  } else {
    const arch = std(repeatOf(look.trim, 6, 0.3));
    const rad = width / 2 - CELL;
    for (let y = 1; y < grid.h; y += 2) {
      const g = new THREE.TorusGeometry(rad, 0.2, 4, 16, Math.PI);
      g.scale(1, (H * 0.5) / rad, 1);
      put(arch, placed(g, width / 2, H * 0.5, y * CELL), true);
    }
  }

  // ---- decoration on walls: niches, chains, windows; torches ----
  const order = faces.map((f) => ({ f, k: r() })).sort((a, b) => a.k - b.k);
  const torches: FirePoint[] = [];
  const lights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  const flames: { redraw: () => void }[] = [];
  const torchFaces = new Set<number>();
  const maxTorches = Math.min(6, Math.max(4, Math.round(faces.length / 7)));
  for (const { f } of order) {
    if (torches.length >= maxTorches) break;
    // Keep torches apart.
    if (torches.some((t) => Math.hypot(t.x - f.at.x, t.z - f.at.z) < CELL * 2.2)) continue;
    torchFaces.add(faces.indexOf(f));
    const p = { x: f.at.x + f.nx * 0.45, y: 2.0, z: f.at.z + f.nz * 0.45 };
    torches.push(p);
    torch(f.at, f.ry, f.nx, f.nz);
  }

  function torch(at: THREE.Vector3, ry: number, nx: number, nz: number) {
    const iron = std(solid(0x2a2624, 31, 0x4a4440), 0xffffff, 0.6);
    put(iron, placed(new THREE.BoxGeometry(0.12, 0.12, 0.38), at.x + nx * 0.18, 1.75, at.z + nz * 0.18, ry));
    const stick = new THREE.CylinderGeometry(0.05, 0.04, 0.5, 6);
    stick.rotateX(0.35);
    put(std(planks(0x5a3a1e, 32)), placed(stick, at.x + nx * 0.34, 1.95, at.z + nz * 0.34, ry));
    const flame = flameTexture(Math.floor(at.x * 13 + at.z * 7));
    flames.push(flame);
    disposables.push(flame.texture);
    const sm = new THREE.SpriteMaterial({ map: flame.texture, color: new THREE.Color(1.35, 1.1, 0.85), fog: false });
    disposables.push(sm);
    const sprite = new THREE.Sprite(sm);
    sprite.scale.set(0.3, 0.6, 1);
    sprite.position.set(at.x + nx * 0.45, 2.42, at.z + nz * 0.45);
    group.add(sprite);
    // Set off from the wall, or the stone right behind the flame burns white.
    const light = new THREE.PointLight(look.torch, 2.4, 9, 1.6);
    light.position.set(at.x + nx * 1.1, 2.3, at.z + nz * 1.1);
    group.add(light);
    lights.push({ light, base: 2.4, phase: at.x * 1.7 + at.z * 0.9 });
  }

  const free = order.map(({ f }) => f).filter((f) => !torchFaces.has(faces.indexOf(f)));
  if (look.decor === 'niches') {
    const bone = std(solid(0xd8ccae, 35, 0x8a7a5a), 0xffffff, 0.8);
    const skull = std(skullFace(36), 0xffffff, 0.8);
    for (const f of free.slice(0, Math.ceil(free.length * 0.6))) {
      for (const ny of [0.7, 1.55]) {
        put(
          darkM,
          quad(
            1.3,
            0.55,
            1,
            1,
            f.at
              .clone()
              .setY(ny)
              .add(new THREE.Vector3(f.nx * 0.01, 0, f.nz * 0.01)),
            f.ry,
          ),
        );
        if (r() < 0.6) {
          const s = new THREE.BoxGeometry(0.22, 0.22, 0.22);
          const mesh = new THREE.Mesh(s, [bone, bone, bone, bone, skull, bone]);
          mesh.position.set(f.at.x + f.nx * 0.12 + (r() - 0.5) * 0.6, ny - 0.16, f.at.z + f.nz * 0.12);
          mesh.rotation.y = f.ry + (r() - 0.5) * 0.5;
          group.add(mesh);
          disposables.push(s);
        } else
          put(
            bone,
            placed(new THREE.BoxGeometry(0.5, 0.06, 0.06), f.at.x + f.nx * 0.12, ny - 0.24, f.at.z + f.nz * 0.12, f.ry),
          );
      }
    }
  } else if (look.decor === 'windows') {
    const glass = stainedGlass(61);
    const gm = new THREE.MeshBasicMaterial({
      map: glass,
      color: new THREE.Color(1.5, 1.5, 1.5),
      transparent: true,
      fog: false,
    });
    disposables.push(gm);
    let coloured = 0;
    for (const f of free.filter((_, i) => i % 3 === 0)) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.6), gm);
      w.position
        .copy(f.at)
        .setY(H * 0.58)
        .add(new THREE.Vector3(f.nx * 0.02, 0, f.nz * 0.02));
      w.rotation.y = f.ry;
      group.add(w);
      disposables.push(w.geometry);
      if (coloured++ < 3) {
        const l = new THREE.PointLight(0xc0a0ff, 2, 8, 1.4);
        l.position
          .copy(f.at)
          .setY(H * 0.5)
          .add(new THREE.Vector3(f.nx * 1.4, 0, f.nz * 1.4));
        group.add(l);
      }
    }
  } else {
    // Chains hanging from the vault over a few open cells.
    const iron = std(solid(0x2a2c2a, 72, 0x5a3010), 0xffffff, 0.5);
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        if (cell(x, y) !== 'floor' || r() > 0.08) continue;
        const c = centre(x, y);
        for (let i = 0; i < 7; i++)
          put(
            iron,
            placed(new THREE.BoxGeometry(0.05, 0.14, 0.05), c.x + 0.4, H - 0.1 - i * 0.16, c.z - 0.3, i * 0.8),
            true,
          );
      }
  }

  // ---- the cathedral's carpet to the boss (M6c) ----
  if (carpet) {
    const red = std(carpetTexture(), 0xffffff, 0.95);
    let x = carpet.x;
    let y = carpet.y;
    while (cell(x, y) === 'floor' || cell(x, y) === 'pit') {
      if (cell(x, y) === 'floor') {
        const c = centre(x, y).setY(0.008);
        const along = carpet.dx !== 0;
        put(
          red,
          quad(along ? CELL : 1.3, along ? 1.3 : CELL, along ? 1 : 1, 1, c, along ? Math.PI / 2 : 0, -Math.PI / 2),
        );
      }
      x += carpet.dx;
      y += carpet.dy;
    }
  }

  // ---- things on the floor along the walls (MV2): bones and rubble in the crypt, broken pots in the
  // catacombs, fallen masonry and candles in the cathedral; barrels and crates in corners. Kept low and
  // against the wall, clear of where creatures stand.
  {
    const boneM = std(solid(0xd8ccae, 81, 0x8a7a5a), 0xffffff, 0.8);
    const woodM = std(planks(0x5a3a1e, 82), 0xffffff, 0.85);
    const clayM = std(solid(0x8a5a3a, 83, 0x4a2a18), 0xffffff, 0.9);
    const waxM = std(solid(0xd8d0b0, 84, 0xa89870), 0xffffff, 0.7);
    const pageM = std(solid(0xc8bca0, 85, 0x6a5a40, true), 0xffffff, 0.9);
    const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.35) });
    disposables.push(flameM);
    const flat = (g: THREE.BufferGeometry, rx: number, rz: number) => g.rotateX(rx).rotateZ(rz);

    const bones = (x: number, z: number) => {
      for (let i = 0; i < 3; i++)
        put(
          boneM,
          placed(
            flat(new THREE.CylinderGeometry(0.022, 0.026, 0.3 + r() * 0.15, 6), Math.PI / 2, 0),
            x + (r() - 0.5) * 0.4,
            0.03,
            z + (r() - 0.5) * 0.4,
            r() * Math.PI,
          ),
        );
      if (r() < 0.6) put(boneM, placed(new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.9, 1.1), x, 0.09, z, r() * 6));
    };
    const rubble = (x: number, z: number) => {
      for (let i = 0; i < 4; i++) {
        const size = 0.06 + r() * 0.12;
        put(
          trimM,
          placed(
            new THREE.DodecahedronGeometry(size, 0),
            x + (r() - 0.5) * 0.6,
            size * 0.6,
            z + (r() - 0.5) * 0.5,
            r() * 6,
          ),
        );
      }
    };
    const candles = (x: number, z: number) => {
      for (let i = 0; i < 3; i++) {
        const h = 0.08 + r() * 0.18;
        const cx = x + (r() - 0.5) * 0.3;
        const cz = z + (r() - 0.5) * 0.3;
        put(waxM, placed(new THREE.CylinderGeometry(0.03, 0.035, h, 8), cx, h / 2, cz));
        put(flameM, placed(new THREE.ConeGeometry(0.018, 0.06, 6), cx, h + 0.035, cz));
      }
    };
    const pots = (x: number, z: number) => {
      put(clayM, placed(new THREE.CylinderGeometry(0.1, 0.13, 0.32, 10), x, 0.16, z));
      if (r() < 0.7)
        for (let i = 0; i < 3; i++)
          put(
            clayM,
            placed(
              flat(new THREE.BoxGeometry(0.1, 0.12, 0.015), 1.3, r()),
              x + 0.2 + r() * 0.2,
              0.02,
              z + (r() - 0.5) * 0.4,
              r() * 6,
            ),
          );
    };
    const masonry = (x: number, z: number) => {
      put(trimM, placed(new THREE.BoxGeometry(0.45, 0.24, 0.3), x, 0.12, z, r() * 0.8));
      if (r() < 0.6) put(trimM, placed(new THREE.BoxGeometry(0.3, 0.18, 0.22), x + 0.3, 0.09, z + 0.1, r() * 2));
    };
    const pew = (x: number, z: number) => {
      put(woodM, placed(flat(new THREE.BoxGeometry(0.9, 0.05, 0.28), 0, 0.12), x, 0.08, z, r() * 0.6));
      put(woodM, placed(new THREE.BoxGeometry(0.06, 0.2, 0.26), x + 0.3, 0.1, z, r() * 0.6));
    };
    const pages = (x: number, z: number) => {
      for (let i = 0; i < 4; i++)
        put(
          pageM,
          placed(
            flat(new THREE.PlaneGeometry(0.16, 0.22), -Math.PI / 2, 0),
            x + (r() - 0.5) * 0.6,
            0.006 + i * 0.001,
            z + (r() - 0.5) * 0.5,
            r() * 6,
          ),
        );
    };
    const kinds =
      look.decor === 'niches'
        ? [bones, bones, rubble, candles]
        : look.decor === 'chains'
          ? [rubble, pots, pots, bones]
          : [masonry, candles, pew, pages];

    for (const f of faces) {
      const [cx, cy] = f.cell;
      if (cell(cx, cy) !== 'floor' || r() > 0.22) continue;
      // Along the wall, a little off the middle of the face.
      const along = (r() - 0.5) * 1.1;
      const x = f.at.x + f.nx * 0.32 + -f.nz * along;
      const z = f.at.z + f.nz * 0.32 + f.nx * along;
      kinds[Math.floor(r() * kinds.length)]!(x, z);
    }

    // Corners: a barrel or a stack of crates.
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        if (cell(x, y) !== 'floor' || r() > 0.3) continue;
        const wx = cell(x - 1, y) === 'wall' ? -1 : cell(x + 1, y) === 'wall' ? 1 : 0;
        const wz = cell(x, y - 1) === 'wall' ? -1 : cell(x, y + 1) === 'wall' ? 1 : 0;
        if (!wx || !wz) continue;
        const c = centre(x, y);
        const px = c.x + wx * 0.68;
        const pz = c.z + wz * 0.68;
        if (r() < 0.5) {
          put(woodM, placed(new THREE.CylinderGeometry(0.24, 0.24, 0.62, 12), px, 0.31, pz));
          put(trimM, placed(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 12), px, 0.5, pz));
          put(trimM, placed(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 12), px, 0.12, pz));
        } else {
          put(woodM, placed(new THREE.BoxGeometry(0.46, 0.46, 0.46), px, 0.23, pz, r() * 0.4));
          if (r() < 0.5) put(woodM, placed(new THREE.BoxGeometry(0.34, 0.34, 0.34), px, 0.63, pz, r()));
        }
      }
  }

  // ---- merge buckets ----
  const merge = (b: Map<THREE.Material, THREE.BufferGeometry[]>, into: THREE.Group) => {
    for (const [m, list] of b) {
      const g = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      if (!g) continue;
      disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      mesh.castShadow = m !== floorM && m !== glowM && m !== darkM;
      into.add(mesh);
    }
  };
  merge(buckets, group);
  merge(ceilBuckets, ceiling);

  return {
    group,
    ceiling,
    torches,
    lights,
    flicker: () => {
      for (const f of flames) f.redraw();
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };

  function repeatOf(t: THREE.Texture, u: number, v: number) {
    const c = repeatTexture(t, u, v);
    disposables.push({ dispose: () => releaseTexture(c) });
    return c;
  }
}

/** A worn red carpet with a gold border along its length. */
function carpetTexture() {
  return pixelTexture(32, 32, 611, (g, r) => {
    g.fillStyle = '#5a0e10';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#c89a30';
    g.fillRect(2, 0, 1.5, 32);
    g.fillRect(28.5, 0, 1.5, 32);
    g.fillStyle = '#3a0608';
    for (let i = 0; i < 40; i++) g.fillRect(4 + r() * 24, r() * 32, 1 + r() * 2, 0.5);
    g.fillStyle = '#7a2018';
    for (let y = 4; y < 32; y += 8) g.fillRect(14, y, 4, 4);
  });
}
