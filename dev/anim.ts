// Dev-only: every enemy in a row, stepping, telegraphing, striking, getting hit and dying in a loop:
// /dev/anim.html (not part of the build). ?only=ghoul,leech picks enemy ids; ?t=1800 freezes at a moment (ms).
import * as THREE from 'three';
import { ENEMIES } from '../src/content';
import type { Particles } from '../src/render/fx';
import { flagstones } from '../src/render/look/textures';
import { UnitsView } from '../src/render/unitsView';

const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',');
const frozen = params.get('t');
const types = ENEMIES.map((e) => e.id).filter((id) => !only || only.includes(id));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0604);
scene.add(new THREE.HemisphereLight(0x5a4c3c, 0x140c08, 1.5));
const key = new THREE.PointLight(0xffb070, 40, 40, 1.1);
scene.add(key);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: flagstones(0x5a5048, 5) }),
);
floor.receiveShadow = true;
scene.add(floor);

const noFx = { dust() {}, splash() {} } as unknown as Particles;
const units = new UnitsView(noFx);
scene.add(units.group);

const LOOP = 4000;
let cycle = -1;
function step(now: number) {
  const c = Math.floor(now / LOOP);
  const t = now - c * LOOP;
  if (c !== cycle) {
    cycle = c;
    units.clear();
    types.forEach((type, i) => units.spawn(`${type}${c}`, type, false, { x: i, y: 1 }, 2, 5, now));
  }
  const at = (ms: number) => t >= ms && t - ms < 20;
  types.forEach((type, i) => {
    const id = `${type}${c}`;
    if (at(500)) units.moveTo(id, { x: i, y: 2 }, now, 300);
    const v = units.units.get(id);
    if (v && t > 1000 && t < 1700) v.intent = { kind: 'attack' } as never;
    if (at(1700)) {
      if (v) v.intent = null;
      units.strike(id, now);
      units.lungeTowards(id, { x: i, y: 3 }, now, 300);
    }
    if (at(2300)) units.flash(id, now);
    if (at(2900)) units.die(id, now, 400, false);
  });
}

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 120);
const width = types.length * 2;
const halfH = Math.atan(Math.tan((35 * Math.PI) / 360) * camera.aspect);
camera.position.set(width / 2 - 1, 3, 6 + width / 2 / Math.tan(halfH));
camera.lookAt(width / 2 - 1, 1, 4);
key.position.set(width / 2, 5, 9);

function frame(ms: number) {
  const now = frozen !== null ? Number(frozen) : ms;
  if (frozen !== null) {
    // Replay from the start of the loop up to the frozen moment, in small steps.
    for (let s = 0; s <= now; s += 16) {
      step(s);
      units.update(s);
    }
    renderer.render(scene, camera);
    return;
  }
  step(now);
  units.update(now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
