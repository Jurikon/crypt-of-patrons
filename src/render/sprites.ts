import * as THREE from 'three';

/**
 * Procedural pixel-art billboards (Doom-style). Each sprite id from content maps to a draw function;
 * real art can replace these later without touching game code (GDD 3).
 */

const W = 32;
const H = 48;

const BONE = '#d9cfb4';
const BONE_SHADE = '#9c9078';
const DARK = '#1a1410';
const EYE = '#ff5a2a';

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function skeleton(ctx: CanvasRenderingContext2D): void {
  // Skull.
  px(ctx, BONE, 12, 3, 8, 8);
  px(ctx, BONE, 11, 5, 10, 5);
  px(ctx, BONE_SHADE, 12, 10, 8, 2);
  px(ctx, DARK, 13, 6, 2, 2);
  px(ctx, DARK, 17, 6, 2, 2);
  px(ctx, EYE, 13, 7);
  px(ctx, EYE, 18, 7);
  px(ctx, DARK, 15, 9, 2, 1);
  px(ctx, BONE, 13, 12, 6, 1);
  px(ctx, DARK, 14, 12);
  px(ctx, DARK, 16, 12);
  // Spine and ribs.
  px(ctx, BONE, 15, 13, 2, 14);
  for (let r = 0; r < 4; r++) {
    px(ctx, BONE, 11, 15 + r * 3, 10, 1);
    px(ctx, BONE_SHADE, 11, 16 + r * 3, 1, 1);
    px(ctx, BONE_SHADE, 20, 16 + r * 3, 1, 1);
  }
  // Pelvis.
  px(ctx, BONE, 12, 27, 8, 3);
  px(ctx, DARK, 15, 28, 2, 2);
  // Legs.
  px(ctx, BONE, 12, 30, 2, 8);
  px(ctx, BONE, 18, 30, 2, 8);
  px(ctx, BONE_SHADE, 12, 37, 2, 1);
  px(ctx, BONE_SHADE, 18, 37, 2, 1);
  px(ctx, BONE, 12, 38, 2, 7);
  px(ctx, BONE, 18, 38, 2, 7);
  px(ctx, BONE, 10, 45, 4, 2);
  px(ctx, BONE, 18, 45, 4, 2);
  // Shoulders.
  px(ctx, BONE, 9, 14, 14, 1);
}

function warrior(ctx: CanvasRenderingContext2D): void {
  skeleton(ctx);
  // Sword arm (right of the image) raised.
  px(ctx, BONE, 22, 14, 2, 7);
  px(ctx, BONE, 23, 20, 2, 5);
  px(ctx, '#8a8f96', 25, 2, 2, 22);
  px(ctx, '#c9ced4', 25, 2, 1, 20);
  px(ctx, '#5a3a20', 23, 23, 6, 2);
  // Round shield on the left arm.
  px(ctx, '#4a2e1a', 2, 17, 10, 12);
  px(ctx, '#3a2414', 1, 19, 12, 8);
  px(ctx, '#6b6258', 6, 21, 3, 3);
  px(ctx, '#2a2a2c', 2, 22, 10, 1);
}

function archer(ctx: CanvasRenderingContext2D): void {
  skeleton(ctx);
  // Bow held out on the left.
  px(ctx, BONE, 7, 15, 3, 2);
  px(ctx, '#6a4424', 4, 6, 2, 3);
  px(ctx, '#6a4424', 3, 9, 2, 14);
  px(ctx, '#6a4424', 4, 23, 2, 3);
  px(ctx, '#bdb3a0', 6, 7, 1, 18);
  // Arrow nocked.
  px(ctx, '#8a7a60', 6, 16, 12, 1);
  px(ctx, '#c9ced4', 4, 15, 2, 3);
  // Drawing arm.
  px(ctx, BONE, 18, 15, 5, 2);
  px(ctx, BONE, 21, 15, 2, 5);
  // Hood.
  px(ctx, '#2e2a3a', 11, 2, 10, 3);
  px(ctx, '#2e2a3a', 10, 4, 2, 7);
  px(ctx, '#2e2a3a', 20, 4, 2, 7);
}

const DRAW: Record<string, (ctx: CanvasRenderingContext2D) => void> = { warrior, archer };

const cache = new Map<string, THREE.Texture>();

export function spriteTexture(id: string): THREE.Texture {
  const cached = cache.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  (DRAW[id] ?? skeleton)(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  cache.set(id, tex);
  return tex;
}

export const SPRITE_ASPECT = W / H;
