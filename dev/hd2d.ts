import * as THREE from 'three';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Style test (owner request): Legend of Grimrock's first-person grid dungeons with Octopath's HD-2D
 * treatment, in a western dark-fantasy palette. Stone-block corridors and rooms built cell by cell
 * (our game moves on the same grid), creatures as hand-shaded pixel-art sprites standing in the lit
 * 3D world, torches that bloom, depth of field, dust in the light, the hero's hands drawn in 2D.
 *
 *   ?biome=crypt|catacombs|cathedral   ?still=1 (for screenshots)
 */

type Biome = 'crypt' | 'catacombs' | 'cathedral';
const params = new URLSearchParams(location.search);
let biome = (params.get('biome') as Biome | null) ?? 'crypt';
const still = params.has('still');

const CELL = 2.4;
/** Metres per sprite pixel: a 64-pixel-tall figure is about 1.9 m. */
const PX = 0.03;

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

// ---- pixel art: a tiny painter with shaded shapes, ordered dithering and an outline -----------

type Ramp = readonly string[];
const R = {
  bone: ['#3a2e22', '#7a6a50', '#b8a684', '#e4d8bc', '#fff4dc'],
  boneDark: ['#2a2018', '#4a3c2c', '#6a5a44'],
  rust: ['#2a140a', '#6a3418', '#a05a2a', '#c88a4a'],
  steel: ['#1e2228', '#4a525e', '#7a8696', '#b4c0cc', '#eef4fa'],
  red: ['#2a0606', '#6a1010', '#a8221a', '#d8483a'],
  wood: ['#24140a', '#4a2c16', '#7a4a24', '#a8703a'],
  ghoul: ['#1a2014', '#3a4a2c', '#5e7246', '#8aa068', '#b4c890'],
  rag: ['#140e0a', '#2e221a', '#4a382a'],
  green: ['#0e1a10', '#1e3422', '#345234', '#4e7248'],
  drowned: ['#14222a', '#33505c', '#5a808c', '#8eb2b8', '#c4e0e0'],
  hair: ['#060c0a', '#14201a', '#24382a'],
  teal: ['#081416', '#14282c', '#22424a', '#346068'],
  bloat: ['#2a2410', '#5a5226', '#8a8240', '#b8b066', '#e0d898'],
  boil: ['#3a1430', '#6a2a5a', '#9a4a84', '#d088b8'],
  leech: ['#1a0606', '#4a0e0e', '#7a1e18', '#a8402c'],
  white: ['#4a463e', '#8a8478', '#c8c0b0', '#eee8da', '#ffffff'],
  gold: ['#3a2406', '#7a5410', '#c08a20', '#ecc048', '#fff0a0'],
  brown: ['#1a100a', '#3a2414', '#5a3a20', '#7a5430'],
  bronze: ['#2a1a08', '#6a4418', '#a87030', '#d8a050', '#f8d890'],
  skin: ['#3a2418', '#7a5038', '#b08060', '#d8ac88'],
} as const;
const BAYER2 = [0, 2, 3, 1];

class Pix {
  readonly px: (string | null)[];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array<string | null>(w * h).fill(null);
  }
  set(x: number, y: number, c: string | null) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null;
  }
  /** Light from the upper left: 0 (dark) .. 1 (lit), dithered between the ramp's steps. */
  private pick(ramp: Ramp, lit: number, x: number, y: number) {
    const f = Math.max(0, Math.min(0.999, lit)) * (ramp.length - 1);
    const i = Math.floor(f);
    const step = f - i > (BAYER2[(x % 2) + (y % 2) * 2]! + 0.5) / 4 ? i + 1 : i;
    return ramp[Math.min(ramp.length - 1, step)]!;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, ramp: Ramp, bias = 0) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const lit = 0.55 - 0.42 * (nx * 0.6 + ny * 0.8) - d * 0.18 + bias;
        this.set(x, y, this.pick(ramp, lit, x, y));
      }
  }
  rect(x0: number, y0: number, w: number, h: number, ramp: Ramp, bias = 0) {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const lit =
          0.78 - ((x - x0) / Math.max(1, w)) * 0.5 - ((y - y0) / Math.max(1, h)) * 0.15 + (y === y0 ? 0.15 : 0) + bias;
        this.set(x, y, this.pick(ramp, lit, x, y));
      }
  }
  /** A trapezoid from width w0 at the top to w1 at the bottom (robes, bells). */
  trap(cx: number, y0: number, h: number, w0: number, w1: number, ramp: Ramp, bias = 0) {
    for (let y = y0; y < y0 + h; y++) {
      const w = w0 + ((w1 - w0) * (y - y0)) / Math.max(1, h - 1);
      for (let x = Math.round(cx - w / 2); x < Math.round(cx + w / 2); x++) {
        const lit = 0.75 - ((x - (cx - w / 2)) / w) * 0.55 + bias;
        this.set(x, y, this.pick(ramp, lit, x, y));
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string, thick = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let t = 0; t < thick; t++) this.set(x + t, y, c);
    }
  }
  /** A limb: a line shaded light on its left edge, dark on its right. */
  limb(x0: number, y0: number, x1: number, y1: number, ramp: Ramp, thick = 2) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let t = 0; t < thick; t++) this.set(x + t, y, ramp[Math.max(1, ramp.length - 2 - t)]!);
    }
  }
  /** A dark outline around everything drawn (the pixel-art look), then a canvas. */
  canvas(outline = '#120a08') {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x + 1, y) || this.get(x - 1, y) || this.get(x, y + 1) || this.get(x, y - 1))
          add.push(y * this.w + x);
      }
    for (const i of add) this.px[i] = outline;
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext('2d')!;
    for (let i = 0; i < this.px.length; i++) {
      const p = this.px[i];
      if (!p) continue;
      g.fillStyle = p;
      g.fillRect(i % this.w, Math.floor(i / this.w), 1, 1);
    }
    return c;
  }
  texture(outline?: string) {
    const t = new THREE.CanvasTexture(this.canvas(outline));
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

// ---- nine creatures, three per biome --------------------------------------------------------------

function skull(p: Pix, cx: number, cy: number, eye = '#ffb030') {
  p.ellipse(cx, cy, 5.5, 5.5, R.bone, 0.1);
  p.rect(cx - 4, cy + 3, 8, 4, R.bone);
  for (const ex of [-2.5, 1.5]) {
    p.rect(Math.round(cx + ex), cy - 1, 2, 2, ['#0a0604']);
    p.set(cx + ex + 0.5, cy - 0.5, eye);
  }
  p.set(cx, cy + 2, '#0a0604');
  for (let x = -3; x <= 3; x += 2) p.set(cx + x, cy + 5, '#2a1e14');
}

function skeletonWarrior() {
  const p = new Pix(48, 64);
  p.limb(19, 44, 18, 62, R.bone);
  p.limb(27, 44, 28, 62, R.bone);
  p.rect(17, 61, 4, 2, R.bone);
  p.rect(27, 61, 4, 2, R.bone);
  p.ellipse(23.5, 42, 7, 3, R.bone);
  p.line(23, 27, 23, 41, R.boneDark[1]!, 2);
  for (let i = 0; i < 4; i++) p.ellipse(23.5, 29 + i * 3.2, 8 - i * 0.8, 1.4, R.bone);
  p.rect(14, 25, 20, 2, R.bone);
  // Shield arm, round shield with an iron rim and a boss.
  p.limb(15, 26, 12, 40, R.bone);
  p.ellipse(11, 38, 7, 9, R.wood, 0.05);
  for (let a = 0; a < 40; a++)
    p.set(11 + Math.cos((a / 40) * 6.28) * 7, 38 + Math.sin((a / 40) * 6.28) * 9, R.steel[1]!);
  p.ellipse(11, 38, 2, 2, R.steel, 0.2);
  // Sword arm raised, a rusty broad blade.
  p.limb(33, 26, 37, 34, R.bone);
  p.rect(35, 33, 5, 2, R.wood);
  for (let y = 6; y < 33; y++) p.rect(37, y, 3, 1, R.rust, 0.1);
  p.set(38, 5, R.rust[2]!);
  skull(p, 23.5, 17);
  // Horned red helm.
  for (let y = 9; y < 16; y++)
    for (let x = 17; x < 31; x++)
      if ((x - 23.5) ** 2 / 49 + (y - 15.5) ** 2 / 36 <= 1 && y < 14) p.set(x, y, R.red[y < 11 ? 3 : 2]!);
  p.limb(17, 12, 12, 4, R.bone);
  p.limb(30, 12, 35, 4, R.bone);
  return { tex: p.texture(), w: 48, h: 64 };
}

function ghoul() {
  const p = new Pix(48, 64);
  p.limb(18, 50, 16, 62, R.ghoul, 3);
  p.limb(27, 50, 30, 62, R.ghoul, 3);
  p.ellipse(23, 42, 11, 10, R.ghoul);
  for (let i = 0; i < 4; i++) p.line(15, 38 + i * 2.5, 29, 37 + i * 2.5, R.ghoul[1]!);
  p.trap(23, 47, 6, 20, 22, R.rag);
  // Long arms to the floor, claws.
  p.limb(14, 36, 8, 60, R.ghoul, 3);
  p.limb(32, 37, 38, 60, R.ghoul, 3);
  for (const x of [6, 8, 10, 36, 38, 40]) p.line(x, 60, x, 63, R.bone[3]!);
  // Head thrust forward, red eyes, a mouth of teeth.
  p.ellipse(29, 30, 7, 6, R.ghoul, 0.05);
  p.rect(25, 28, 3, 2, ['#1a0404']);
  p.rect(31, 28, 3, 2, ['#1a0404']);
  p.set(26, 28, '#ff3020');
  p.set(32, 28, '#ff3020');
  p.rect(25, 33, 9, 3, ['#200606']);
  for (let x = 25; x < 34; x += 2) p.set(x, 33, R.bone[3]!);
  return { tex: p.texture(), w: 48, h: 64 };
}

function skeletonArcher() {
  const p = new Pix(48, 64);
  p.limb(21, 44, 20, 62, R.bone);
  p.limb(27, 44, 28, 62, R.bone);
  p.ellipse(24, 42, 6, 3, R.bone);
  for (let i = 0; i < 4; i++) p.ellipse(24, 30 + i * 3, 7 - i * 0.7, 1.3, R.bone);
  p.trap(24, 22, 8, 16, 22, R.green);
  skull(p, 24, 17, '#80ff60');
  // Hood over the skull.
  p.trap(24, 8, 7, 4, 14, R.green, 0.1);
  for (let y = 10; y < 22; y++) {
    p.set(17 - (y - 10) * 0.1, y, R.green[2]!);
    p.set(30 + (y - 10) * 0.1, y, R.green[1]!);
  }
  // Bow drawn on the left, string taut.
  p.limb(17, 26, 11, 32, R.bone);
  for (let y = 10; y <= 54; y++) p.set(10 - Math.round(Math.sin(((y - 10) / 44) * Math.PI) * 5), y, R.wood[2]!);
  p.line(10, 10, 10, 54, '#d8d0b8');
  p.rect(36, 18, 3, 16, R.wood); // quiver
  for (const x of [36, 37, 38]) p.line(x, 14, x, 17, '#d8d8c8');
  return { tex: p.texture(), w: 48, h: 64 };
}

function drowned() {
  const p = new Pix(48, 72);
  p.trap(24, 30, 42, 12, 24, R.teal);
  for (let i = 0; i < 10; i++) p.line(13 + i * 2.4, 66, 13 + i * 2.4 + (i % 2), 71, R.teal[1]!);
  p.rect(18, 22, 12, 10, R.teal, 0.1);
  // Thin arms, a hook on a chain.
  p.limb(17, 24, 13, 48, R.drowned);
  p.limb(30, 24, 34, 46, R.drowned);
  for (let y = 46; y < 60; y += 2) p.set(35, y, R.steel[2]!);
  p.line(33, 60, 37, 60, R.steel[2]!);
  p.line(37, 60, 37, 56, R.steel[2]!);
  // Head, lank hair hanging over it, pale eyes glowing through.
  p.ellipse(24, 14, 6, 7, R.drowned, 0.05);
  for (const x of [17, 18, 19, 20, 28, 29, 30, 31])
    p.line(x, 6, x + (x < 24 ? -1 : 1), 30 + (x % 3) * 2, R.hair[1 + (x % 2)]!);
  p.line(19, 6, 29, 6, R.hair[1]!, 1);
  p.set(22, 14, '#a0f0ff');
  p.set(26, 14, '#a0f0ff');
  p.rect(23, 18, 3, 2, ['#0a1418']);
  return { tex: p.texture(), w: 48, h: 72 };
}

function bloated() {
  const p = new Pix(56, 64);
  p.limb(20, 54, 19, 63, R.bloat, 4);
  p.limb(33, 54, 34, 63, R.bloat, 4);
  p.ellipse(28, 38, 19, 18, R.bloat);
  const r = mulberry(7);
  for (let i = 0; i < 8; i++) p.ellipse(16 + r() * 24, 26 + r() * 24, 2 + r() * 1.5, 2 + r() * 1.5, R.boil);
  p.limb(10, 34, 6, 44, R.bloat, 3);
  p.limb(45, 34, 49, 44, R.bloat, 3);
  p.ellipse(28, 18, 5, 5, R.bloat, 0.05);
  p.rect(25, 17, 2, 1, ['#200a10']);
  p.rect(30, 17, 2, 1, ['#200a10']);
  p.rect(26, 20, 4, 2, ['#3a0a14']);
  return { tex: p.texture(), w: 56, h: 64 };
}

function leech() {
  const p = new Pix(48, 24);
  for (let i = 0; i < 6; i++)
    p.ellipse(8 + i * 5.5, 18 - Math.sin((i / 5) * 3) * 2, 4 + Math.sin((i / 5) * 3) * 2, 4, R.leech, i % 2 ? 0 : 0.08);
  p.ellipse(41, 11, 4, 5, R.leech, 0.1);
  p.ellipse(42, 10, 2.5, 3, ['#100404', '#200808']);
  for (const [x, y] of [
    [40, 8],
    [43, 8],
    [44, 11],
    [40, 12],
  ] as const)
    p.set(x, y, R.bone[3]!);
  return { tex: p.texture(), w: 48, h: 24 };
}

function templar() {
  const p = new Pix(52, 66);
  p.rect(20, 46, 5, 18, R.steel);
  p.rect(27, 46, 5, 18, R.steel);
  p.rect(18, 26, 16, 21, R.steel);
  p.rect(20, 28, 12, 26, R.white);
  p.rect(25, 31, 2, 16, R.gold);
  p.rect(21, 36, 10, 2, R.gold);
  p.ellipse(17, 27, 4, 3, R.steel, 0.1);
  p.ellipse(35, 27, 4, 3, R.steel);
  p.rect(20, 10, 12, 14, R.steel, 0.05);
  p.rect(21, 15, 10, 1, ['#08080a']);
  p.rect(25, 16, 2, 5, ['#08080a']);
  p.line(26, 10, 26, 14, R.gold[3]!);
  // Tower shield with a gold cross.
  p.rect(5, 24, 12, 30, R.white, 0.05);
  for (let y = 24; y < 54; y++) {
    p.set(5, y, R.steel[1]!);
    p.set(16, y, R.steel[1]!);
  }
  p.rect(10, 27, 2, 24, R.gold);
  p.rect(7, 33, 8, 2, R.gold);
  // Sword raised.
  p.limb(35, 28, 40, 36, R.steel, 3);
  p.rect(37, 35, 7, 2, R.gold);
  for (let y = 8; y < 35; y++) p.rect(39, y, 3, 1, R.steel, 0.15);
  return { tex: p.texture(), w: 52, h: 66 };
}

function acolyte() {
  const p = new Pix(48, 70);
  p.trap(24, 24, 46, 12, 30, R.white);
  p.line(24, 26, 24, 69, R.gold[3]!, 2);
  p.trap(24, 4, 16, 4, 16, R.white, 0.05);
  p.ellipse(24, 16, 4.5, 5, R.gold, 0.15);
  p.rect(21, 15, 2, 1, ['#100806']);
  p.rect(26, 15, 2, 1, ['#100806']);
  p.limb(15, 28, 12, 44, R.white);
  p.limb(32, 28, 36, 40, R.white);
  for (let y = 40; y < 54; y += 2) p.set(37, y, R.gold[2]!);
  p.ellipse(37, 56, 3, 3, R.gold, 0.2);
  for (const [x, y] of [
    [36, 50],
    [39, 47],
    [35, 44],
    [38, 41],
  ] as const)
    p.ellipse(x, y, 1.5, 1.5, ['#9a948a', '#c8c0b4']);
  return { tex: p.texture(), w: 48, h: 70 };
}

function bellringer() {
  const p = new Pix(52, 60);
  p.trap(24, 30, 30, 18, 30, R.brown);
  p.ellipse(22, 26, 13, 11, R.brown, 0.05); // hunched back
  p.ellipse(31, 30, 6, 6, R.brown, 0.1); // cowl
  p.ellipse(33, 32, 3.5, 3.5, R.skin);
  p.set(32, 31, '#ff5030');
  p.set(35, 31, '#ff5030');
  p.limb(30, 36, 28, 44, R.skin);
  p.limb(38, 36, 36, 44, R.skin);
  // A great bronze bell held in front.
  p.trap(32, 42, 14, 6, 18, R.bronze, 0.05);
  p.rect(23, 55, 18, 2, R.bronze);
  p.ellipse(32, 57, 2, 1.5, R.bronze);
  return { tex: p.texture(), w: 52, h: 60 };
}

// ---- dungeon textures: crisp pixel art at high resolution ----------------------------------------

function canvasTexture(
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
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rgb = (c: number, k: number) =>
  `rgb(${Math.min(255, ((c >> 16) & 255) * k)},${Math.min(255, ((c >> 8) & 255) * k)},${Math.min(255, (c & 255) * k)})`;

/** A Grimrock wall face: big dressed stone blocks of varying sizes, a base course, chips and moss. */
function wallFace(base: number, mortar: number, seed: number, moss = 0) {
  return canvasTexture(96, 120, seed, (g, r) => {
    g.fillStyle = rgb(mortar, 1);
    g.fillRect(0, 0, 96, 120);
    let y = 0;
    while (y < 108) {
      const h = 8 + Math.floor(r() * 3) * 2;
      let x = -Math.floor(r() * 20);
      while (x < 96) {
        const w = 12 + Math.floor(r() * 4) * 4;
        const k = 0.72 + r() * 0.4;
        g.fillStyle = rgb(base, k);
        g.fillRect(x + 1, y + 1, w - 2, h - 2);
        g.fillStyle = rgb(base, k * 1.25);
        g.fillRect(x + 1, y + 1, w - 2, 1);
        g.fillRect(x + 1, y + 1, 1, h - 2);
        g.fillStyle = rgb(base, k * 0.7);
        g.fillRect(x + 1, y + h - 2, w - 2, 1);
        g.fillRect(x + w - 2, y + 1, 1, h - 2);
        for (let i = 0; i < 14; i++) {
          g.fillStyle = rgb(base, k * (0.82 + r() * 0.3));
          g.fillRect(x + 2 + Math.floor(r() * (w - 4)), y + 2 + Math.floor(r() * (h - 4)), 1 + Math.floor(r() * 2), 1);
        }
        x += w;
      }
      y += h;
    }
    // Base course.
    g.fillStyle = rgb(base, 0.55);
    g.fillRect(0, 108, 96, 12);
    g.fillStyle = rgb(base, 0.75);
    g.fillRect(0, 108, 96, 1);
    if (moss)
      for (let i = 0; i < 500 * moss; i++) {
        g.fillStyle = `rgb(${40 + r() * 30},${70 + r() * 50},${36 + r() * 20})`;
        g.fillRect(Math.floor(r() * 96), 80 + Math.floor(r() * r() * 40), 1 + Math.floor(r() * 2), 1);
      }
  });
}

function floorTiles(base: number, seed: number, checker = false) {
  return canvasTexture(64, 64, seed, (g, r) => {
    g.fillStyle = rgb(base, 0.35);
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 32)
      for (let x = 0; x < 64; x += 32) {
        const dark = checker && ((x + y) / 32) % 2 === 1;
        const k = dark ? 0.32 : 0.75 + r() * 0.3;
        g.fillStyle = rgb(dark ? 0x403830 : base, dark ? 0.7 : k);
        g.fillRect(x + 1, y + 1, 30, 30);
        g.fillStyle = rgb(dark ? 0x403830 : base, (dark ? 0.7 : k) * 1.2);
        g.fillRect(x + 1, y + 1, 30, 1);
        for (let i = 0; i < 30; i++) {
          g.fillStyle = rgb(dark ? 0x403830 : base, (dark ? 0.7 : k) * (0.8 + r() * 0.35));
          g.fillRect(x + 2 + Math.floor(r() * 27), y + 2 + Math.floor(r() * 27), 1 + Math.floor(r() * 3), 1);
        }
      }
  });
}

// ---- scene, post-processing -------------------------------------------------------------------------

const canvas = document.createElement('canvas');
canvas.className = 'view';
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 60);
scene.add(camera);
// The torch in the hero's hand: warm light on whatever stands in front, as in Grimrock.
const handTorch = new THREE.PointLight(0xffb070, 22, 14, 1.2);
handTorch.position.set(-0.5, -0.1, -0.3);
camera.add(handTorch);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.0016, maxblur: 0.007 });
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader:
      'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float v = smoothstep(0.95, 0.3, length(vUv - 0.5));
      gl_FragColor = vec4(c.rgb * mix(0.5, 1.0, v), c.a); }`,
  }),
);
composer.addPass(new OutputPass());

const world = new THREE.Group();
scene.add(world);
const lights: { light: THREE.PointLight; base: number; phase: number }[] = [];
const flames: THREE.Sprite[] = [];
const sprites: { mesh: THREE.Mesh; base: number; phase: number }[] = [];
let dust: THREE.Points | null = null;

function flameTexture() {
  const p = new Pix(8, 14);
  p.ellipse(4, 9, 3, 5, ['#ff5010', '#ff9020', '#ffd040', '#fff4b0']);
  p.ellipse(4, 5, 1.5, 3, ['#ff9020', '#ffd040']);
  return p.texture('#00000000');
}
const flameTex = flameTexture();

function torch(x: number, z: number, ry: number, color: number) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.6, metalness: 0.4 });
  const holder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.35), iron);
  holder.position.set(0, 0, 0.17);
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.04, 0.45, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a2c16 }),
  );
  stick.position.set(0, 0.18, 0.33);
  stick.rotation.x = 0.3;
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(3, 2.2, 1.4) }));
  flame.scale.set(0.24, 0.42, 1);
  flame.position.set(0, 0.55, 0.4);
  flames.push(flame);
  g.add(holder, stick, flame);
  g.position.set(x, 1.7, z);
  g.rotation.y = ry;
  world.add(g);
  const light = new THREE.PointLight(color, 14, 11, 1.6);
  light.position.set(x + Math.sin(ry) * 0.6, 2.2, z + Math.cos(ry) * 0.6);
  world.add(light);
  lights.push({ light, base: 14, phase: x * 1.3 + z });
}

/** A pixel-art figure standing in the world: lit by the torches, turning to face the camera. */
function figure(s: { tex: THREE.Texture; w: number; h: number }, x: number, z: number, lift = 0) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(s.w * PX, s.h * PX).translate(0, (s.h * PX) / 2, 0),
    new THREE.MeshStandardMaterial({ map: s.tex, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide }),
  );
  mesh.position.set(x, lift, z);
  mesh.castShadow = true;
  world.add(mesh);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(s.w * PX * 0.35, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  blob.position.set(x, lift + 0.01, z);
  world.add(blob);
  sprites.push({ mesh, base: lift, phase: x * 2 + z });
}

interface Place {
  map: string[];
  height: number;
  wall: THREE.Texture;
  floor: THREE.Texture;
  ceiling: THREE.Texture;
  ambient: number;
  fog: number;
  torch: number;
  creatures: Record<string, { tex: THREE.Texture; w: number; h: number }>;
  focus: number;
}

/**
 * Builds a dungeon from a map, cell by cell, as Grimrock does: '#' stone, '.' floor, '@' the hero
 * (facing north), 'N' a wall with a burial niche, 'w' a stained-glass wall, 'W' water, 'B' a bridge,
 * 'C' a column, 'A' the altar, 'X' a sarcophagus, 'G' an iron gate, digits creatures.
 */
function buildPlace(p: Place) {
  world.clear();
  lights.length = 0;
  flames.length = 0;
  sprites.length = 0;
  scene.fog = new THREE.FogExp2(p.fog, 0.07);
  scene.background = new THREE.Color(p.fog);
  world.add(new THREE.AmbientLight(p.ambient, 0.9));
  const rows = p.map;
  const at = (x: number, y: number) => rows[y]?.[x] ?? '#';
  const solid = (c: string) => c === '#' || c === 'N' || c === 'w';
  const wallMat = new THREE.MeshStandardMaterial({ map: p.wall, roughness: 0.92 });
  const floorMat = new THREE.MeshStandardMaterial({ map: p.floor, roughness: 0.85 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: p.ceiling, roughness: 0.95 });
  const face = new THREE.PlaneGeometry(CELL, p.height);
  const tile = new THREE.PlaneGeometry(CELL, CELL);
  let torchCount = 0;
  const niche = new THREE.MeshStandardMaterial({ color: 0x0a0604 });
  const bone = skullTile();
  const glass = glassTexture();
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < (rows[y]?.length ?? 0); x++) {
      const c = at(x, y);
      if (solid(c)) continue;
      const cx = (x + 0.5) * CELL;
      const cz = (y + 0.5) * CELL;
      const water = c === 'W' || c === 'B';
      const f = new THREE.Mesh(tile, floorMat);
      f.rotation.x = -Math.PI / 2;
      f.position.set(cx, water ? -0.45 : 0, cz);
      f.receiveShadow = true;
      world.add(f);
      if (water) {
        const wmat = new THREE.MeshStandardMaterial({
          color: 0x1a4a50,
          roughness: 0.15,
          metalness: 0.2,
          transparent: true,
          opacity: 0.85,
        });
        const w = new THREE.Mesh(tile, wmat);
        w.rotation.x = -Math.PI / 2;
        w.position.set(cx, -0.2, cz);
        world.add(w);
        // Channel sides where the water meets a walkway.
        for (const [dx, dz, ry] of [
          [-1, 0, Math.PI / 2],
          [1, 0, -Math.PI / 2],
        ] as const) {
          const n = at(x + dx, y + dz);
          if (n === 'W' || n === 'B' || solid(n)) continue;
          const side = new THREE.Mesh(new THREE.PlaneGeometry(CELL, 0.45), wallMat);
          side.position.set(cx + (dx * CELL) / 2, -0.22, cz);
          side.rotation.y = ry;
          world.add(side);
        }
        if (c === 'B') {
          const bridge = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.25, CELL * 0.6), wallMat);
          bridge.position.set(cx, 0.05, cz);
          bridge.castShadow = bridge.receiveShadow = true;
          world.add(bridge);
        }
      }
      const ceil = new THREE.Mesh(tile, ceilMat);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(cx, p.height, cz);
      world.add(ceil);
      // Walls on every side that faces stone.
      for (const [dx, dz, ry] of [
        [0, -1, 0],
        [0, 1, Math.PI],
        [-1, 0, Math.PI / 2],
        [1, 0, -Math.PI / 2],
      ] as const) {
        const n = at(x + dx, y + dz);
        if (!solid(n)) continue;
        const wx = cx + (dx * CELL) / 2;
        const wz = cz + (dz * CELL) / 2;
        const wall = new THREE.Mesh(
          face,
          n === 'w' ? new THREE.MeshStandardMaterial({ map: p.wall, roughness: 0.9 }) : wallMat,
        );
        wall.position.set(wx, p.height / 2, wz);
        wall.rotation.y = ry;
        wall.receiveShadow = true;
        world.add(wall);
        const inward = new THREE.Vector3(-dx, 0, -dz);
        if (n === 'N') {
          // A burial niche: a dark recess with a skull and bones in it.
          for (const ny of [0.7, 1.7]) {
            const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), niche);
            hole.position.set(wx + inward.x * 0.01, ny, wz + inward.z * 0.01);
            hole.rotation.y = ry;
            world.add(hole);
            const s = new THREE.Mesh(
              new THREE.PlaneGeometry(0.42, 0.42),
              new THREE.MeshStandardMaterial({ map: bone, alphaTest: 0.5 }),
            );
            s.position.set(wx + inward.x * 0.05, ny - 0.08, wz + inward.z * 0.05);
            s.rotation.y = ry;
            world.add(s);
          }
        } else if (n === 'w') {
          const win = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 3.2),
            new THREE.MeshBasicMaterial({ map: glass, color: new THREE.Color(1.6, 1.6, 1.6), transparent: true }),
          );
          win.position.set(wx + inward.x * 0.02, p.height * 0.55, wz + inward.z * 0.02);
          win.rotation.y = ry;
          world.add(win);
          const shaft = new THREE.PointLight(0xffe0c0, 1.2, 6, 1.4);
          shaft.position.set(wx + inward.x * 1.2, p.height * 0.5, wz + inward.z * 1.2);
          world.add(shaft);
        } else if ((x * 3 + y * 5 + dx * 7) % 5 === 0 && torchCount < 8) {
          torchCount++;
          torch(wx + inward.x * 0.02, wz + inward.z * 0.02, Math.atan2(inward.x, inward.z), p.torch);
        }
      }
      if (c === 'C') {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, p.height, 10), wallMat);
        col.position.set(cx, p.height / 2, cz);
        col.castShadow = col.receiveShadow = true;
        world.add(col);
      }
      if (c === 'X') {
        const sar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 2.0), wallMat);
        sar.position.set(cx, 0.4, cz);
        sar.castShadow = sar.receiveShadow = true;
        world.add(sar);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 2.1), wallMat);
        lid.position.set(cx, 0.87, cz);
        world.add(lid);
      }
      if (c === 'A') {
        const altar = new THREE.Mesh(
          new THREE.BoxGeometry(2.0, 1.0, 1.0),
          new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 }),
        );
        altar.position.set(cx, 0.5, cz - 0.4);
        altar.castShadow = true;
        world.add(altar);
        for (const dx of [-0.8, -0.4, 0.4, 0.8]) {
          const candle = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(3, 2.4, 1.6) }),
          );
          candle.scale.set(0.12, 0.2, 1);
          candle.position.set(cx + dx, 1.15, cz - 0.4);
          world.add(candle);
          flames.push(candle);
        }
        const l = new THREE.PointLight(0xffd890, 10, 9, 1.4);
        l.position.set(cx, 1.6, cz);
        world.add(l);
        lights.push({ light: l, base: 10, phase: 3 });
      }
      if (c === 'G') {
        const bars = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.5 });
        for (let i = 0; i < 7; i++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, p.height, 0.06), bars);
          bar.position.set(x * CELL + 0.2 + i * 0.33, p.height / 2, cz - CELL / 2);
          world.add(bar);
        }
      }
      const creature = p.creatures[c];
      if (creature) figure(creature, cx, cz, water ? -0.35 : 0);
      if (c === '@') {
        camera.position.set(cx, 1.55, cz + 0.6);
        camera.rotation.set(-0.02, 0, 0, 'YXZ');
      }
    }
  (bokeh.uniforms as Record<string, THREE.IUniform>).focus!.value = p.focus;
  // Dust drifting in the torchlight.
  const n = 260;
  const pos = new Float32Array(n * 3);
  const r = mulberry(5);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = camera.position.x + (r() - 0.5) * 8;
    pos[i * 3 + 1] = r() * p.height;
    pos[i * 3 + 2] = camera.position.z - r() * 12;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: new THREE.Color(1.3, 1.05, 0.75),
      size: 0.012,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  world.add(dust);
  world.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial)) o.receiveShadow = true;
  });
}

function skullTile() {
  const p = new Pix(16, 16);
  p.ellipse(8, 7, 5, 5, R.bone, 0.1);
  p.rect(5, 10, 6, 3, R.bone);
  p.rect(5, 6, 2, 2, ['#0a0604']);
  p.rect(9, 6, 2, 2, ['#0a0604']);
  p.limb(1, 14, 14, 13, R.bone, 1);
  return p.texture();
}

function glassTexture() {
  const p = new Pix(12, 32);
  const colors = ['#c02030', '#2040c0', '#e0b020', '#20a050', '#8030b0'];
  const r = mulberry(61);
  for (let y = 2; y < 32; y += 3)
    for (let x = 0; x < 12; x += 3) {
      const c = colors[Math.floor(r() * colors.length)]!;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) p.set(x + dx, y + dy, dx === 0 || dy === 0 ? '#100a08' : c);
    }
  for (let x = 2; x < 10; x++) p.set(x, 1, '#100a08');
  return p.texture();
}

const PLACES: Record<Biome, () => Place> = {
  crypt: () => ({
    map: [
      '###########',
      '####NNN####',
      '###N...N###',
      '##N.1.2.N##',
      '##N.X.X.N##',
      '##N..3..N##',
      '###NN@NN###',
      '###########',
    ],
    height: 3,
    wall: wallFace(0x7a6e5e, 0x241c16, 1),
    floor: floorTiles(0x7a6a58, 2),
    ceiling: wallFace(0x5a4c3e, 0x1a1410, 3),
    ambient: 0x3a2c22,
    fog: 0x0a0605,
    torch: 0xffa050,
    creatures: { '1': skeletonWarrior(), '2': skeletonArcher(), '3': ghoul() },
    focus: 6.5,
  }),
  catacombs: () => ({
    map: [
      '#########',
      '###.W.###',
      '###.W.###',
      '###1W.###',
      '###.B.###',
      '###.W2###',
      '###.5.###',
      '###.W.###',
      '###@W.###',
      '#########',
    ],
    height: 3,
    wall: wallFace(0x5a6a5c, 0x1a2420, 11, 1),
    floor: floorTiles(0x4e5e54, 12),
    ceiling: wallFace(0x3a4a40, 0x121a16, 13, 0.5),
    ambient: 0x2a4a40,
    fog: 0x061210,
    torch: 0x9adf9a,
    creatures: { '1': drowned(), '2': bloated(), '5': leech() },
    focus: 6,
  }),
  cathedral: () => ({
    map: [
      '#########',
      '####A####',
      '#w.....w#',
      '#.C...C.#',
      '#...2...#',
      '#wC...Cw#',
      '#..1.3..#',
      '#.C...C.#',
      '#w..@..w#',
      '#########',
    ],
    height: 6.5,
    wall: wallFace(0xc4b08e, 0x50442e, 21),
    floor: floorTiles(0xd8d0c0, 22, true),
    ceiling: wallFace(0x8a806c, 0x3a3428, 23),
    ambient: 0x5a4a34,
    fog: 0x16110c,
    torch: 0xffd890,
    creatures: { '1': templar(), '2': acolyte(), '3': bellringer() },
    focus: 8,
  }),
};

// ---- the hero's hands, drawn in 2D like the sprites ---------------------------------------------

function handCanvas(kind: 'sword' | 'torch') {
  const p = new Pix(48, 48);
  if (kind === 'sword') {
    for (let y = 0; y < 30; y++) p.rect(26 - Math.floor(y * 0.15), y, 4, 1, R.steel, 0.1);
    p.rect(18, 29, 16, 3, R.gold);
    p.rect(22, 32, 6, 5, R.wood);
    p.ellipse(25, 39, 9, 6, R.steel, 0.05); // gauntlet
    p.rect(18, 40, 16, 8, R.steel);
    for (const x of [19, 23, 27, 31]) p.set(x, 37, R.red[2]!);
  } else {
    p.rect(20, 14, 5, 22, R.wood);
    p.ellipse(22, 10, 6, 9, ['#ff5010', '#ff9020', '#ffd040', '#fff4b0']);
    p.ellipse(22, 37, 8, 6, R.steel, 0.05);
    p.rect(15, 38, 15, 10, R.steel);
  }
  const c = p.canvas();
  c.className = 'hand';
  return c;
}
const swordHand = handCanvas('sword');
const torchHand = handCanvas('torch');
document.body.append(swordHand, torchHand);
function placeHands(swing: number) {
  const scale = Math.max(2, Math.round(window.innerHeight / 150));
  for (const [c, left] of [
    [swordHand, false],
    [torchHand, true],
  ] as const) {
    c.style.width = `${48 * scale}px`;
    c.style.height = `${48 * scale}px`;
    if (left) c.style.left = `${Math.round(window.innerWidth * 0.08)}px`;
    else c.style.right = `${Math.round(window.innerWidth * 0.12)}px`;
    c.style.transform = left ? '' : `translateY(${-swing * scale * 10}px) rotate(${-swing * 25}deg)`;
  }
}

// ---- loop ---------------------------------------------------------------------------------------

let yaw = 0;
let pitch = -0.02;
let swingStart = -1e9;
function build(b: Biome) {
  buildPlace(PLACES[b]());
  yaw = 0;
  pitch = b === 'cathedral' ? 0.05 : -0.02;
}
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
    build(b);
  }
});
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
build(biome);

function loop(now: number) {
  const t = still ? 1000 : now;
  handTorch.intensity = 22 * (0.9 + 0.08 * Math.sin(t / 80) + 0.04 * Math.sin(t / 33));
  for (const l of lights)
    l.light.intensity = l.base * (0.85 + 0.1 * Math.sin(t / 90 + l.phase) + 0.05 * Math.sin(t / 41));
  for (const f of flames) f.scale.y = f.scale.x * 1.75 * (0.92 + 0.08 * Math.sin(t / 70 + f.position.x * 9));
  for (const s of sprites) {
    // Cylindrical billboard: face the camera, stay upright; a slow breathing bob.
    s.mesh.rotation.y = Math.atan2(camera.position.x - s.mesh.position.x, camera.position.z - s.mesh.position.z);
    s.mesh.scale.y = 1 + Math.sin(t / 450 + s.phase) * 0.012;
  }
  if (dust && !still) {
    const a = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setY(i, (a.getY(i) + 0.002) % 3);
    a.needsUpdate = true;
  }
  camera.rotation.set(pitch, yaw + (still ? 0 : Math.sin(now / 1100) * 0.004), 0, 'YXZ');
  const s = (now - swingStart) / 320;
  placeHands(s >= 0 && s < 1 ? Math.sin(s * Math.PI) : 0);
  composer.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
