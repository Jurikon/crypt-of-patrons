import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toGeometry } from './caveMesh';
import { createVolume, greedyMesh, setVoxel } from './voxel/mesher';
import type { ModelVoxel, VoxelModel } from './voxel/models';

/** Outline shell thickness: each surface voxel gets a dark back-faced cube this much larger. */
const OUTLINE_SCALE = 1.16;

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
function buildPart(voxels: readonly ModelVoxel[], model: VoxelModel, yCentred: boolean): PartGeometry {
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

  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const filled = new Set(voxels.map(([x, y, z]) => key(x, y, z)));
  const boxes: THREE.BufferGeometry[] = [];
  const parts: { pos: THREE.Vector3; color: THREE.Color }[] = [];
  for (const [x, y, z, c] of voxels) {
    const centre = new THREE.Vector3(x * s, (y + 0.5 + yShift) * s, z * s);
    const rgb = model.palette[c] ?? [1, 0, 1];
    parts.push({ pos: centre, color: new THREE.Color(rgb[0], rgb[1], rgb[2]) });
    const surface =
      !filled.has(key(x + 1, y, z)) ||
      !filled.has(key(x - 1, y, z)) ||
      !filled.has(key(x, y + 1, z)) ||
      !filled.has(key(x, y - 1, z)) ||
      !filled.has(key(x, y, z + 1)) ||
      !filled.has(key(x, y, z - 1));
    if (!surface) continue;
    const b = new THREE.BoxGeometry(s * OUTLINE_SCALE, s * OUTLINE_SCALE, s * OUTLINE_SCALE);
    b.deleteAttribute('uv');
    b.translate(centre.x, centre.y, centre.z);
    boxes.push(b);
  }
  const outline = mergeGeometries(boxes) ?? new THREE.BufferGeometry();
  for (const b of boxes) b.dispose();
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
