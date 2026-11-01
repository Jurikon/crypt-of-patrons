import * as THREE from 'three';
import { VS } from './dims';
import { toonMaterial } from './toon';
import { J_MIN, type Cave } from './voxel/cave';
import { greedyMesh, type MeshData } from './voxel/mesher';
import { lookOf, type BiomeLook } from './biomeLook';
import { colorOf, isCeiling, isLava, isRockLike, LAVA_CRACK } from './voxel/palette';

/** Converts mesher output (voxel units) to a world-space geometry with per-vertex colours. */
export function toGeometry(m: MeshData, scale: number, offset: THREE.Vector3, color: (v: number) => readonly number[]) {
  const pos = new Float32Array(m.positions.length);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (m.positions[i] as number) * scale + offset.x;
    pos[i + 1] = (m.positions[i + 1] as number) * scale + offset.y;
    pos[i + 2] = (m.positions[i + 2] as number) * scale + offset.z;
  }
  const col = new Float32Array(m.values.length * 3);
  for (let i = 0; i < m.values.length; i++) {
    const c = color(m.values[i] as number);
    col[i * 3] = c[0] as number;
    col[i * 3 + 1] = c[1] as number;
    col[i * 3 + 2] = c[2] as number;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

// Lava: bright, slowly churning colour per voxel cell, computed from world position so that merged
// quads still look voxel by voxel. Values above 1 feed the bloom pass.
const LAVA_VERTEX = /* glsl */ `
  attribute vec3 color;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vKind;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normal;
    vKind = color.r;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const LAVA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uVoxel;
  uniform float uGlow;
  uniform vec3 uGlowBase;
  uniform vec3 uGlowWave;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vKind;
  #include <fog_pars_fragment>
  float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 cell = floor((vWorld - vNormal * 0.01) / uVoxel);
    float ph = h(cell) * 6.2831;
    float k;
    if (vKind > 0.5) {
      // Wall crack: slow pulse travelling up the vein.
      k = 0.5 + 0.5 * sin(uTime * 1.6 - cell.y * 0.55 + ph * 0.3);
    } else {
      // Pool: two drifting waves plus per-voxel flicker.
      k = 0.5 + 0.25 * sin(uTime * 0.9 + cell.x * 0.35 + cell.z * 0.2) + 0.25 * sin(uTime * 1.5 + ph);
    }
    // Red above 1 makes lava bloom while the clamped on-screen colour stays orange, not yellow.
    vec3 c = (uGlowBase + uGlowWave * vec3(k, k, k * k)) * uGlow * (vKind > 0.5 ? 0.9 : 1.0);
    gl_FragColor = vec4(c, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

export interface CaveMeshes {
  readonly group: THREE.Group;
  /** Hidden in top view so the camera can see in. */
  readonly ceiling: THREE.Mesh;
  readonly lavaMaterial: THREE.ShaderMaterial;
  dispose(): void;
}

export function buildCaveMeshes(cave: Cave, look: BiomeLook = lookOf('crypt')): CaveMeshes {
  const vol = cave.volume;
  const offset = new THREE.Vector3(0, J_MIN * VS, 0);
  const rockOcc = (v: number) => isRockLike(v) || isLava(v);
  const rock = greedyMesh(vol, { include: isRockLike, occludes: rockOcc });
  const ceil = greedyMesh(vol, { include: isCeiling, occludes: (v) => v > 0 });
  const lava = greedyMesh(vol, { include: isLava, occludes: (v) => v > 0 });

  const rockMat = toonMaterial();
  const lavaMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uVoxel: { value: VS },
        uGlow: { value: 1 },
        uGlowBase: { value: new THREE.Vector3(...look.glowBase) },
        uGlowWave: { value: new THREE.Vector3(...look.glowWave) },
      },
    ]),
    vertexShader: LAVA_VERTEX,
    fragmentShader: LAVA_FRAGMENT,
    fog: true,
  });

  const stone = (v: number) => look.stone(colorOf(v));
  const rockMesh = new THREE.Mesh(toGeometry(rock, VS, offset, stone), rockMat);
  const ceiling = new THREE.Mesh(toGeometry(ceil, VS, offset, stone), rockMat);
  const lavaMesh = new THREE.Mesh(
    toGeometry(lava, VS, offset, (v) => (v === LAVA_CRACK ? [1, 0, 0] : [0, 0, 0])),
    lavaMaterial,
  );
  const group = new THREE.Group();
  group.add(rockMesh, ceiling, lavaMesh);
  return {
    group,
    ceiling,
    lavaMaterial,
    dispose: () => {
      for (const m of [rockMesh, ceiling, lavaMesh]) m.geometry.dispose();
      rockMat.dispose();
      lavaMaterial.dispose();
    },
  };
}
