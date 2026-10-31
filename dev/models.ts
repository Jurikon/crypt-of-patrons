// Dev-only close-up of the voxel models under game lighting: /dev/models.html (not part of the build).
// ?turn=0.6 rotates the models (radians); ?pose=windup shows the attack pose.
import * as THREE from 'three';
import { modelGeometry } from '../src/render/modelMesh';
import { toonMaterial } from '../src/render/toon';
import { MODELS } from '../src/render/voxel/models';

const params = new URLSearchParams(location.search);
const turn = Number(params.get('turn') ?? 0.5);
const pose = (params.get('pose') ?? 'idle') as 'idle' | 'windup' | 'strike';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140504);
scene.add(new THREE.HemisphereLight(0x5a2a70, 0x501008, 3));
const key = new THREE.PointLight(0xffc890, 6, 20, 0.6);
key.position.set(1.5, 2.2, 3);
scene.add(key);
const fire = new THREE.PointLight(0xff8030, 4, 10, 0.9);
fire.position.set(-2, 1, 1);
scene.add(fire);

const outline = new THREE.MeshBasicMaterial({ color: 0x2a0a08, side: THREE.BackSide });
const eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.75, 0.12) });
Object.values(MODELS).forEach((model, i) => {
  const g = modelGeometry(model);
  const root = new THREE.Group();
  const mat = toonMaterial();
  root.add(new THREE.Mesh(g.body.mesh, mat), new THREE.Mesh(g.body.outline, outline), new THREE.Mesh(g.eyes, eyes));
  const arm = new THREE.Group();
  arm.position.copy(g.pivot);
  arm.rotation.x = model.poses[pose];
  arm.add(new THREE.Mesh(g.arm.mesh, mat), new THREE.Mesh(g.arm.outline, outline));
  root.add(arm);
  root.position.set(i === 0 ? -0.75 : 0.75, 0, 0);
  root.rotation.y = turn;
  scene.add(root);
});

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.2, 4.6);
camera.lookAt(0, 0.9, 0);
renderer.render(scene, camera);
