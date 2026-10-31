import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toGeometry } from './caveMesh';
import { createVolume, greedyMesh, setVoxel } from './voxel/mesher';
import type { ModelVoxel, PropModel, VoxelModel } from './voxel/models';

/** Outline thickness as a fraction of a voxel. */
const OUTLINE = 0.3;

/**
 * Silhouette outline: every visible face pushed out along its normal and grown a little in its plane,
 * drawn back-faced. Faces towards the camera are culled, so only a thin rim shows around the edges;
 * nothing pokes through between voxels the way per-voxel enlarged cubes did.
 */
function outlineFrom(mesh: THREE.BufferGeometry, d: number): THREE.BufferGeometry {
  const pos = mesh.getAttribute('position') as THREE.BufferAttribute;
  const nrm = mesh.getAttribute('normal') as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  for (let q = 0; q < pos.count; q += 4) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 4; k++) {
      cx += pos.getX(q + k) / 4;
      cy += pos.getY(q + k) / 4;
      cz += pos.getZ(q + k) / 4;
    }
    for (let k = 0; k < 4; k++) {
      const i = q + k;
      const nx = nrm.getX(i);
      const ny = nrm.getY(i);
      const nz = nrm.getZ(i);
      const grow = (v: number, c: number, n: number) => (n !== 0 ? n * d : Math.sign(v - c) * d);
      out[i * 3] = pos.getX(i) + grow(pos.getX(i), cx, nx);
      out[i * 3 + 1] = pos.getY(i) + grow(pos.getY(i), cy, ny);
      out[i * 3 + 2] = pos.getZ(i) + grow(pos.getZ(i), cz, nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setIndex(mesh.getIndex());
  g.computeBoundingSphere();
  return g;
}

export interface PartGeometry {
  readonly mesh: THREE.BufferGeometry;
  readonly outline: THREE.BufferGeometry;
  /** Voxel centres (part space) and colours, used to shatter the model on death. */
  readonly voxels: readonly { pos: THREE.Vector3; color: THREE.Color }[];
}

export interface ModelGeometry {
  readonly model: VoxelModel;
  readonly body: PartGeometry;
  readonly arm: PartGeometry;
  readonly eyes: THREE.BufferGeometry;
  /** Shoulder position in body space. */
  readonly pivot: THREE.Vector3;
}

/**
 * Builds one part. `yCentred` puts voxel y at [y−½, y+½] (arm, around its pivot) instead of [y, y+1]
 * (body, standing on y = 0). X and Z are always centred.
 */
function buildPart(
  voxels: readonly ModelVoxel[],
  model: Pick<VoxelModel, 'voxel' | 'palette'>,
  yCentred: boolean,
): PartGeometry {
  const s = model.voxel;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of voxels) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const vol = createVolume(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1);
  for (const [x, y, z, c] of voxels) setVoxel(vol, x - minX, y - minY, z - minZ, c);
  const yShift = yCentred ? -0.5 : 0;
  const offset = new THREE.Vector3((minX - 0.5) * s, (minY + yShift) * s, (minZ - 0.5) * s);
  const data = greedyMesh(vol, { include: (v) => v > 0, occludes: (v) => v > 0, outside: false });
  const mesh = toGeometry(data, s, offset, (v) => model.palette[v] ?? [1, 0, 1]);

  const parts = voxels.map(([x, y, z, c]) => {
    const rgb = model.palette[c] ?? [1, 0, 1];
    return {
      pos: new THREE.Vector3(x * s, (y + 0.5 + yShift) * s, z * s),
      color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
    };
  });
  const outline = outlineFrom(mesh, OUTLINE * s);
  return { mesh, outline, voxels: parts };
}

const cache = new Map<VoxelModel, ModelGeometry>();

/** Geometry for a model, built once and shared by every unit that uses it. */
export function modelGeometry(model: VoxelModel): ModelGeometry {
  const hit = cache.get(model);
  if (hit) return hit;
  const s = model.voxel;
  const body = buildPart(model.body, model, false);
  const arm = buildPart(model.arm.voxels, model, true);
  const eyeBoxes = model.eyes.map(([x, y, z]) =>
    new THREE.BoxGeometry(s * 1.05, s * 1.05, s * 1.05).translate(x * s, (y + 0.5) * s, z * s + s * 0.05),
  );
  const eyes = mergeGeometries(eyeBoxes) ?? new THREE.BufferGeometry();
  const [px, py, pz] = model.arm.pivot;
  const g: ModelGeometry = { model, body, arm, eyes, pivot: new THREE.Vector3(px * s, (py + 0.5) * s, pz * s) };
  cache.set(model, g);
  return g;
}

export interface PropGeometry {
  readonly mesh: THREE.BufferGeometry;
  readonly outline: THREE.BufferGeometry;
  /** Glowing voxels (vertex colours above 1 feed the bloom), or null. */
  readonly glow: THREE.BufferGeometry | null;
}

const propCache = new Map<PropModel, PropGeometry>();

/** Geometry for a floor prop, built once and shared. */
export function propGeometry(prop: PropModel): PropGeometry {
  const hit = propCache.get(prop);
  if (hit) return hit;
  const solid = prop.voxels.filter((v) => !prop.glow.includes(v[3]));
  const glowing = prop.voxels.filter((v) => prop.glow.includes(v[3]));
  const body = buildPart(solid, prop, false);
  const g: PropGeometry = {
    mesh: body.mesh,
    outline: body.outline,
    glow: glowing.length ? buildPart(glowing, prop, false).mesh : null,
  };
  propCache.set(prop, g);
  return g;
}
