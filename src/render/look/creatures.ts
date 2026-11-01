import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONES, type Bone, type MatSpec, type Part, type PropSpec } from './creatureKit';
import { bricks, planks, solid } from './textures';

/**
 * Turns creature and prop specs (creatureKit) into meshes. Geometry is merged per bone and material
 * and shared by every unit of a kind; materials are per unit, so a hit can flash one unit alone.
 */

/** One bone's meshes: shared geometry, the material key it is drawn with. */
interface BonePiece {
  readonly geo: THREE.BufferGeometry;
  readonly mat: string;
}

const SEGMENTS = 10;

function shapeGeometry(p: Part): THREE.BufferGeometry {
  const [a, b, c] = p.size;
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(a, b, c);
    case 'cyl':
      return new THREE.CylinderGeometry(a, c, b, SEGMENTS);
    case 'cone':
      return new THREE.ConeGeometry(a, b, SEGMENTS);
    case 'sphere':
      return new THREE.SphereGeometry(1, SEGMENTS + 2, SEGMENTS).scale(a, b, c);
    case 'ring':
      return new THREE.TorusGeometry(a, b, 6, Math.max(8, Math.round((c / (Math.PI * 2)) * 28)), c);
  }
}

const pieceCache = new Map<string, Map<Bone, BonePiece[]>>();

/** Geometry of each bone, merged per material, cached by kind. */
export function bonePieces(id: string, spec: PropSpec): Map<Bone, BonePiece[]> {
  const cached = pieceCache.get(id);
  if (cached) return cached;
  const out = new Map<Bone, BonePiece[]>();
  for (const bone of BONES) {
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    for (const p of spec.parts) {
      if (p.bone !== bone) continue;
      const g = shapeGeometry(p);
      if (p.rot) g.rotateX(p.rot[0]).rotateY(p.rot[1]).rotateZ(p.rot[2]);
      g.translate(p.at[0], p.at[1], p.at[2]);
      // Merging needs the same attributes everywhere.
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      const list = byMat.get(p.mat) ?? [];
      list.push(flat);
      byMat.set(p.mat, list);
    }
    const pieces: BonePiece[] = [];
    for (const [mat, list] of byMat) {
      const geo = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      if (geo) pieces.push({ geo, mat });
    }
    if (pieces.length) out.set(bone, pieces);
  }
  pieceCache.set(id, out);
  return out;
}

const textureCache = new Map<string, THREE.Texture>();

function textureFor(key: string, m: MatSpec, seed: number): THREE.Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const t =
    m.pattern === 'planks'
      ? planks(m.color, seed)
      : m.pattern === 'stone'
        ? bricks(m.color, 0x2a2420, seed)
        : solid(m.color, seed, m.spots ?? null, m.stripes ?? false);
  textureCache.set(key, t);
  return t;
}

let seedCounter = 300;

/** A fresh material for a spec material (textures are shared between units). */
export function makeMaterial(kind: string, name: string, m: MatSpec): THREE.Material {
  const key = `${kind}.${name}`;
  if (m.glow) return new THREE.MeshBasicMaterial({ color: new THREE.Color(m.color).multiplyScalar(2.2) });
  const seed = textureCache.has(key) ? 0 : seedCounter++;
  return new THREE.MeshStandardMaterial({
    map: textureFor(key, m, seed),
    roughness: m.rough ?? 0.8,
    metalness: m.metal ?? 0,
  });
}

/** A static prop (corpse, trap) as one group; its materials are returned for disposal. */
export function buildProp(id: string, spec: PropSpec): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const materials = new Map<string, THREE.Material>();
  for (const piece of bonePieces(`prop.${id}`, spec).get('body') ?? []) {
    let m = materials.get(piece.mat);
    if (!m) {
      m = makeMaterial(`prop.${id}`, piece.mat, spec.mats[piece.mat]!);
      materials.set(piece.mat, m);
    }
    const mesh = new THREE.Mesh(piece.geo, m);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, materials: [...materials.values()] };
}
