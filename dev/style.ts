import * as THREE from 'three';

/**
 * Style test (owner request): one room in a retro PS1 / King's Field look, to judge the direction
 * before the game is restyled. Not part of the game: low-poly shapes, pixel textures drawn in code,
 * a low-resolution render with snapped vertices and dithering, torches in the dark, the hero's hands.
 *
 *   ?biome=crypt|catacombs|cathedral   ?view=1|2|3   ?still=1 (no swaying, for screenshots)
 */

type Biome = 'crypt' | 'catacombs' | 'cathedral';
const params = new URLSearchParams(location.search);
let biome = (params.get('biome') as Biome | null) ?? 'crypt';
const view = Number(params.get('view') ?? 1);
const still = params.has('still');

/** Low internal resolution: every texel and pixel stays chunky. */
const LOW_H = 240;

// ---- seeded noise ------------------------------------------------------------------------------

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rgb = [number, number, number];
const hex = (c: number): Rgb => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const shade = (c: Rgb, k: number): string =>
  `rgb(${Math.max(0, Math.min(255, c[0] * k))},${Math.max(0, Math.min(255, c[1] * k))},${Math.max(0, Math.min(255, c[2] * k))})`;

/** A pixel texture drawn on a small canvas: nearest filtering, no mipmaps, tiles. */
function pixelTexture(
  w: number,
  h: number,
  seed: number,
  draw: (g: CanvasRenderingContext2D, r: () => number) => void,
) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, mulberry(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Per-pixel grain over whatever is drawn. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount: number) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 1 + (r() - 0.5) * amount;
    img.data[i] = img.data[i]! * k;
    img.data[i + 1] = img.data[i + 1]! * k;
    img.data[i + 2] = img.data[i + 2]! * k;
  }
  g.putImageData(img, 0, 0);
}

function bricks(base: number, mortar: number, seed: number, moss = 0, wet = false) {
  return pixelTexture(64, 64, seed, (g, r) => {
    const b = hex(base);
    g.fillStyle = shade(hex(mortar), 1);
    g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * 16 + off;
        g.fillStyle = shade(b, 0.75 + r() * 0.45);
        g.fillRect(x + 1, row * 8 + 1, 15, 7);
        // Chipped corners and a lighter top edge.
        g.fillStyle = shade(b, 1.25);
        g.fillRect(x + 1, row * 8 + 1, 15, 1);
        if (r() < 0.3) {
          g.fillStyle = shade(hex(mortar), 1);
          g.fillRect(x + 1 + Math.floor(r() * 13), row * 8 + 1 + Math.floor(r() * 5), 2, 2);
        }
      }
    }
    // Cracks.
    g.fillStyle = shade(hex(mortar), 0.8);
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(r() * 64);
      let y = Math.floor(r() * 64);
      for (let s = 0; s < 6; s++) {
        g.fillRect(x, y, 1, 1);
        x += Math.floor(r() * 3) - 1;
        y += 1;
      }
    }
    if (moss) {
      for (let i = 0; i < 260 * moss; i++) {
        const y = 40 + Math.floor(r() * r() * 24);
        g.fillStyle = shade([70, 110, 50], 0.6 + r() * 0.6);
        g.fillRect(Math.floor(r() * 64), y, 1 + Math.floor(r() * 2), 1);
      }
    }
    if (wet) {
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(r() * 64);
        g.fillStyle = 'rgba(20,40,40,0.35)';
        g.fillRect(x, 0, 1, 20 + Math.floor(r() * 44));
      }
    }
    grain(g, 64, 64, r, 0.25);
  });
}

function flagstones(base: number, seed: number) {
  return pixelTexture(64, 64, seed, (g, r) => {
    const b = hex(base);
    g.fillStyle = shade(b, 0.35);
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 16)
      for (let x = 0; x < 64; x += 16) {
        const w = r() < 0.3 ? 31 : 15;
        g.fillStyle = shade(b, 0.7 + r() * 0.5);
        g.fillRect(x + 1, y + 1, Math.min(w, 63 - x), 15);
      }
    grain(g, 64, 64, r, 0.35);
  });
}

function checker(light: number, dark: number, seed: number) {
  return pixelTexture(32, 32, seed, (g, r) => {
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        g.fillStyle = shade(hex((x + y) % 2 ? dark : light), 1);
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    // Marble veins and grime.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      g.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 1 + Math.floor(r() * 3), 1);
    }
    grain(g, 32, 32, r, 0.2);
  });
}

function planks(base: number, seed: number) {
  return pixelTexture(32, 32, seed, (g, r) => {
    const b = hex(base);
    for (let x = 0; x < 32; x += 8) {
      g.fillStyle = shade(b, 0.8 + r() * 0.35);
      g.fillRect(x, 0, 8, 32);
      g.fillStyle = shade(b, 0.5);
      g.fillRect(x, 0, 1, 32);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = shade(b, 0.65);
        g.fillRect(x + 2 + Math.floor(r() * 5), Math.floor(r() * 32), 1, 3 + Math.floor(r() * 6));
      }
    }
    grain(g, 32, 32, r, 0.2);
  });
}

function solid(base: number, seed: number, amount = 0.3, spots: number | null = null) {
  return pixelTexture(16, 16, seed, (g, r) => {
    g.fillStyle = shade(hex(base), 1);
    g.fillRect(0, 0, 16, 16);
    if (spots !== null)
      for (let i = 0; i < 6; i++) {
        g.fillStyle = shade(hex(spots), 0.8 + r() * 0.4);
        g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1 + Math.floor(r() * 2), 1);
      }
    grain(g, 16, 16, r, amount);
  });
}

function skullFace(seed: number) {
  return pixelTexture(16, 16, seed, (g, r) => {
    g.fillStyle = '#d8ccae';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#140c08';
    g.fillRect(3, 5, 4, 4);
    g.fillRect(9, 5, 4, 4);
    g.fillRect(7, 10, 2, 2);
    for (let x = 4; x < 12; x += 2) g.fillRect(x, 13, 1, 2);
    g.fillStyle = '#ffcc40';
    g.fillRect(4, 6, 2, 2);
    g.fillRect(10, 6, 2, 2);
    grain(g, 16, 16, r, 0.25);
  });
}

/** A small pixel flame, redrawn every few frames. */
function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 16;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  const r = mulberry(7);
  const redraw = () => {
    g.clearRect(0, 0, 8, 16);
    for (let y = 0; y < 16; y++) {
      const width = Math.max(0, Math.round((y / 16) * 4 + (r() - 0.5) * 2));
      for (let x = 4 - width; x < 4 + width; x++) {
        const hot = y > 10 && Math.abs(x - 3.5) < 1.5;
        g.fillStyle = hot ? '#fff3a0' : y > 6 ? '#ffb030' : '#e0501a';
        if (r() < 0.9) g.fillRect(x, 15 - (15 - y), 1, 1);
      }
    }
    t.needsUpdate = true;
  };
  redraw();
  return { texture: t, redraw };
}

// ---- PS1 look: snapped vertices -----------------------------------------------------------------

const snapRes = new THREE.Vector2(320, 180);
/** Lambert material whose vertices snap to a coarse screen grid, like the PS1's integer rasteriser. */
function mat(map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}) {
  const m = new THREE.MeshLambertMaterial({ map, ...extra });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = { value: snapRes };
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'uniform vec2 uSnap;\nvoid main() {').replace(
      '#include <project_vertex>',
      `#include <project_vertex>
        vec2 snapped = floor(gl_Position.xy / gl_Position.w * uSnap * 0.5 + 0.5) / (uSnap * 0.5);
        gl_Position.xy = snapped * gl_Position.w;`,
    );
  };
  return m;
}
const repeat = (t: THREE.Texture, x: number, y: number) => {
  const c = t.clone();
  c.repeat.set(x, y);
  c.needsUpdate = true;
  return c;
};

// ---- scene --------------------------------------------------------------------------------------

const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.05, 60);
scene.add(camera);
const target = new THREE.WebGLRenderTarget(4, 4, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });

// Final pass: dither and quantise to 15-bit colour, as the PS1 did.
const post = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: { tScene: { value: target.texture }, uRes: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tScene; uniform vec2 uRes; varying vec2 vUv;
      float bayer(vec2 p){ int x = int(mod(p.x,4.0)); int y = int(mod(p.y,4.0));
        int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return float(m[y*4+x])/16.0 - 0.5; }
      void main(){
        vec2 px = floor(vUv * uRes);
        vec3 c = texture2D(tScene, (px + 0.5) / uRes).rgb;
        c = pow(c, vec3(1.0/2.2));
        c = floor(c * 31.0 + bayer(px) + 0.5) / 31.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false,
  }),
);
const postScene = new THREE.Scene();
postScene.add(post);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const CELL = 2.4;
const N = 7;
const SIZE = N * CELL;
const H = 4.6;

interface Look {
  fog: number;
  ambient: number;
  wall: THREE.Texture;
  floor: THREE.Texture;
  floorRepeat: number;
  ceiling: THREE.Texture;
  torch: number;
}

function lookFor(b: Biome): Look {
  if (b === 'catacombs')
    return {
      fog: 0x0a1410,
      ambient: 0x203a34,
      wall: bricks(0x56665a, 0x1c2420, 11, 1, true),
      floor: flagstones(0x4a5a52, 12),
      floorRepeat: N,
      ceiling: bricks(0x3a4a40, 0x141c18, 13, 0.4),
      torch: 0xffb070,
    };
  if (b === 'cathedral')
    return {
      fog: 0x1a140e,
      ambient: 0x4a4038,
      wall: bricks(0xb8ac94, 0x5a5040, 21),
      floor: checker(0xd8d0c0, 0x1e1a18, 22),
      floorRepeat: N,
      ceiling: bricks(0x8a806c, 0x3a3428, 23),
      torch: 0xffd890,
    };
  return {
    fog: 0x0c0806,
    ambient: 0x4a3828,
    wall: bricks(0x86735e, 0x2a2018, 1),
    floor: flagstones(0x76685a, 2),
    floorRepeat: N,
    ceiling: bricks(0x4a4238, 0x1a1612, 3),
    torch: 0xffa850,
  };
}

const room = new THREE.Group();
scene.add(room);
const lights: { light: THREE.PointLight; base: number; phase: number }[] = [];
const flames: { redraw: () => void }[] = [];
const monsters: { root: THREE.Group; arm: THREE.Object3D; phase: number; bar: THREE.Object3D }[] = [];

/** A wall with an arched doorway, extruded so its bricks tile in world units. */
function archWall(width: number, look: Look) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0)
    .lineTo(width / 2, 0)
    .lineTo(width / 2, H)
    .lineTo(-width / 2, H)
    .lineTo(-width / 2, 0);
  const hole = new THREE.Path();
  const dw = 1.1;
  hole.moveTo(-dw, 0).lineTo(dw, 0).lineTo(dw, 2.4).absarc(0, 2.4, dw, 0, Math.PI, false).lineTo(-dw, 0);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false, curveSegments: 6 });
  const t = repeat(look.wall, 1 / 1.4, 1 / 1.4);
  return new THREE.Mesh(geo, mat(t));
}

function torch(look: Look, x: number, z: number, rotY: number) {
  const g = new THREE.Group();
  const iron = mat(solid(0x2a2624, 31, 0.4));
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.4), iron);
  bracket.position.set(0, 0, 0.2);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 5), mat(planks(0x5a3a1e, 32)));
  stick.position.set(0, 0.2, 0.38);
  stick.rotation.x = 0.35;
  const flame = flameTexture();
  flames.push(flame);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame.texture, color: 0xffffff, fog: false }));
  sprite.scale.set(0.32, 0.64, 1);
  sprite.position.set(0, 0.7, 0.5);
  g.add(bracket, stick, sprite);
  g.position.set(x, 2.4, z);
  g.rotation.y = rotY;
  room.add(g);
  const light = new THREE.PointLight(look.torch, 9, 9, 1.6);
  light.position.set(x + Math.sin(rotY) * 0.7, 3.0, z + Math.cos(rotY) * 0.7);
  room.add(light);
  lights.push({ light, base: 9, phase: x * 1.7 + z });
}

function buildRoom(b: Biome) {
  room.clear();
  lights.length = 0;
  flames.length = 0;
  monsters.length = 0;
  const look = lookFor(b);
  scene.fog = new THREE.Fog(look.fog, 3, 19);
  scene.background = new THREE.Color(look.fog);
  room.add(new THREE.AmbientLight(look.ambient, 1.2));
  room.add(new THREE.HemisphereLight(look.ambient, 0x000000, 0.6));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
    mat(repeat(look.floor, look.floorRepeat, look.floorRepeat)),
  );
  room.add(floor);
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE).rotateX(Math.PI / 2),
    mat(repeat(look.ceiling, N / 1.4, N / 1.4)),
  );
  ceil.position.y = H;
  room.add(ceil);
  for (let i = 0; i < 4; i++) {
    const w = archWall(SIZE, look);
    const a = (i * Math.PI) / 2;
    const g = new THREE.Group();
    g.add(w);
    w.position.set(0, 0, -SIZE / 2 - 0.6);
    g.rotation.y = a;
    room.add(g);
    // Torches either side of each doorway.
    for (const sx of [-1, 1]) {
      const x = sx * 2.4;
      const p = new THREE.Vector3(x, 0, -SIZE / 2 + 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      torch(look, p.x, p.z, a);
    }
  }
  // Ceiling beams.
  const wood = mat(planks(0x4a2e18, 41));
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 0.3, 0.3), wood);
    beam.position.set(0, H - 0.15, i * CELL * 1.2);
    room.add(beam);
  }
  // Pillars.
  const pillarMat = mat(repeat(look.wall, 2, 3));
  for (const [x, z] of [
    [-1.5, -1.5],
    [1.5, -1.5],
    [-1.5, 1.5],
    [1.5, 1.5],
  ] as const) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, H, 8), pillarMat);
    p.position.set(x * CELL, H / 2, z * CELL);
    room.add(p);
  }
  // A hanging brazier over the middle of the room lights the fight.
  const glow = new THREE.PointLight(look.torch, 7, 10, 1.4);
  glow.position.set(0, 3.4, 1.5);
  room.add(glow);
  lights.push({ light: glow, base: 7, phase: 0.4 });
  props(b);
  if (b === 'cathedral') window_();
  if (b === 'catacombs') water();
  enemies(b);
}

function props(b: Biome) {
  const r = mulberry(b.length * 31);
  const wood = mat(planks(0x7a3a1c, 51));
  // Broken benches and planks scattered on the floor.
  for (let i = 0; i < 16; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.9 + r() * 0.8, 0.08, 0.28), wood);
    plank.position.set((r() - 0.5) * SIZE * 0.8, 0.05 + r() * 0.15, (r() - 0.5) * SIZE * 0.8 - 1);
    plank.rotation.set((r() - 0.5) * 0.6, r() * Math.PI, (r() - 0.5) * 0.4);
    room.add(plank);
  }
  for (let i = 0; i < 4; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), wood);
    crate.position.set((r() - 0.5) * SIZE * 0.7, 0.3, (r() - 0.5) * SIZE * 0.7 - 1.5);
    crate.rotation.set(0, r() * Math.PI, r() < 0.4 ? 0.9 : 0);
    room.add(crate);
  }
  const barrelMat = mat(planks(0x6a4424, 52));
  for (let i = 0; i < 3; i++) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 8), barrelMat);
    barrel.position.set(-SIZE / 2 + 1 + i * 0.75, 0.45, -SIZE / 2 + 1);
    room.add(barrel);
  }
  if (b !== 'cathedral') {
    const bone = mat(solid(0xd8ccae, 53, 0.3));
    for (let i = 0; i < 10; i++) {
      const piece = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), bone);
      piece.position.set((r() - 0.5) * SIZE * 0.8, 0.03, (r() - 0.5) * SIZE * 0.8);
      piece.rotation.y = r() * Math.PI;
      room.add(piece);
    }
  }
}

/** A stained-glass window on the far wall, glowing. */
function window_() {
  const t = pixelTexture(16, 32, 61, (g, r) => {
    const colors = ['#c02030', '#2040c0', '#e0b020', '#20a050', '#8030b0'];
    for (let y = 0; y < 32; y += 4)
      for (let x = 0; x < 16; x += 4) {
        g.fillStyle = colors[Math.floor(r() * colors.length)]!;
        g.fillRect(x, y, 4, 4);
      }
    g.fillStyle = '#100a08';
    for (let i = 0; i <= 16; i += 4) g.fillRect(i, 0, 1, 32);
    for (let i = 0; i <= 32; i += 4) g.fillRect(0, i, 16, 1);
  });
  for (const x of [-4.6, 4.6]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), new THREE.MeshBasicMaterial({ map: t, fog: false }));
    w.position.set(x, 3, -SIZE / 2 - 0.05);
    room.add(w);
    const light = new THREE.SpotLight(0xa070ff, 14, 14, 0.5, 0.6, 1.2);
    light.position.set(x, 3.2, -SIZE / 2 + 0.2);
    light.target.position.set(x * 0.5, 0, -2);
    room.add(light, light.target);
  }
}

function water() {
  const t = pixelTexture(32, 32, 71, (g, r) => {
    g.fillStyle = '#163c44';
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = r() < 0.5 ? '#2a6a70' : '#0e2a30';
      g.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 2 + Math.floor(r() * 4), 1);
    }
  });
  const puddle = new THREE.Mesh(
    new THREE.PlaneGeometry(CELL * 3, CELL * 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: repeat(t, 3, 2), transparent: true, opacity: 0.85 }),
  );
  puddle.position.set(CELL, 0.02, 0);
  room.add(puddle);
}

// ---- creatures: low-poly boxes with pixel textures --------------------------------------------

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}

function healthBar(y: number) {
  const g = new THREE.Group();
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x1a0a06, fog: false }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xe07020, fog: false }),
  );
  fill.position.set(-0.15, 0, 0.001);
  g.add(back, fill);
  g.position.y = y;
  return g;
}

function skeleton(withHelmet: boolean) {
  const root = new THREE.Group();
  const bone = mat(solid(0xd0c4a4, 81, 0.35, 0x8a7a5a));
  const dark = mat(solid(0x5a4a38, 82, 0.3));
  root.add(box(0.12, 0.8, 0.12, bone, -0.16, 0.4), box(0.12, 0.8, 0.12, bone, 0.16, 0.4)); // legs
  root.add(box(0.5, 0.16, 0.26, bone, 0, 0.86)); // pelvis
  root.add(box(0.08, 0.6, 0.08, dark, 0, 1.2, -0.05)); // spine
  for (let i = 0; i < 4; i++) root.add(box(0.5 - i * 0.04, 0.05, 0.3, bone, 0, 1.18 + i * 0.12)); // ribs
  root.add(box(0.7, 0.08, 0.16, bone, 0, 1.64)); // shoulders
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), [
    bone,
    bone,
    bone,
    bone,
    mat(skullFace(83)),
    bone,
  ]);
  skull.position.set(0, 1.95, 0);
  root.add(skull);
  if (withHelmet) {
    const red = mat(solid(0xa02018, 84, 0.3));
    root.add(box(0.38, 0.12, 0.38, red, 0, 2.16));
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 4), bone);
      horn.position.set(s * 0.22, 2.3, 0);
      horn.rotation.z = -s * 0.6;
      root.add(horn);
    }
  }
  root.add(box(0.1, 0.7, 0.1, bone, -0.38, 1.3)); // static arm
  const arm = new THREE.Group();
  arm.position.set(0.38, 1.62, 0);
  arm.add(box(0.1, 0.7, 0.1, bone, 0, -0.35));
  const rust = mat(solid(0x8a6a50, 85, 0.5, 0x5a2a10));
  arm.add(box(0.06, 0.9, 0.14, rust, 0, -1.1, 0.1));
  root.add(arm);
  return { root, arm };
}

function imp() {
  const root = new THREE.Group();
  const skin = mat(solid(0xc8c030, 91, 0.35, 0x7a8a20));
  const armour = mat(solid(0xb02a18, 92, 0.35, 0x601008));
  root.add(box(0.14, 0.7, 0.14, skin, -0.14, 0.35), box(0.14, 0.7, 0.14, skin, 0.14, 0.35));
  root.add(box(0.5, 0.6, 0.3, armour, 0, 1.0));
  const head = box(0.34, 0.32, 0.3, skin, 0, 1.5);
  root.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 4), skin);
    ear.position.set(s * 0.28, 1.6, 0);
    ear.rotation.z = -s * 1.1;
    root.add(ear);
  }
  root.add(box(0.12, 0.6, 0.12, skin, -0.34, 0.95));
  const arm = new THREE.Group();
  arm.position.set(0.34, 1.25, 0);
  arm.add(box(0.12, 0.6, 0.12, skin, 0, -0.3));
  arm.add(box(0.05, 1.6, 0.05, mat(planks(0x5a3a1e, 93)), 0, -0.4, 0.2));
  root.add(arm);
  return { root, arm };
}

function hooded() {
  const root = new THREE.Group();
  const cloth = mat(solid(0x3a2a20, 101, 0.4, 0x1a120c));
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 1.6, 7), cloth);
  robe.position.y = 0.8;
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 6), cloth);
  hood.position.y = 1.85;
  const face = box(0.2, 0.18, 0.05, new THREE.MeshBasicMaterial({ color: 0x080404 }), 0, 1.72, 0.2);
  root.add(robe, hood, face);
  const arm = new THREE.Group();
  arm.position.set(0.35, 1.4, 0);
  arm.add(box(0.14, 0.6, 0.14, cloth, 0, -0.3));
  root.add(arm);
  return { root, arm };
}

function enemies(b: Biome) {
  const list =
    b === 'cathedral'
      ? [hooded(), skeleton(false), hooded()]
      : b === 'catacombs'
        ? [hooded(), skeleton(false), skeleton(false)]
        : [hooded(), skeleton(true), imp()];
  const spots: [number, number, number][] = [
    [-1.3, 0.4, 0.35],
    [0.05, 1.3, 0],
    [1.4, 0.2, -0.35],
  ];
  list.forEach((m, i) => {
    const [x, z, ry] = spots[i]!;
    m.root.position.set(x * CELL * 0.8, 0, z * CELL * 0.8);
    m.root.rotation.y = ry;
    const bar = healthBar(2.6);
    m.root.add(bar);
    room.add(m.root);
    monsters.push({ root: m.root, arm: m.arm, phase: i * 1.7, bar });
  });
}

// ---- the hero's hands: a sword in the right, a shield on the left -----------------------------

const hands = new THREE.Group();
camera.add(hands);
const gauntlet = mat(solid(0xc8c8cc, 111, 0.35, 0x8a1a10));
const steel = mat(solid(0xb0b4bc, 112, 0.25, 0x7a1010));
const right = new THREE.Group();
right.add(box(0.14, 0.14, 0.42, gauntlet, 0, 0, 0.1)); // forearm
right.add(box(0.16, 0.14, 0.14, gauntlet, 0, 0.02, -0.14)); // fist
for (let i = 0; i < 3; i++) {
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 4), mat(solid(0x8a1a10, 113)));
  spike.position.set(0.08, 0.02, 0.15 - i * 0.12);
  spike.rotation.z = -Math.PI / 2;
  right.add(spike);
}
const sword = new THREE.Group();
sword.add(box(0.04, 0.16, 0.04, mat(planks(0x3a2414, 114)), 0, 0.02, 0)); // grip
sword.add(box(0.26, 0.03, 0.05, steel, 0, 0.1, 0)); // guard
sword.add(box(0.1, 0.72, 0.02, steel, 0, 0.47, 0)); // blade
sword.add(box(0.02, 0.72, 0.024, mat(solid(0xe8eaf0, 116, 0.15)), 0, 0.47, 0)); // bright fuller
const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 4), steel);
tip.position.set(0, 0.9, 0);
tip.rotation.y = Math.PI / 4;
tip.scale.z = 0.25;
sword.add(tip);
sword.position.set(0, 0, -0.16);
sword.rotation.set(-0.75, 0, -0.25);
right.add(sword);
right.position.set(0.32, -0.32, -0.55);
right.rotation.set(0.1, -0.2, 0.1);
hands.add(right);
const left = new THREE.Group();
left.add(box(0.14, 0.14, 0.42, gauntlet, 0, 0, 0.1));
const shieldTex = pixelTexture(16, 16, 115, (g, r) => {
  g.fillStyle = '#6a4424';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#8a2018';
  g.fillRect(6, 0, 4, 16);
  g.fillRect(0, 6, 16, 4);
  g.fillStyle = '#3a3634';
  g.fillRect(0, 0, 16, 1);
  g.fillRect(0, 15, 16, 1);
  g.fillRect(0, 0, 1, 16);
  g.fillRect(15, 0, 1, 16);
  grain(g, 16, 16, r, 0.3);
});
const shield = box(0.34, 0.42, 0.04, mat(shieldTex), 0.04, 0.05, -0.12);
left.add(shield);
left.position.set(-0.5, -0.42, -0.62);
left.rotation.set(0.05, 0.55, -0.15);
hands.add(left);

// ---- camera, input, loop ------------------------------------------------------------------------

const VIEWS: Record<number, { pos: [number, number, number]; yaw: number; pitch: number }> = {
  1: { pos: [0, 1.55, SIZE / 2 - 2.2], yaw: 0, pitch: -0.05 },
  2: { pos: [-SIZE / 2 + 2.2, 1.55, SIZE / 2 - 2.4], yaw: -0.55, pitch: -0.02 },
  3: { pos: [2.2, 1.55, 1.5], yaw: 0.35, pitch: 0.1 },
};
const v = VIEWS[view] ?? VIEWS[1]!;
camera.position.set(...v.pos);
let yaw = v.yaw;
let pitch = v.pitch;
let swingStart = -1e9;

let dragging = false;
canvas.addEventListener('pointerdown', () => (dragging = true));
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= e.movementX * 0.004;
  pitch = Math.max(-0.6, Math.min(0.6, pitch - e.movementY * 0.004));
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') swingStart = performance.now();
  const b = ({ Digit1: 'crypt', Digit2: 'catacombs', Digit3: 'cathedral' } as Record<string, Biome>)[e.code];
  if (b) {
    biome = b;
    buildRoom(biome);
  }
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const lowW = Math.round((LOW_H * w) / h);
  target.setSize(lowW, LOW_H);
  (post.material as THREE.ShaderMaterial).uniforms.uRes!.value.set(lowW, LOW_H);
  snapRes.set(lowW * 0.75, LOW_H * 0.75);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
buildRoom(biome);
if (params.has('swing')) swingStart = performance.now() - 120;

let frame = 0;
function loop(now: number) {
  const t = still ? 1000 : now;
  frame++;
  if (frame % 6 === 0) for (const f of flames) f.redraw();
  for (const l of lights)
    l.light.intensity = l.base * (0.85 + 0.1 * Math.sin(t / 90 + l.phase) + 0.05 * Math.sin(t / 37));
  for (const m of monsters) {
    m.root.position.y = Math.abs(Math.sin(t / 400 + m.phase)) * 0.04;
    m.arm.rotation.x = -0.6 + Math.sin(t / 500 + m.phase) * 0.5;
    m.bar.quaternion.copy(camera.quaternion);
  }
  camera.rotation.set(pitch + (still ? 0 : Math.sin(now / 900) * 0.01), yaw, 0, 'YXZ');
  // Hands: a little sway while idle, a chop on Space.
  const s = (now - swingStart) / 320;
  const chop = s >= 0 && s < 1 ? Math.sin(s * Math.PI) : 0;
  right.rotation.x = 0.1 - chop * 1.3;
  right.position.y = -0.32 + chop * 0.12 + (still ? 0 : Math.sin(now / 600) * 0.01);
  left.position.y = -0.36 + (still ? 0 : Math.sin(now / 600 + 1) * 0.01);

  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
