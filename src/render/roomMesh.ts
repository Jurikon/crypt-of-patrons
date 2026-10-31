import * as THREE from 'three';
import { DIRS, dirVec, getCell, type CellType, type Dir } from '../core/grid';
import type { Room } from '../sim';
import type { RoomTextures } from './textures';

/** World units per grid cell. Cell (x, y) spans [x*CELL, (x+1)*CELL] on X and the same on Z. */
export const CELL = 2;
export const WALL_H = 2.6;
export const PIT_DEPTH = 3;
const WALL_REPEAT = WALL_H / CELL;

type V3 = [number, number, number];

/** Accumulates quads into flat arrays, then builds one BufferGeometry (one draw call per material). */
class QuadBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];

  /**
   * Quad from origin `o` spanned by edges `u` and `v`; the face normal is u × v.
   * `uvScale` maps the edges to texture repeats; `shades` are vertex brightness at o, o+u, o+u+v, o+v.
   */
  quad(o: V3, u: V3, v: V3, uvScale: [number, number], shades: [number, number, number, number] = [1, 1, 1, 1]): void {
    const p0 = o;
    const p1: V3 = [o[0] + u[0], o[1] + u[1], o[2] + u[2]];
    const p2: V3 = [p1[0] + v[0], p1[1] + v[1], p1[2] + v[2]];
    const p3: V3 = [o[0] + v[0], o[1] + v[1], o[2] + v[2]];
    const n = new THREE.Vector3(...u).cross(new THREE.Vector3(...v)).normalize();
    const [su, sv] = uvScale;
    const verts: [V3, number, number, number][] = [
      [p0, 0, 0, shades[0]],
      [p1, su, 0, shades[1]],
      [p2, su, sv, shades[2]],
      [p0, 0, 0, shades[0]],
      [p2, su, sv, shades[2]],
      [p3, 0, sv, shades[3]],
    ];
    for (const [p, tu, tv, s] of verts) {
      this.pos.push(...p);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(tu, tv);
      this.col.push(s, s, s);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const isSolid = (t: CellType) => t === 'wall' || t === 'door';
const isOpen = (t: CellType) => t === 'floor' || t === 'pillar' || t === 'pit';

/**
 * A vertical face on the side of cell (x, y) that borders direction `d`, facing back into the cell.
 * Texture v runs bottom→top.
 */
function sideFace(
  b: QuadBuilder,
  x: number,
  y: number,
  d: Dir,
  y0: number,
  y1: number,
  vRepeat: number,
  shadeBottom: number,
  shadeTop: number,
): void {
  const x0 = x * CELL;
  const x1 = (x + 1) * CELL;
  const z0 = y * CELL;
  const z1 = (y + 1) * CELL;
  const h = y1 - y0;
  const v: V3 = [0, h, 0];
  const s: [number, number, number, number] = [shadeBottom, shadeBottom, shadeTop, shadeTop];
  // u × (0,1,0) must point back into the cell.
  switch (d) {
    case 0: // neighbour to the north (−Z): face at z0, normal +Z
      b.quad([x0, y0, z0], [CELL, 0, 0], v, [1, vRepeat], s);
      break;
    case 2: // south: face at z1, normal −Z
      b.quad([x1, y0, z1], [-CELL, 0, 0], v, [1, vRepeat], s);
      break;
    case 3: // west (−X): face at x0, normal +X
      b.quad([x0, y0, z1], [0, 0, -CELL], v, [1, vRepeat], s);
      break;
    case 1: // east: face at x1, normal −X
      b.quad([x1, y0, z0], [0, 0, CELL], v, [1, vRepeat], s);
      break;
  }
}

export interface RoomMeshes {
  readonly group: THREE.Group;
  /** Hidden in top view so the camera can see in. */
  readonly ceiling: THREE.Mesh;
  dispose(): void;
}

export function buildRoomMeshes(room: Room, tex: RoomTextures): RoomMeshes {
  const g = room.grid;
  const walls = new QuadBuilder();
  const floors = new QuadBuilder();
  const ceilings = new QuadBuilder();
  const doors = new QuadBuilder();
  const pits = new QuadBuilder();
  const pitBottoms = new QuadBuilder();

  // Ambient occlusion: a floor corner darkens with each solid cell touching it.
  const cornerShade = (cx: number, cy: number) => {
    let solid = 0;
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      if (isSolid(getCell(g, cx + dx, cy + dy))) solid++;
    }
    return 1 - solid * 0.18;
  };

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const t = getCell(g, x, y);
      if (!isOpen(t)) continue;
      const x0 = x * CELL;
      const z0 = y * CELL;

      if (t !== 'pit') {
        floors.quad(
          [x0, 0, z0],
          [0, 0, CELL],
          [CELL, 0, 0],
          [1, 1],
          [cornerShade(x, y), cornerShade(x, y + 1), cornerShade(x + 1, y + 1), cornerShade(x + 1, y)],
        );
      } else {
        pitBottoms.quad([x0, -PIT_DEPTH, z0], [0, 0, CELL], [CELL, 0, 0], [1, 1], [0.15, 0.15, 0.15, 0.15]);
      }
      ceilings.quad([x0, WALL_H, z0], [CELL, 0, 0], [0, 0, CELL], [1, 1], [0.6, 0.6, 0.6, 0.6]);

      for (const d of DIRS) {
        const v = dirVec(d);
        const n = getCell(g, x + v.x, y + v.y);
        if (n === 'wall') {
          const bottom = t === 'pit' ? -PIT_DEPTH : 0;
          sideFace(walls, x, y, d, bottom, WALL_H, (WALL_H - bottom) / CELL, t === 'pit' ? 0.1 : 0.7, 1);
        } else if (n === 'door') {
          sideFace(doors, x, y, d, 0, WALL_H, 1, 0.8, 1);
          if (t === 'pit') sideFace(pits, x, y, d, -PIT_DEPTH, 0, PIT_DEPTH / CELL, 0.05, 0.8);
        } else if (t === 'pit' && n !== 'pit') {
          sideFace(pits, x, y, d, -PIT_DEPTH, 0, PIT_DEPTH / CELL, 0.05, 0.8);
        }
      }
    }
  }

  const lambert = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
  const materials = {
    wall: lambert(tex.wall),
    floor: lambert(tex.floor),
    ceiling: lambert(tex.ceiling),
    door: lambert(tex.door),
    pit: lambert(tex.pit),
    pitBottom: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    pillar: new THREE.MeshLambertMaterial({ map: tex.wall }),
  };

  const group = new THREE.Group();
  const meshes = [
    new THREE.Mesh(walls.build(), materials.wall),
    new THREE.Mesh(floors.build(), materials.floor),
    new THREE.Mesh(doors.build(), materials.door),
    new THREE.Mesh(pits.build(), materials.pit),
    new THREE.Mesh(pitBottoms.build(), materials.pitBottom),
  ];
  const ceiling = new THREE.Mesh(ceilings.build(), materials.ceiling);
  meshes.push(ceiling);
  for (const m of meshes) group.add(m);

  // Pillars: one instanced octagonal column.
  const pillarCells: { x: number; y: number }[] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) if (getCell(g, x, y) === 'pillar') pillarCells.push({ x, y });
  const pillarGeo = new THREE.CylinderGeometry(CELL * 0.3, CELL * 0.36, WALL_H, 8, 1, true);
  // Repeat the brick texture around the column a few times.
  const uv = pillarGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * WALL_REPEAT);
  let pillars: THREE.InstancedMesh | null = null;
  if (pillarCells.length > 0) {
    pillars = new THREE.InstancedMesh(pillarGeo, materials.pillar, pillarCells.length);
    const m = new THREE.Matrix4();
    pillarCells.forEach((c, i) => {
      m.makeTranslation((c.x + 0.5) * CELL, WALL_H / 2, (c.y + 0.5) * CELL);
      pillars!.setMatrixAt(i, m);
    });
    pillars.instanceMatrix.needsUpdate = true;
    group.add(pillars);
  }

  return {
    group,
    ceiling,
    dispose: () => {
      for (const m of meshes) m.geometry.dispose();
      pillarGeo.dispose();
      pillars?.dispose();
      for (const mat of Object.values(materials)) mat.dispose();
    },
  };
}
