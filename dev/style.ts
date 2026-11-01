import * as THREE from 'three';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Style test (owner request): the retro PS1 / King's Field direction, before the game is restyled.
 * Not part of the game. Each biome is its own place, not a retexture: a low burial crypt with niches
 * and sarcophagi, a vaulted catacomb tunnel with a water channel and a bridge, a tall cathedral nave
 * with colonnades, stained glass and an altar, and three creatures of its own each.
 *
 *   ?biome=crypt|catacombs|cathedral   ?px=480 (render height)   ?still=1 (no sway, for screenshots)
 *   ?style=mini — the same places as painted tabletop miniatures: a cut-away model on a table, figures on
 *   bases, a lamp with shadows, tilt-shift blur.   ?view=top — look down at the model instead.
 */

type Biome = 'crypt' | 'catacombs' | 'cathedral';
const params = new URLSearchParams(location.search);
let biome = (params.get('biome') as Biome | null) ?? 'crypt';
const still = params.has('still');
const mini = params.get('style') === 'mini';
const top = params.get('view') === 'top';
/**
 * ?style=hybrid — version 2's places and creatures with the HD-2D treatment: physically lit materials,
 * the hero's torch casting shadows, glowing fire, a soft depth of field, dust in the light, a vignette,
 * all rendered at the pixel resolution and scaled up crisp.
 */
const hybrid = params.get('style') === 'hybrid';
/** Hybrid, smoothed (owner: "more smoothing"): full resolution, multisampled edges, soft textures. ?smooth=0 keeps pixels. */
const smooth = hybrid && params.get('smooth') !== '0';

/** Internal render height: higher = finer pixels. */
const LOW_H = Number(params.get('px') ?? (mini ? window.innerHeight : hybrid ? 540 : 480));
/** Texture detail: texels per brick edge and so on. */
const TEX = 2;

// ---- seeded noise and pixel textures -----------------------------------------------------------

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

/** A pixel texture drawn on a small canvas (in units of 1/TEX texel): nearest filtering, tiles. */
function pixelTexture(
  w: number,
  h: number,
  seed: number,
  draw: (g: CanvasRenderingContext2D, r: () => number) => void,
) {
  const c = document.createElement('canvas');
  c.width = w * TEX;
  c.height = h * TEX;
  const g = c.getContext('2d')!;
  g.scale(TEX, TEX);
  draw(g, mulberry(seed));
  // Miniatures are painted, not pixelled: soft filtering and only a hint of grain.
  grain(g, c.width, c.height, mulberry(seed + 99), mini ? 0.1 : smooth ? 0.14 : 0.22);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = mini || smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = mini || smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mini || smooth;
  t.anisotropy = smooth ? 8 : 1;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Per-texel grain over whatever is drawn. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount: number) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const k = 1 + (r() - 0.5) * amount;
    img.data[i] = img.data[i]! * k;
    img.data[i + 1] = img.data[i + 1]! * k;
    img.data[i + 2] = img.data[i + 2]! * k;
  }
  g.putImageData(img, 0, 0);
  g.restore();
}

const dot = (g: CanvasRenderingContext2D, x: number, y: number, w = 0.5, h = 0.5) => g.fillRect(x, y, w, h);

function bricks(base: number, mortar: number, seed: number, moss = 0, wet = false) {
  return pixelTexture(64, 64, seed, (g, r) => {
    const b = hex(base);
    g.fillStyle = shade(hex(mortar), 1);
    g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * 16 + off;
        const k = 0.75 + r() * 0.45;
        g.fillStyle = shade(b, k);
        g.fillRect(x + 0.5, row * 8 + 0.5, 15.5, 7.5);
        g.fillStyle = shade(b, k * 1.22);
        g.fillRect(x + 0.5, row * 8 + 0.5, 15.5, 0.5);
        g.fillStyle = shade(b, k * 0.78);
        g.fillRect(x + 0.5, row * 8 + 7.5, 15.5, 0.5);
        for (let i = 0; i < 5; i++) {
          g.fillStyle = shade(b, k * (0.85 + r() * 0.3));
          dot(g, x + 1 + r() * 14, row * 8 + 1 + r() * 6, 1 + r() * 2, 0.5);
        }
      }
    }
    g.fillStyle = shade(hex(mortar), 0.8);
    for (let i = 0; i < 5; i++) {
      let x = r() * 64;
      let y = r() * 64;
      for (let s = 0; s < 12; s++) {
        dot(g, x, y);
        x += (r() - 0.5) * 1.5;
        y += 0.5;
      }
    }
    if (moss)
      for (let i = 0; i < 600 * moss; i++) {
        g.fillStyle = shade([70, 112, 48], 0.5 + r() * 0.7);
        dot(g, r() * 64, 36 + r() * r() * 28, 0.5 + r(), 0.5);
      }
    if (wet)
      for (let i = 0; i < 14; i++) {
        g.fillStyle = 'rgba(18,40,40,0.35)';
        g.fillRect(r() * 64, 0, 0.5, 16 + r() * 48);
      }
  });
}

function flagstones(base: number, seed: number) {
  return pixelTexture(64, 64, seed, (g, r) => {
    const b = hex(base);
    g.fillStyle = shade(b, 0.32);
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 16)
      for (let x = 0; x < 64; x += 16) {
        const w = r() < 0.3 ? 31.5 : 15.5;
        const k = 0.7 + r() * 0.45;
        g.fillStyle = shade(b, k);
        g.fillRect(x + 0.5, y + 0.5, Math.min(w, 63.5 - x), 15.5);
        for (let i = 0; i < 8; i++) {
          g.fillStyle = shade(b, k * (0.8 + r() * 0.35));
          dot(g, x + 1 + r() * 13, y + 1 + r() * 13, 1 + r() * 2, 0.5 + r());
        }
      }
  });
}

function checker(light: number, dark: number, seed: number) {
  return pixelTexture(32, 32, seed, (g, r) => {
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        g.fillStyle = shade(hex((x + y) % 2 ? dark : light), 1);
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      dot(g, r() * 32, r() * 32, 0.5 + r() * 2, 0.5);
    }
  });
}

function planks(base: number, seed: number) {
  return pixelTexture(32, 32, seed, (g, r) => {
    const b = hex(base);
    for (let x = 0; x < 32; x += 8) {
      g.fillStyle = shade(b, 0.8 + r() * 0.35);
      g.fillRect(x, 0, 8, 32);
      g.fillStyle = shade(b, 0.5);
      g.fillRect(x, 0, 0.5, 32);
      for (let i = 0; i < 10; i++) {
        g.fillStyle = shade(b, 0.62 + r() * 0.2);
        g.fillRect(x + 1 + r() * 6, r() * 32, 0.5, 2 + r() * 8);
      }
    }
  });
}

/** A flat material colour with grain and a few spots of another colour (bone, skin, cloth, metal). */
function solid(base: number, seed: number, spots: number | null = null, stripes = false) {
  return pixelTexture(16, 16, seed, (g, r) => {
    g.fillStyle = shade(hex(base), 1);
    g.fillRect(0, 0, 16, 16);
    if (stripes)
      for (let y = 0; y < 16; y += 3) {
        g.fillStyle = shade(hex(base), 0.8);
        g.fillRect(0, y, 16, 0.5);
      }
    if (spots !== null)
      for (let i = 0; i < 10; i++) {
        g.fillStyle = shade(hex(spots), 0.8 + r() * 0.4);
        dot(g, r() * 16, r() * 16, 0.5 + r(), 0.5 + r() * 0.5);
      }
  });
}

/** A face on the front of a head box: eyes, nose, mouth, in a few styles. */
function face(skin: number, kind: 'skull' | 'ghoul' | 'drowned' | 'helm' | 'mask' | 'hood', seed: number) {
  return pixelTexture(16, 16, seed, (g) => {
    g.fillStyle = shade(hex(skin), 1);
    g.fillRect(0, 0, 16, 16);
    const black = '#100806';
    if (kind === 'skull') {
      g.fillStyle = black;
      g.fillRect(3, 5, 4, 4);
      g.fillRect(9, 5, 4, 4);
      g.fillRect(7, 10, 2, 2);
      for (let x = 4; x < 12; x += 2) g.fillRect(x, 13, 1, 2);
      g.fillStyle = '#ffcc40';
      g.fillRect(4.5, 6.5, 1, 1);
      g.fillRect(10.5, 6.5, 1, 1);
    } else if (kind === 'ghoul') {
      g.fillStyle = black;
      g.fillRect(3, 6, 4, 2);
      g.fillRect(9, 6, 4, 2);
      g.fillStyle = '#e0ff60';
      g.fillRect(4, 6.5, 1.5, 1);
      g.fillRect(10.5, 6.5, 1.5, 1);
      g.fillStyle = '#2a0808';
      g.fillRect(3, 11, 10, 3);
      g.fillStyle = '#e8e0c0';
      for (let x = 3.5; x < 13; x += 1.5) g.fillRect(x, 11, 0.8, 1.2);
    } else if (kind === 'drowned') {
      g.fillStyle = '#0c1c20';
      g.fillRect(4, 6, 3, 3);
      g.fillRect(9, 6, 3, 3);
      g.fillStyle = '#c0f0ff';
      g.fillRect(5, 7, 1, 1);
      g.fillRect(10, 7, 1, 1);
      g.fillStyle = '#0c1c20';
      g.fillRect(6, 12, 4, 2.5);
    } else if (kind === 'helm') {
      g.fillStyle = black;
      g.fillRect(2, 6, 12, 1.5);
      g.fillRect(7.25, 7.5, 1.5, 5);
      g.fillStyle = '#d8b040';
      g.fillRect(7.5, 1, 1, 5);
      for (let y = 10; y < 15; y += 1.5) for (let x = 3; x < 13; x += 2) g.fillRect(x, y, 0.6, 0.6);
    } else if (kind === 'mask') {
      g.fillStyle = '#e8c050';
      g.fillRect(2, 2, 12, 12);
      g.fillStyle = black;
      g.fillRect(4, 6, 3, 1);
      g.fillRect(9, 6, 3, 1);
      g.fillRect(7, 11, 2, 0.6);
    } else {
      g.fillStyle = '#0a0606';
      g.fillRect(3, 3, 10, 11);
      g.fillStyle = '#ff5030';
      g.fillRect(5, 7, 1, 1);
      g.fillRect(10, 7, 1, 1);
    }
  });
}

/** A small pixel flame, redrawn every few frames. */
function flameTexture(seed: number, hot = '#fff3a0', mid = '#ffb030', cool = '#e0501a') {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  const r = mulberry(seed);
  const redraw = () => {
    g.clearRect(0, 0, 16, 32);
    for (let y = 0; y < 32; y++) {
      const width = Math.max(0, Math.round((y / 32) * 7 + (r() - 0.5) * 3));
      for (let x = 8 - width; x < 8 + width; x++) {
        const centre = Math.abs(x - 7.5) < 2;
        g.fillStyle = centre && y > 20 ? hot : y > 12 ? mid : cool;
        if (r() < 0.92) g.fillRect(x, y, 1, 1);
      }
    }
    t.needsUpdate = true;
  };
  redraw();
  return { texture: t, redraw };
}

// ---- PS1 look: snapped vertices -----------------------------------------------------------------

const snapRes = new THREE.Vector2(320, 180);
/** Lambert material whose vertices snap to a screen grid, like the PS1's integer rasteriser. */
function mat(map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}): THREE.Material {
  // Miniatures: matte painted plastic under a lamp, no vertex wobble.
  if (mini)
    return new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0, side: extra.side ?? THREE.FrontSide });
  if (hybrid)
    return new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0, side: extra.side ?? THREE.FrontSide });
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

// ---- renderer and post pass ---------------------------------------------------------------------

const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = mini || hybrid;
if (hybrid) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
}
renderer.shadowMap.type = THREE.PCFShadowMap;
// The model has no ceiling: everything above this height is cut away.
renderer.clippingPlanes = mini ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.7)] : [];
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 80);
scene.add(camera);
const target = new THREE.WebGLRenderTarget(4, 4, {
  magFilter: mini ? THREE.LinearFilter : THREE.NearestFilter,
  minFilter: mini ? THREE.LinearFilter : THREE.NearestFilter,
});

// Final pass: light dithering and 15-bit colour, as the PS1 did.
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
        c = floor(c * 31.0 + bayer(px) * 0.7 + 0.5) / 31.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    ...(mini
      ? {
          // Miniatures: tilt-shift (sharp band, blurred top and bottom), a vignette, a little more colour.
          fragmentShader: `
          uniform sampler2D tScene; uniform vec2 uRes; varying vec2 vUv;
          void main(){
            float d = abs(vUv.y - 0.46);
            float blur = smoothstep(0.1, 0.5, d) * 5.0;
            vec3 c = vec3(0.0);
            for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++)
              c += texture2D(tScene, vUv + vec2(float(x), float(y)) * blur / uRes).rgb;
            c /= 25.0;
            c = pow(c, vec3(1.0/2.2));
            float l = dot(c, vec3(0.299, 0.587, 0.114));
            c = mix(vec3(l), c, 1.2);
            c *= mix(0.62, 1.0, smoothstep(0.95, 0.35, length(vUv - 0.5)));
            gl_FragColor = vec4(c, 1.0);
          }`,
        }
      : {}),
    depthTest: false,
  }),
);
const postScene = new THREE.Scene();
postScene.add(post);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---- shared building blocks ----------------------------------------------------------------------

const world = new THREE.Group();
scene.add(world);
const lights: { light: THREE.PointLight; base: number; phase: number }[] = [];
const flames: { redraw: () => void }[] = [];
const creatures: {
  root: THREE.Group;
  arm: THREE.Object3D;
  phase: number;
  bar: THREE.Object3D;
  idle: (t: number) => void;
}[] = [];

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}
const add = (o: THREE.Object3D, x: number, y: number, z: number, ry?: number) => {
  o.position.set(x, y, z);
  // Only turn it when asked: a wall already turned to face the room keeps its turn.
  if (ry !== undefined) o.rotation.y = ry;
  world.add(o);
  return o;
};

/** A flat floor or wall panel whose texture tiles in world units (`unit` metres per tile). */
function panel(w: number, h: number, t: THREE.Texture, unit: number) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(repeat(t, w / unit, h / unit), { side: THREE.DoubleSide }));
}

function lightAt(color: number, intensity: number, distance: number, x: number, y: number, z: number) {
  const light = new THREE.PointLight(color, intensity, distance, 1.5);
  light.position.set(x, y, z);
  world.add(light);
  lights.push({ light, base: intensity, phase: x * 1.7 + z * 0.9 });
}

/** A torch on a wall bracket: iron, a stick, a living pixel flame and its warm light. */
function torch(x: number, y: number, z: number, ry: number, color = 0xffa850) {
  const g = new THREE.Group();
  const iron = mat(solid(0x2a2624, 31, 0x4a4440));
  g.add(box(0.12, 0.12, 0.4, iron, 0, 0, 0.2));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 6), mat(planks(0x5a3a1e, 32)));
  stick.position.set(0, 0.2, 0.38);
  stick.rotation.x = 0.35;
  g.add(stick);
  const flame = flameTexture(Math.floor(x * 13 + z * 7));
  flames.push(flame);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flame.texture,
      fog: false,
      color: hybrid ? new THREE.Color(2.6, 2.1, 1.6) : 0xffffff,
    }),
  );
  sprite.scale.set(0.32, 0.64, 1);
  sprite.position.set(0, 0.7, 0.5);
  g.add(sprite);
  add(g, x, y, z, ry);
  lightAt(color, 9, 9, x + Math.sin(ry) * 0.7, y + 0.6, z + Math.cos(ry) * 0.7);
}

/** A candle (cathedral): a wax stick with a small flame. */
function candle(x: number, z: number, h: number, y0 = 0) {
  const wax = mat(solid(0xe8dcc0, 33, 0xc8b898));
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 6), wax), x, y0 + h / 2, z);
  const flame = flameTexture(Math.floor(x * 31 + z * 17), '#ffffd0', '#ffd060', '#ff9030');
  flames.push(flame);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flame.texture,
      fog: false,
      color: hybrid ? new THREE.Color(2.6, 2.2, 1.7) : 0xffffff,
    }),
  );
  s.scale.set(0.1, 0.2, 1);
  add(s, x, y0 + h + 0.09, z);
}

function healthBar(y: number) {
  const g = new THREE.Group();
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x1a0a06, fog: false }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.035),
    new THREE.MeshBasicMaterial({ color: 0xe07020, fog: false }),
  );
  fill.position.set(-0.15, 0, 0.001);
  g.add(back, fill);
  g.position.y = y;
  return g;
}

function creature(
  c: { root: THREE.Group; arm: THREE.Object3D; height: number; idle?: (t: number) => void },
  x: number,
  z: number,
  ry: number,
) {
  const bar = healthBar(c.height + 0.35);
  if (!mini) c.root.add(bar);
  if (mini) c.root.add(miniBase(0x2a2a26, c.height < 1 ? 0.35 : 0.45));
  add(c.root, x, 0, z, ry);
  creatures.push({ root: c.root, arm: c.arm, phase: x + z, bar, idle: c.idle ?? (() => undefined) });
}

// ---- crypt: low vaults, burial niches, sarcophagi; the restless dead ----------------------------

function buildCrypt() {
  const W = 10;
  const L = 14;
  const H = 3.2;
  scene.fog = new THREE.Fog(0x0c0806, 2, 17);
  scene.background = new THREE.Color(0x0c0806);
  world.add(new THREE.AmbientLight(0x4a3828, 1.1));
  const wallT = bricks(0x86735e, 0x2a2018, 1);
  const floor = panel(W, L, flagstones(0x76685a, 2), 1.6);
  floor.rotation.x = -Math.PI / 2;
  add(floor, 0, 0, -L / 2 + 2);
  const ceil = panel(W, L, bricks(0x5a4c3e, 0x1a1410, 3), 1.6);
  ceil.rotation.x = Math.PI / 2;
  add(ceil, 0, H, -L / 2 + 2);
  // Heavy stone ribs across the low ceiling.
  const rib = mat(repeat(wallT, 4, 0.3));
  for (let z = 1; z > -L + 2; z -= 2.4) add(box(W, 0.35, 0.5, rib), 0, H - 0.17, z);
  // Side walls full of burial niches: three rows of recesses with skulls and bones in them.
  const niche = mat(solid(0x140c08, 34));
  const bone = mat(solid(0xd8ccae, 35, 0x8a7a5a));
  const skull = mat(face(0xd8ccae, 'skull', 36));
  for (const side of [-1, 1]) {
    const wall = panel(L, H, wallT, 1.4);
    wall.rotation.y = (side * -Math.PI) / 2;
    add(wall, (side * W) / 2, H / 2, -L / 2 + 2);
    for (let z = 0.6; z > -L + 2.5; z -= 1.3)
      for (const y of [0.55, 1.35, 2.15]) {
        add(box(0.06, 0.55, 1.0, niche), side * (W / 2 - 0.02), y, z);
        if ((z * 7 + y * 3) % 2 < 1.1) {
          const s = box(0.22, 0.22, 0.22, [bone, bone, bone, bone, skull, bone], side * (W / 2 - 0.2), y - 0.15, z);
          s.rotation.y = (side * -Math.PI) / 2;
          world.add(s);
        } else add(box(0.5, 0.06, 0.06, bone), side * (W / 2 - 0.2), y - 0.24, z + 0.1);
      }
  }
  const back = panel(W, H, wallT, 1.4);
  add(back, 0, H / 2, -L + 2);
  // Sarcophagi in two rows, one with its lid knocked aside.
  const stone = mat(repeat(bricks(0x9a8a72, 0x5a4c3e, 37), 0.5, 0.5));
  for (const [x, z, open] of [
    [-2.4, -3, false],
    [2.4, -3, true],
    [-2.4, -7, false],
    [2.4, -7, false],
  ] as const) {
    add(box(1.0, 0.8, 2.1, stone), x, 0.4, z);
    const lid = box(1.1, 0.16, 2.2, stone, 0, 0, 0);
    add(lid, x + (open ? 0.5 : 0), 0.88, z + (open ? 0.3 : 0), open ? 0.4 : 0);
    if (open) lid.rotation.z = -0.25;
  }
  // Cobwebs in the corners of the ribs.
  const web = new THREE.MeshBasicMaterial({
    color: 0xcfc8b8,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });
  for (const z of [-1.4, -6.2])
    for (const side of [-1, 1])
      add(new THREE.Mesh(new THREE.CircleGeometry(0.6, 5), web), side * (W / 2 - 0.4), H - 0.4, z, side * 0.8);
  for (const z of [-0.5, -5.3, -10.1])
    for (const side of [-1, 1]) torch(side * (W / 2 - 0.05), 1.9, z, (side * -Math.PI) / 2);

  creature(skeletonWarrior(), -1.1, -4.6, 0.3);
  creature(ghoul(), 0.6, -2.4, -0.15);
  creature(skeletonArcher(), 2.6, -5.6, -0.4);
  camera.position.set(0, 1.55, 2.2);
}

// ---- catacombs: a long vaulted tunnel, a water channel, a bridge; the drowned ------------------

function buildCatacombs() {
  const W = 7;
  const L = 22;
  scene.fog = new THREE.Fog(0x08120f, 2, 18);
  scene.background = new THREE.Color(0x08120f);
  world.add(new THREE.AmbientLight(0x1e3a32, 1.3));
  const wallT = bricks(0x56665a, 0x1c2420, 11, 1, true);
  // Barrel vault springing from the floor: half a cylinder seen from inside, bricks along the tunnel.
  const R = W / 2 + 0.2;
  const vault = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, L, 16, 1, true, Math.PI / 2, Math.PI),
    mat(repeat(wallT, 7, L / 1.4), { side: THREE.DoubleSide }),
  );
  vault.rotation.x = Math.PI / 2;
  add(vault, 0, 0, -L / 2 + 3);
  for (const side of [-1, 1]) {
    // Walkways either side of the channel.
    const walk = panel(2.2, L, flagstones(0x4a5a52, 12), 1.2);
    walk.rotation.x = -Math.PI / 2;
    add(walk, side * 2.4, 0, -L / 2 + 3);
    // The channel's stone edge.
    add(box(0.25, 0.25, L, mat(repeat(wallT, L / 1.4, 0.2))), side * 1.2, -0.05, -L / 2 + 3);
  }
  // The channel: dark water a little below the walkways.
  const waterT = pixelTexture(32, 32, 71, (g, r) => {
    g.fillStyle = '#123238';
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = r() < 0.5 ? '#2a6a70' : '#0a2228';
      dot(g, r() * 32, r() * 32, 1 + r() * 4, 0.5);
    }
  });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, L).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: repeat(waterT, 2, L / 1.2), transparent: true, opacity: 0.9 }),
  );
  add(water, 0, -0.35, -L / 2 + 3);
  // Ribbed arches along the tunnel, every few metres.
  const archMat = mat(repeat(bricks(0x46564a, 0x141c18, 14, 0.5), 4, 0.3));
  for (let z = 1; z > -L + 3; z -= 3.5) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R - 0.15, 0.22, 4, 14, Math.PI), archMat);
    add(arch, 0, 0, z);
  }
  // A stone bridge over the channel.
  const bridgeMat = mat(repeat(bricks(0x6a7a6a, 0x2a3430, 15), 1, 0.5));
  add(box(2.6, 0.3, 1.4, bridgeMat), 0, 0.15, -5.5);
  for (const sx of [-1, 1]) add(box(0.15, 0.5, 1.4, bridgeMat), sx * 1.2, 0.5, -5.5);
  // Hanging chains and moss-grown junk.
  const iron = mat(solid(0x2a2c2a, 72, 0x5a3010));
  for (const [x, z] of [
    [-1.6, -2.5],
    [1.4, -8.5],
    [-0.4, -12],
  ] as const)
    for (let i = 0; i < 8; i++) add(box(0.05, 0.14, 0.05, iron), x, 4.6 - i * 0.16, z, i * 0.8);
  const barrel = mat(planks(0x4a4a32, 73));
  for (const [x, z] of [
    [2.9, -1],
    [2.7, -1.8],
    [-2.9, -9],
  ] as const)
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10), barrel), x, 0.45, z);
  // Green-shaded lanterns.
  for (const z of [0, -7, -14])
    for (const side of [-1, 1]) torch(side * (R - 0.75), 1.5, z + side, (side * -Math.PI) / 2, 0x9adf9a);

  creature(drowned(), -2.2, -3.2, 0.35);
  creature(bloated(), 2.3, -5, -0.3);
  creature(leech(), -0.4, -2.2, 0.6);
  creature(leech(), 0.5, -2.8, -0.4);
  camera.position.set(-1.6, 1.55, 2.6);
}

// ---- cathedral: a tall nave, colonnades, stained glass, an altar; the faithful -----------------

function buildCathedral() {
  const W = 13;
  const L = 24;
  const H = 9;
  scene.fog = new THREE.Fog(0x1a140e, 4, 30);
  scene.background = new THREE.Color(0x1a140e);
  world.add(new THREE.AmbientLight(0x4a4038, 1.2));
  const wallT = bricks(0xb8ac94, 0x5a5040, 21);
  const floor = panel(W, L, checker(0xd8d0c0, 0x1e1a18, 22), 1.6);
  floor.rotation.x = -Math.PI / 2;
  add(floor, 0, 0, -L / 2 + 3);
  // A red carpet down the nave.
  const carpet = panel(2, L - 4, solid(0x7a1414, 23, 0xb0802a, true), 1);
  carpet.rotation.x = -Math.PI / 2;
  add(carpet, 0, 0.01, -L / 2 + 1);
  const ceil = panel(W, L, bricks(0x8a806c, 0x3a3428, 24), 2);
  ceil.rotation.x = Math.PI / 2;
  add(ceil, 0, H, -L / 2 + 3);
  for (const side of [-1, 1]) {
    const wall = panel(L, H, wallT, 1.6);
    wall.rotation.y = (side * -Math.PI) / 2;
    add(wall, (side * W) / 2, H / 2, -L / 2 + 3);
  }
  add(panel(W, H, wallT, 1.6), 0, H / 2, -L + 3);
  // Two colonnades of tall columns with capitals and bases, joined by beams.
  const colMat = mat(repeat(bricks(0xc8bca4, 0x6a6050, 25), 2, 5));
  const capMat = mat(repeat(bricks(0xa89c84, 0x5a5040, 26), 1, 0.3));
  for (let z = 0; z > -L + 5; z -= 3.6)
    for (const side of [-1, 1]) {
      add(
        new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, H - 1.2, 12), colMat),
        side * 3.4,
        (H - 1.2) / 2 + 0.3,
        z,
      );
      add(box(1.2, 0.3, 1.2, capMat), side * 3.4, 0.15, z);
      add(box(1.2, 0.5, 1.2, capMat), side * 3.4, H - 0.65, z);
    }
  for (const side of [-1, 1]) add(box(0.6, 0.6, L - 5, capMat), side * 3.4, H - 0.3, -L / 2 + 2.6);
  // Tall stained-glass windows along both walls, throwing coloured light in.
  const glass = pixelTexture(16, 40, 61, (g, r) => {
    const colors = ['#c02030', '#2040c0', '#e0b020', '#20a050', '#8030b0'];
    for (let y = 0; y < 40; y += 4)
      for (let x = 0; x < 16; x += 4) {
        g.fillStyle = colors[Math.floor(r() * colors.length)]!;
        g.fillRect(x, y, 4, 4);
      }
    g.fillStyle = '#100a08';
    for (let i = 0; i <= 16; i += 4) g.fillRect(i, 0, 0.6, 40);
    for (let i = 0; i <= 40; i += 4) g.fillRect(0, i, 16, 0.6);
    g.clearRect(0, 0, 3, 3);
    g.clearRect(13, 0, 3, 3);
  });
  const glassMat = new THREE.MeshBasicMaterial({ map: glass, fog: false, transparent: true });
  for (let z = -1.8; z > -L + 5; z -= 3.6)
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.5), glassMat);
      add(w, side * (W / 2 - 0.02), 5.2, z, (side * -Math.PI) / 2);
    }
  const shaft = new THREE.MeshBasicMaterial({
    color: 0xb090ff,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const z of [-5.4, -12.6]) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 9), shaft);
    beam.rotation.set(0, Math.PI / 2, -0.7);
    add(beam, 3.5, 3.4, z, Math.PI / 2);
  }
  // The altar at the far end: steps, a draped block, tall candles, a gold sun.
  const stepMat = mat(repeat(bricks(0xa89c84, 0x5a5040, 27), 3, 0.3));
  for (let i = 0; i < 3; i++) add(box(6 - i * 1.2, 0.25, 3 - i * 0.6, stepMat), 0, 0.125 + i * 0.25, -L + 5 + i * 0.1);
  add(box(2.4, 1.0, 1.0, mat(solid(0xe8e0d0, 28, 0xd0a030, true))), 0, 1.25, -L + 4.6);
  const gold = mat(solid(0xd8a830, 29, 0xffe080));
  add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 4, 12), gold), 0, 4.2, -L + 3.15);
  for (let i = 0; i < 8; i++) {
    const ray = box(0.08, 0.7, 0.08, gold);
    ray.rotation.z = (i * Math.PI) / 4;
    add(ray, Math.sin((i * Math.PI) / 4) * 1.6, 4.2 + Math.cos((i * Math.PI) / 4) * 1.6, -L + 3.15);
    ray.rotation.z = -(i * Math.PI) / 4;
  }
  for (const x of [-2.6, -2, 2, 2.6]) candle(x, -L + 5.6, 1.2 + Math.abs(x) * 0.15, 0.5);
  for (const x of [-0.8, -0.3, 0.3, 0.8]) candle(x, -L + 4.6, 0.3, 1.75);
  lightAt(0xffd890, 12, 16, 0, 3, -L + 6);
  lightAt(0xffd890, 8, 14, 0, 6, -6);
  lightAt(0xb090ff, 6, 12, 4, 4, -9);

  creature(templar(), -1.3, -5.2, 0.25);
  creature(acolyte(), 1.6, -6.6, -0.3);
  creature(bellringer(), -2.2, -2.6, 0.35);
  camera.position.set(0, 1.55, 3.4);
}

// ---- creatures: nine distinct silhouettes ------------------------------------------------------

type Creature = { root: THREE.Group; arm: THREE.Group; height: number; idle?: (t: number) => void };

function limb(len: number, thick: number, m: THREE.Material, x: number, y: number, z = 0) {
  return box(thick, len, thick, m, x, y - len / 2, z);
}

function skeletonWarrior(): Creature {
  const root = new THREE.Group();
  const bone = mat(solid(0xd0c4a4, 81, 0x8a7a5a));
  const dark = mat(solid(0x5a4a38, 82));
  const red = mat(solid(0xa02018, 84, 0x601010));
  root.add(limb(0.8, 0.11, bone, -0.16, 0.8), limb(0.8, 0.11, bone, 0.16, 0.8));
  root.add(box(0.5, 0.16, 0.26, bone, 0, 0.86), box(0.08, 0.6, 0.08, dark, 0, 1.2, -0.05));
  for (let i = 0; i < 4; i++) root.add(box(0.5 - i * 0.04, 0.05, 0.3, bone, 0, 1.18 + i * 0.12));
  root.add(box(0.72, 0.09, 0.18, bone, 0, 1.64));
  root.add(box(0.32, 0.34, 0.32, [bone, bone, bone, bone, mat(face(0xd0c4a4, 'skull', 83)), bone], 0, 1.95));
  root.add(box(0.38, 0.12, 0.38, red, 0, 2.16));
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 5), bone);
    horn.position.set(s * 0.24, 2.3, 0);
    horn.rotation.z = -s * 0.6;
    root.add(horn);
  }
  // Round shield on the left arm.
  root.add(limb(0.7, 0.1, bone, -0.38, 1.64));
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 10), mat(planks(0x6a4424, 86)));
  shield.rotation.z = Math.PI / 2;
  shield.position.set(-0.48, 1.2, 0.08);
  root.add(shield);
  const arm = new THREE.Group();
  arm.position.set(0.38, 1.62, 0);
  arm.add(limb(0.7, 0.1, bone, 0, 0));
  arm.add(box(0.06, 0.9, 0.14, mat(solid(0x8a6a50, 85, 0x5a2a10)), 0, -1.1, 0.1));
  root.add(arm);
  return { root, arm, height: 2.4 };
}

/** Hunched, long-armed, knuckles near the floor: an animal more than a man. */
function ghoul(): Creature {
  const root = new THREE.Group();
  const skin = mat(solid(0x7a8a6a, 91, 0x4a5a3a));
  const rags = mat(solid(0x3a3028, 92, 0x1a140e));
  root.add(limb(0.55, 0.13, skin, -0.2, 0.55), limb(0.55, 0.13, skin, 0.2, 0.55));
  const torso = new THREE.Group();
  torso.position.set(0, 0.6, 0);
  torso.rotation.x = 0.75;
  torso.add(box(0.5, 0.75, 0.32, skin, 0, 0.38, 0));
  torso.add(box(0.52, 0.22, 0.34, rags, 0, 0.05, 0));
  for (let i = 0; i < 3; i++) torso.add(box(0.46, 0.03, 0.02, mat(solid(0x5a6a4a, 93)), 0, 0.35 + i * 0.12, 0.17));
  const head = box(0.3, 0.28, 0.32, [skin, skin, skin, skin, mat(face(0x7a8a6a, 'ghoul', 94)), skin], 0, 0.85, 0.08);
  torso.add(head);
  root.add(torso);
  // Long arms hanging nearly to the floor, with claws.
  const claw = mat(solid(0x2a2418, 95));
  root.add(limb(1.0, 0.1, skin, -0.34, 1.15, 0.35));
  for (const dx of [-0.05, 0, 0.05]) root.add(box(0.02, 0.14, 0.02, claw, -0.34 + dx, 0.1, 0.38));
  const arm = new THREE.Group();
  arm.position.set(0.34, 1.15, 0.35);
  arm.add(limb(1.0, 0.1, skin, 0, 0));
  for (const dx of [-0.05, 0, 0.05]) arm.add(box(0.02, 0.14, 0.02, claw, dx, -1.05, 0.03));
  root.add(arm);
  return { root, arm, height: 1.6 };
}

function skeletonArcher(): Creature {
  const root = new THREE.Group();
  const bone = mat(solid(0xc8bc9c, 101, 0x8a7a5a));
  const cloth = mat(solid(0x2a3a2a, 102, 0x1a241a));
  root.add(limb(0.8, 0.1, bone, -0.15, 0.8), limb(0.8, 0.1, bone, 0.15, 0.8));
  root.add(box(0.46, 0.15, 0.24, bone, 0, 0.86));
  for (let i = 0; i < 4; i++) root.add(box(0.46 - i * 0.04, 0.05, 0.28, bone, 0, 1.16 + i * 0.12));
  root.add(box(0.7, 0.42, 0.34, cloth, 0, 1.55, -0.02)); // mantle
  root.add(box(0.3, 0.32, 0.3, [bone, bone, bone, bone, mat(face(0xc8bc9c, 'skull', 103)), bone], 0, 1.92));
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 6), cloth);
  hood.position.set(0, 2.1, -0.04);
  root.add(hood);
  root.add(box(0.14, 0.7, 0.14, mat(planks(0x5a3a1e, 104)), 0.1, 1.5, -0.28)); // quiver
  const arm = new THREE.Group();
  arm.position.set(-0.36, 1.6, 0);
  arm.add(limb(0.65, 0.09, bone, 0, 0));
  const bowMat = mat(planks(0x6a4424, 105));
  for (let i = -4; i <= 4; i++) {
    const seg = box(0.04, 0.2, 0.04, bowMat, 0, -0.7 + i * 0.18, Math.cos(i / 3) * 0.18);
    seg.rotation.x = -i * 0.12;
    arm.add(seg);
  }
  root.add(arm);
  return { root, arm, height: 2.35 };
}

/** Tall, thin and stooped, long wet hair over the face, a hook on a chain. */
function drowned(): Creature {
  const root = new THREE.Group();
  const skin = mat(solid(0x8aa4a8, 111, 0x5a7a80));
  const rags = mat(solid(0x2a3a3e, 112, 0x14201e));
  const hair = mat(solid(0x16201a, 113, 0x2a4a2a, true));
  root.add(limb(1.0, 0.1, skin, -0.13, 1.0), limb(1.0, 0.1, skin, 0.13, 1.0));
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 1.3, 7, 1, true), rags);
  robe.position.y = 1.0;
  root.add(robe);
  root.add(box(0.42, 0.6, 0.26, rags, 0, 1.85));
  const head = box(
    0.28,
    0.36,
    0.28,
    [skin, skin, skin, skin, mat(face(0x8aa4a8, 'drowned', 114)), skin],
    0,
    2.35,
    0.08,
  );
  head.rotation.x = 0.3;
  root.add(head);
  // Long hair hanging down front and back.
  for (const [x, z] of [
    [-0.1, 0.24],
    [0.1, 0.24],
    [0, -0.12],
    [-0.15, 0.05],
    [0.15, 0.05],
  ] as const)
    root.add(box(0.08, 0.7, 0.03, hair, x, 2.1, z));
  root.add(limb(0.95, 0.08, skin, -0.3, 2.1, 0.1));
  const arm = new THREE.Group();
  arm.position.set(0.3, 2.1, 0.1);
  arm.add(limb(0.95, 0.08, skin, 0, 0));
  const iron = mat(solid(0x3a3430, 115, 0x6a3010));
  for (let i = 0; i < 4; i++) arm.add(box(0.04, 0.1, 0.04, iron, 0, -1.0 - i * 0.12, 0));
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 4, 8, Math.PI * 1.4), iron);
  hook.position.set(0, -1.6, 0.08);
  arm.add(hook);
  root.add(arm);
  return {
    root,
    arm,
    height: 2.6,
    idle: (t) => {
      head.rotation.z = Math.sin(t / 700) * 0.15;
    },
  };
}

/** A swollen sack of a body on stubby legs, covered in boils. */
function bloated(): Creature {
  const root = new THREE.Group();
  const skin = mat(solid(0x8a8a5a, 121, 0x6a3a5a));
  const boil = mat(solid(0xa0a060, 122, 0xd0e080));
  root.add(limb(0.45, 0.16, skin, -0.25, 0.45), limb(0.45, 0.16, skin, 0.25, 0.45));
  const belly = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), skin);
  belly.position.y = 1.15;
  belly.scale.set(1, 0.95, 0.9);
  root.add(belly);
  const r = mulberry(123);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const b = r() * Math.PI - Math.PI / 2;
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 + r() * 0.08, 0), boil);
    p.position.set(Math.cos(a) * Math.cos(b) * 0.72, 1.15 + Math.sin(b) * 0.7, Math.sin(a) * Math.cos(b) * 0.65);
    root.add(p);
  }
  root.add(box(0.24, 0.22, 0.24, [skin, skin, skin, skin, mat(face(0x8a8a5a, 'drowned', 124)), skin], 0, 1.95, 0.1));
  root.add(limb(0.4, 0.1, skin, -0.7, 1.35, 0.1));
  const arm = new THREE.Group();
  arm.position.set(0.7, 1.35, 0.1);
  arm.add(limb(0.4, 0.1, skin, 0, 0));
  root.add(arm);
  return {
    root,
    arm,
    height: 2.1,
    idle: (t) => {
      const k = 1 + Math.sin(t / 300) * 0.04;
      belly.scale.set(k, 0.95 * k, 0.9 * k);
    },
  };
}

/** A fat leech: ringed segments low to the floor, a round mouth of teeth that rears up. */
function leech(): Creature {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const a = mat(solid(0x5a1414, 131, 0x2a0606, true));
  const b = mat(solid(0x7a2a1a, 132, 0x3a0a06, true));
  for (let i = 0; i < 6; i++) {
    const r = 0.12 + Math.sin((i / 5) * Math.PI) * 0.1;
    const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? a : b);
    seg.position.set(0, r, -0.6 + i * 0.2);
    body.add(seg);
  }
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 8), mat(solid(0x1a0606, 133, 0xe8d8c0)));
  mouth.rotation.x = Math.PI / 2;
  mouth.position.set(0, 0.16, 0.5);
  body.add(mouth);
  root.add(body);
  return {
    root,
    arm: body,
    height: 0.4,
    idle: (t) => {
      body.children.forEach((c, i) => (c.position.x = Math.sin(t / 250 + i * 0.8) * 0.05));
    },
  };
}

/** Full plate, a great helm with an eye slit, a white tabard with a gold cross, a tower shield. */
function templar(): Creature {
  const root = new THREE.Group();
  const steel = mat(solid(0x9aa0aa, 141, 0x5a606a));
  const white = mat(solid(0xe8e4d8, 142, 0xb0a890));
  const gold = mat(solid(0xd0a030, 143, 0xffe080));
  root.add(limb(0.85, 0.15, steel, -0.17, 0.85), limb(0.85, 0.15, steel, 0.17, 0.85));
  root.add(box(0.58, 0.75, 0.34, steel, 0, 1.25));
  root.add(box(0.5, 0.95, 0.03, white, 0, 1.05, 0.18));
  root.add(box(0.08, 0.7, 0.035, gold, 0, 1.15, 0.2), box(0.36, 0.08, 0.035, gold, 0, 1.3, 0.2));
  for (const s of [-1, 1]) root.add(box(0.28, 0.2, 0.36, steel, s * 0.42, 1.62)); // pauldrons
  root.add(box(0.34, 0.4, 0.34, [steel, steel, steel, steel, mat(face(0x9aa0aa, 'helm', 144)), steel], 0, 1.85));
  // Tower shield.
  const shieldT = pixelTexture(16, 24, 145, (g) => {
    g.fillStyle = '#e8e4d8';
    g.fillRect(0, 0, 16, 24);
    g.fillStyle = '#d0a030';
    g.fillRect(7, 2, 2, 20);
    g.fillRect(3, 8, 10, 2);
    g.fillStyle = '#5a606a';
    g.fillRect(0, 0, 16, 0.6);
    g.fillRect(0, 23.4, 16, 0.6);
    g.fillRect(0, 0, 0.6, 24);
    g.fillRect(15.4, 0, 0.6, 24);
  });
  root.add(box(0.06, 1.25, 0.75, [steel, steel, steel, steel, mat(shieldT), mat(shieldT)], -0.48, 1.1, 0.15));
  const arm = new THREE.Group();
  arm.position.set(0.42, 1.6, 0);
  arm.add(limb(0.7, 0.13, steel, 0, 0));
  arm.add(box(0.05, 1.1, 0.1, mat(solid(0xc8ccd4, 146)), 0, -1.2, 0.12));
  arm.add(box(0.26, 0.05, 0.08, gold, 0, -0.68, 0.12));
  root.add(arm);
  return { root, arm, height: 2.1 };
}

/** A white-robed priest with a golden mask, swinging a smoking censer. */
function acolyte(): Creature {
  const root = new THREE.Group();
  const robeMat = mat(solid(0xe0dccc, 151, 0xb8a888, true));
  const gold = mat(solid(0xd8a830, 152, 0xffe080));
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 1.6, 8), robeMat);
  robe.position.y = 0.8;
  root.add(robe);
  root.add(box(0.06, 1.5, 0.02, gold, 0, 0.85, 0.36));
  root.add(box(0.44, 0.4, 0.3, robeMat, 0, 1.75));
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 8), robeMat);
  hood.position.set(0, 2.25, -0.02);
  root.add(hood);
  root.add(box(0.24, 0.26, 0.04, mat(face(0xe8c050, 'mask', 153)), 0, 2.05, 0.15));
  root.add(limb(0.6, 0.1, robeMat, -0.3, 1.9));
  const arm = new THREE.Group();
  arm.position.set(0.3, 1.9, 0.05);
  arm.add(limb(0.6, 0.1, robeMat, 0, 0));
  for (let i = 0; i < 4; i++) arm.add(box(0.02, 0.1, 0.02, gold, 0, -0.65 - i * 0.1, 0.05));
  const censer = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), gold);
  censer.position.set(0, -1.12, 0.05);
  arm.add(censer);
  const smoke = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14, 0),
    new THREE.MeshBasicMaterial({ color: 0xd0c8b8, transparent: true, opacity: 0.35, fog: false }),
  );
  smoke.position.set(0, -0.9, 0.05);
  arm.add(smoke);
  root.add(arm);
  return {
    root,
    arm,
    height: 2.5,
    idle: (t) => {
      smoke.position.y = -0.9 + ((t / 900) % 1) * 0.6;
      (smoke.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - ((t / 900) % 1));
    },
  };
}

/** A hunchback monk in brown, a great bronze bell held in both arms. */
function bellringer(): Creature {
  const root = new THREE.Group();
  const robeMat = mat(solid(0x5a3e24, 161, 0x2a1a0c, true));
  const skin = mat(solid(0xc89a78, 162, 0x8a6a50));
  const bronze = mat(solid(0xb07a30, 163, 0xe0b060));
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 1.2, 8), robeMat);
  robe.position.y = 0.6;
  root.add(robe);
  const back = new THREE.Group();
  back.position.set(0, 1.15, 0);
  back.rotation.x = 0.5;
  back.add(box(0.6, 0.6, 0.45, robeMat, 0, 0.25, -0.05));
  back.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), robeMat).translateY(0.45).translateZ(-0.22)); // hump
  back.add(box(0.28, 0.28, 0.28, [skin, skin, skin, skin, mat(face(0xc89a78, 'hood', 164)), skin], 0, 0.62, 0.22));
  const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 7), robeMat);
  cowl.position.set(0, 0.85, 0.15);
  back.add(cowl);
  root.add(back);
  const arm = new THREE.Group();
  arm.position.set(0, 1.35, 0.4);
  const bell = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.05, 0.5),
        new THREE.Vector2(0.2, 0.42),
        new THREE.Vector2(0.26, 0.2),
        new THREE.Vector2(0.38, 0),
      ],
      10,
    ),
    bronze,
  );
  bell.position.set(0, -0.8, 0.15);
  arm.add(bell);
  arm.add(limb(0.35, 0.09, skin, -0.2, 0), limb(0.35, 0.09, skin, 0.2, 0));
  root.add(arm);
  return { root, arm, height: 2.0 };
}

// ---- the hero's hands: a sword in the right, a shield on the left -----------------------------

const hands = new THREE.Group();
camera.add(hands);
const gauntlet = mat(solid(0xc8c8cc, 171, 0x8a1a10));
const steel = mat(solid(0xb0b4bc, 172, 0x7a1010));
const right = new THREE.Group();
right.add(box(0.14, 0.14, 0.42, gauntlet, 0, 0, 0.1));
right.add(box(0.16, 0.14, 0.14, gauntlet, 0, 0.02, -0.14));
for (let i = 0; i < 3; i++) {
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 4), mat(solid(0x8a1a10, 173)));
  spike.position.set(0.08, 0.02, 0.15 - i * 0.12);
  spike.rotation.z = -Math.PI / 2;
  right.add(spike);
}
const sword = new THREE.Group();
sword.add(box(0.04, 0.16, 0.04, mat(planks(0x3a2414, 174)), 0, 0.02, 0));
sword.add(box(0.26, 0.03, 0.05, steel, 0, 0.1, 0));
sword.add(box(0.1, 0.72, 0.02, steel, 0, 0.47, 0));
sword.add(box(0.02, 0.72, 0.024, mat(solid(0xe8eaf0, 175)), 0, 0.47, 0));
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
const shieldT = pixelTexture(16, 16, 176, (g) => {
  g.fillStyle = '#6a4424';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#8a2018';
  g.fillRect(6, 0, 4, 16);
  g.fillRect(0, 6, 16, 4);
  g.fillStyle = '#3a3634';
  g.fillRect(0, 0, 16, 0.6);
  g.fillRect(0, 15.4, 16, 0.6);
  g.fillRect(0, 0, 0.6, 16);
  g.fillRect(15.4, 0, 0.6, 16);
});
left.add(box(0.34, 0.42, 0.04, mat(shieldT), 0.04, 0.05, -0.12));
left.position.set(-0.5, -0.42, -0.62);
left.rotation.set(0.05, 0.55, -0.15);
hands.add(left);

// ---- input and loop -------------------------------------------------------------------------------

let yaw = 0;
let pitch = 0;
let swingStart = -1e9;
/** A miniature's round base: dark, with a lighter painted rim and a little scenic grit on top. */
function miniBase(color: number, r: number) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.05, 0.08, 24),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  base.position.y = 0.04;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(r * 1.02, 0.012, 4, 24),
    new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.5 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.08;
  g.add(base, rim);
  return g;
}

/** The hero as a miniature: a knight in a blue tabard with sword and shield, on a gold-rimmed base. */
function heroMini() {
  const root = new THREE.Group();
  const steel = mat(solid(0xa8aeb8, 181, 0x6a707a));
  const blue = mat(solid(0x2a4a9a, 182, 0x1a2a6a));
  const gold = mat(solid(0xd8a830, 183));
  root.add(limb(0.85, 0.15, steel, -0.17, 0.85), limb(0.85, 0.15, steel, 0.17, 0.85));
  root.add(box(0.56, 0.72, 0.32, steel, 0, 1.24), box(0.5, 0.9, 0.03, blue, 0, 1.05, 0.17));
  root.add(box(0.34, 0.36, 0.34, [steel, steel, steel, steel, mat(face(0xa8aeb8, 'helm', 184)), steel], 0, 1.82));
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 6), mat(solid(0xb02020, 185)));
  plume.position.set(0, 2.15, -0.05);
  root.add(plume);
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), mat(solid(0xa02020, 186, 0xd8a830)));
  shield.rotation.z = Math.PI / 2;
  shield.position.set(-0.44, 1.25, 0.1);
  root.add(shield);
  root.add(
    box(0.05, 1.0, 0.09, mat(solid(0xd8dce4, 187)), 0.42, 1.55, 0.25),
    box(0.24, 0.05, 0.08, gold, 0.42, 1.1, 0.25),
  );
  const base = miniBase(0x1e2a1e, 0.45);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.47, 0.02, 4, 24),
    new THREE.MeshStandardMaterial({ color: 0xffd060, roughness: 0.3, metalness: 0.6 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.085;
  root.add(base, ring);
  return root;
}

/** The table the model stands on, and the lamp above it. */
function tabletop(center: THREE.Vector3, size: number) {
  const wood = mat(planks(0x6a4428, 191));
  (wood as THREE.MeshStandardMaterial).map!.repeat.set(size / 3, size / 3);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(size * 3, size * 3).rotateX(-Math.PI / 2), wood);
  table.position.set(center.x, -0.12, center.z);
  table.receiveShadow = true;
  world.add(table);
  // The board's edge under the tiles.
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(size * 1.05, 0.12, size * 1.05),
    new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7 }),
  );
  edge.position.set(center.x, -0.06, center.z);
  world.add(edge);
  const lamp = new THREE.SpotLight(0xffe2b0, 220, 60, 0.75, 0.6, 1.2);
  lamp.position.set(center.x - 4, 18, center.z + 6);
  lamp.target.position.copy(center);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0004;
  world.add(lamp, lamp.target);
  world.add(new THREE.HemisphereLight(0xfff0dc, 0x2a2018, 0.9));
}

const CENTERS: Record<Biome, { center: THREE.Vector3; size: number; cam: THREE.Vector3 }> = {
  crypt: { center: new THREE.Vector3(0, 0, -4.5), size: 15, cam: new THREE.Vector3(0, 11, 6.5) },
  catacombs: { center: new THREE.Vector3(0, 0, -6), size: 16, cam: new THREE.Vector3(-1, 12, 7) },
  cathedral: { center: new THREE.Vector3(0, 0, -8), size: 24, cam: new THREE.Vector3(0, 15, 6) },
};

let composerResize: ((w: number, h: number) => void) | null = null;

let build = function build(b: Biome) {
  world.clear();
  lights.length = 0;
  flames.length = 0;
  creatures.length = 0;
  if (b === 'catacombs') buildCatacombs();
  else if (b === 'cathedral') buildCathedral();
  else buildCrypt();
  if (mini) {
    const c = CENTERS[b];
    tabletop(c.center, c.size);
    scene.fog = top ? null : new THREE.Fog(0x2a2018, 8, 40);
    scene.background = new THREE.Color(0x1a120c);
    // The hero stands where the camera is, as a figure on the board.
    if (top) {
      const hero = heroMini();
      hero.position.set(camera.position.x, 0, camera.position.z - 1.5);
      hero.rotation.y = Math.PI;
      world.add(hero);
      camera.position.copy(c.center).add(c.cam);
      camera.lookAt(c.center);
    }
    // Anything that lives entirely above the cut (ceiling, ribs, beams) is simply not part of the model.
    world.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    world.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (bounds.setFromObject(o).min.y > 2.4) o.visible = false;
    });
    for (const l of lights) l.light.intensity *= 0.5;
  }
  yaw = b === 'catacombs' ? -0.12 : 0;
  pitch = b === 'cathedral' ? 0.06 : -0.03;
};

let dragging = false;
canvas.addEventListener('pointerdown', () => (dragging = true));
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= e.movementX * 0.004;
  pitch = Math.max(-0.6, Math.min(0.8, pitch - e.movementY * 0.004));
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') swingStart = performance.now();
  const b = ({ Digit1: 'crypt', Digit2: 'catacombs', Digit3: 'cathedral' } as Record<string, Biome>)[e.code];
  if (b) {
    biome = b;
    build(biome);
  }
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const lowW = Math.round((LOW_H * w) / h);
  // Hybrid: the whole chain runs at the pixel resolution and the canvas is scaled up by CSS.
  if (smooth) {
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(w, h, false);
  } else if (hybrid) renderer.setSize(lowW, LOW_H, false);
  else renderer.setSize(w, h, false);
  if (smooth) composerResize?.(w, h);
  else composerResize?.(lowW, LOW_H);
  target.setSize(lowW, LOW_H);
  (post.material as THREE.ShaderMaterial).uniforms.uRes!.value.set(lowW, LOW_H);
  // Vertex wobble at a coarser grid than the pixels, so it still reads at high resolution.
  snapRes.set(lowW * 0.6, LOW_H * 0.6);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
build(biome);

// The hybrid look: the scene goes through bloom, a soft depth of field and a vignette at the pixel
// resolution; the canvas is then shown scaled up without smoothing.
// Smooth: the chain renders into a multisampled target, so edges are antialiased.
const composer = hybrid
  ? new EffectComposer(
      renderer,
      smooth ? new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType }) : undefined,
    )
  : null;
const bokeh = hybrid ? new BokehPass(scene, camera, { focus: 5.5, aperture: 0.0012, maxblur: 0.005 }) : null;
if (composer && bokeh) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bokeh);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.85));
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(c.rgb * mix(0.55, 1.0, smoothstep(0.95, 0.3, length(vUv - 0.5))), c.a); }`,
    }),
  );
  composer.addPass(new OutputPass());
  canvas.style.imageRendering = smooth ? 'auto' : 'pixelated';
  composerResize = (w, h) => composer.setSize(w, h);
  resize();
}
// The torch in the hero's hand lights what stands in front and throws its shadows back.
const handTorch = new THREE.PointLight(0xffb070, hybrid ? 6 : 0, 12, 1.2);
handTorch.position.set(-0.7, 0.55, -1.5);
handTorch.castShadow = hybrid;
handTorch.shadow.mapSize.set(512, 512);
handTorch.shadow.bias = -0.002;
camera.add(handTorch);
// A soft warm fill on the hands themselves, from the same torch, so the shield is not a black slab.
const handFill = new THREE.PointLight(0xffb070, hybrid ? 0.5 : 0, 1.6, 1);
handFill.position.set(-0.2, 0.1, 0.1);
camera.add(handFill);
let dust: THREE.Points | null = null;
function addDust() {
  const n = 220;
  const pos = new Float32Array(n * 3);
  const r = mulberry(5);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = camera.position.x + (r() - 0.5) * 7;
    pos[i * 3 + 1] = r() * 3;
    pos[i * 3 + 2] = camera.position.z - 0.5 - r() * 9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: new THREE.Color(1.4, 1.15, 0.8),
      size: 0.018,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  world.add(dust);
}
if (hybrid) {
  // Shadows from the hero's torch; dust over the first few metres.
  const rebuild = build;
  build = (b: Biome) => {
    rebuild(b);
    world.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = !(o.geometry instanceof THREE.PlaneGeometry);
        o.receiveShadow = true;
      }
    });
    addDust();
    (bokeh!.uniforms as Record<string, THREE.IUniform>).focus!.value = b === 'cathedral' ? 7 : 5.5;
  };
  build(biome);
}

let frame = 0;
function loop(now: number) {
  const t = still ? 1000 : now;
  frame++;
  if (frame % 6 === 0) for (const f of flames) f.redraw();
  for (const l of lights)
    l.light.intensity = l.base * (0.85 + 0.1 * Math.sin(t / 90 + l.phase) + 0.05 * Math.sin(t / 37));
  for (const c of creatures) {
    c.root.position.y = Math.abs(Math.sin(t / 420 + c.phase)) * 0.03;
    c.arm.rotation.x = -0.4 + Math.sin(t / 520 + c.phase) * 0.35;
    c.bar.quaternion.copy(camera.quaternion);
    c.idle(t);
  }
  if (!(mini && top)) camera.rotation.set(pitch + (still ? 0 : Math.sin(now / 900) * 0.01), yaw, 0, 'YXZ');
  hands.visible = !(mini && top);
  const s = (now - swingStart) / 320;
  const chop = s >= 0 && s < 1 ? Math.sin(s * Math.PI) : 0;
  right.rotation.x = 0.1 - chop * 1.3;
  right.position.y = -0.32 + chop * 0.12 + (still ? 0 : Math.sin(now / 600) * 0.01);
  left.position.y = -0.42 + (still ? 0 : Math.sin(now / 600 + 1) * 0.01);
  if (dust && !still) {
    const a = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setY(i, (a.getY(i) + 0.0025) % 3);
    a.needsUpdate = true;
  }
  if (composer) {
    handTorch.intensity = 6 * (0.9 + 0.07 * Math.sin(t / 80) + 0.03 * Math.sin(t / 31));
    composer.render();
  } else {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Console access while tuning the look.
Object.assign(window, { __scene: scene, __camera: camera, __three: THREE });
