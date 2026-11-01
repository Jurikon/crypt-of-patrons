// Dev-only gallery of the creatures and props under torch light: /dev/models.html (not part of the build).
// ?turn=0.6 rotates the models (radians); ?pose=windup shows the attack pose; ?only=ghoul,leech picks models;
// ?cols=4 sets the number of columns.
import * as THREE from 'three';
import { BONES, CREATURES, PROPS, type Bone } from '../src/render/look/creatureKit';
import { bonePieces, buildProp, makeMaterial } from '../src/render/look/creatures';
import { flagstones } from '../src/render/look/textures';

const params = new URLSearchParams(location.search);
const turn = Number(params.get('turn') ?? 0.5);
const pose = (params.get('pose') ?? 'idle') as 'idle' | 'windup' | 'strike';
const only = params.get('only')?.split(',');
const cols = Number(params.get('cols') ?? 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0604);
scene.add(new THREE.HemisphereLight(0x5a4c3c, 0x140c08, 1.5));
const key = new THREE.PointLight(0xffb070, 30, 30, 1.1);
scene.add(key);

const names = [...Object.keys(CREATURES), ...Object.keys(PROPS)].filter((n) => !only || only.includes(n));
const rows = Math.ceil(names.length / cols);
const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.75, 0.12) });
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: flagstones(0x5a5048, 5) }),
);
scene.add(floor);
names.forEach((name, i) => {
  const root = new THREE.Group();
  const spec = CREATURES[name];
  if (spec) {
    const bones = {} as Record<Bone, THREE.Group>;
    for (const b of BONES) {
      const g = new THREE.Group();
      const at = b === 'body' ? undefined : spec.bones[b];
      if (at) g.position.set(at[0], at[1], at[2]);
      if (b !== 'body') bones.body.add(g);
      bones[b] = g;
    }
    root.add(bones.body);
    for (const [b, pieces] of bonePieces(name, spec))
      for (const p of pieces) bones[b].add(new THREE.Mesh(p.geo, makeMaterial(name, p.mat, spec.mats[p.mat]!)));
    for (const e of spec.eyes) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(e.r, 8, 6), eye);
      m.position.set(e.at[0], e.at[1], e.at[2]);
      bones[e.bone].add(m);
    }
    bones.armR.rotation.x = spec.poses[pose];
    root.scale.setScalar(spec.scale ?? 1);
  } else root.add(buildProp(name, PROPS[name]!).group);
  const col = i % cols;
  const row = Math.floor(i / cols);
  root.position.set((col - (cols - 1) / 2) * 1.7, 0, -row * 2.2);
  root.rotation.y = turn;
  scene.add(root);
});

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 80);
const depth = (rows - 1) * 2.2;
const halfH = Math.atan(Math.tan((35 * Math.PI) / 360) * camera.aspect);
camera.position.set(0, 2.2 + rows * 0.6, 2 + (cols * 1.7) / 2 / Math.tan(halfH));
camera.lookAt(0, 0.8, -depth / 2);
key.position.set(2, 4, 3 + cols * 0.5);
renderer.render(scene, camera);
