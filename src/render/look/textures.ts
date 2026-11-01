import * as THREE from 'three';

/**
 * Textures drawn in code (MV): stone blocks, flagstones, marble checks, planks, flat materials, faces,
 * flames. Seeded, so a biome always looks the same. Every texture is registered, so the two looks
 * (smooth / retro pixels) can switch their filtering at once.
 */

export type RenderStyle = 'smooth' | 'retro';

/** Texels per texture unit: higher = finer detail. */
const TEX = 2;
const registry = new Set<THREE.Texture>();
let style: RenderStyle = 'smooth';

function filter(t: THREE.Texture): void {
  const retro = style === 'retro';
  t.magFilter = retro ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = retro ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  t.anisotropy = retro ? 1 : 8;
  t.needsUpdate = true;
}

/** Smooth: soft filtering; retro: texel-sharp. Applies to every texture made so far and from now on. */
export function setTextureStyle(next: RenderStyle): void {
  style = next;
  for (const t of registry) filter(t);
}

export function mulberry(seed: number): () => number {
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
const dot = (g: CanvasRenderingContext2D, x: number, y: number, w = 0.5, h = 0.5) => g.fillRect(x, y, w, h);

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

/** A texture drawn on a small canvas (coordinates in texture units), tiling, registered for the style. */
export function pixelTexture(
  w: number,
  h: number,
  seed: number,
  draw: (g: CanvasRenderingContext2D, r: () => number) => void,
  grainAmount = 0.16,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w * TEX;
  c.height = h * TEX;
  const g = c.getContext('2d')!;
  g.scale(TEX, TEX);
  draw(g, mulberry(seed));
  if (grainAmount > 0) grain(g, c.width, c.height, mulberry(seed + 99), grainAmount);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  filter(t);
  registry.add(t);
  return t;
}

/** A tiling copy of a texture with its own repeat, following the style like the original. */
export function repeatTexture(t: THREE.Texture, u: number, v: number): THREE.Texture {
  const c = t.clone();
  c.repeat.set(u, v);
  filter(c);
  registry.add(c);
  return c;
}

/** Forget textures of a room that is gone. */
export function releaseTexture(t: THREE.Texture): void {
  registry.delete(t);
  t.dispose();
}

/** Dressed stone blocks in running bond, with chips, cracks, and optional moss and damp streaks. */
export function bricks(base: number, mortar: number, seed: number, moss = 0, wet = false) {
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

export function flagstones(base: number, seed: number) {
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

export function checker(light: number, dark: number, seed: number) {
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

export function planks(base: number, seed: number) {
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

/** A flat material with grain, a few spots of another colour, optional stripes (bone, cloth, metal). */
export function solid(base: number, seed: number, spots: number | null = null, stripes = false) {
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

/** A skull face for niche decorations. */
export function skullFace(seed: number) {
  return pixelTexture(16, 16, seed, (g) => {
    g.fillStyle = '#d8ccae';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#100806';
    g.fillRect(3, 5, 4, 4);
    g.fillRect(9, 5, 4, 4);
    g.fillRect(7, 10, 2, 2);
    for (let x = 4; x < 12; x += 2) g.fillRect(x, 13, 1, 2);
  });
}

/** Stained glass: little panes of colour in dark leading, arched at the top. */
export function stainedGlass(seed: number) {
  return pixelTexture(
    16,
    40,
    seed,
    (g, r) => {
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
    },
    0,
  );
}

/** A small pixel flame that redraws itself (call `redraw` every few frames). */
export function flameTexture(seed: number, hot = '#fff3a0', mid = '#ffb030', cool = '#e0501a') {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.magFilter = t.minFilter = THREE.NearestFilter;
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
