import * as THREE from 'three';
import { float, int, type Rng } from '../core/rng';

/** Procedural low-res textures drawn into canvases. Same RNG state → same pixels. */

const SIZE = 64;

export interface RoomTextures {
  wall: THREE.Texture;
  floor: THREE.Texture;
  ceiling: THREE.Texture;
  door: THREE.Texture;
  pit: THREE.Texture;
  dispose(): void;
}

type Rgb = [number, number, number];

function canvasTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 1;
  return tex;
}

const rgb = (c: Rgb) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Per-pixel brightness noise: gives the gritty, hand-pixelled look. */
function grain(ctx: CanvasRenderingContext2D, rng: Rng, amount: number): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (float(rng) - 0.5) * 2 * amount;
    d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n));
  }
  ctx.putImageData(img, 0, 0);
}

function crack(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, len: number, color: string): void {
  ctx.fillStyle = color;
  let cx = x;
  let cy = y;
  for (let i = 0; i < len; i++) {
    ctx.fillRect(cx, cy, 1, 1);
    cx += int(rng, -1, 1);
    cy += int(rng, 0, 1);
  }
}

function drawBricks(ctx: CanvasRenderingContext2D, rng: Rng, base: Rgb, mortar: Rgb, rows: number): void {
  ctx.fillStyle = rgb(mortar);
  ctx.fillRect(0, 0, SIZE, SIZE);
  const bh = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    const bw = int(rng, 0, 1) === 0 ? 32 : 21;
    const offset = r % 2 === 0 ? 0 : Math.floor(bw / 2);
    for (let x = -offset; x < SIZE; x += bw) {
      const k = 0.75 + float(rng) * 0.45;
      ctx.fillStyle = rgb(shade(base, k));
      ctx.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2);
      // Highlight on top edge, shadow on bottom edge.
      ctx.fillStyle = rgb(shade(base, k * 1.25));
      ctx.fillRect(x + 1, r * bh + 1, bw - 2, 1);
      ctx.fillStyle = rgb(shade(base, k * 0.6));
      ctx.fillRect(x + 1, r * bh + bh - 2, bw - 2, 1);
      // The texture wraps horizontally, so draw the wrapped part too.
      if (x + bw > SIZE) {
        ctx.fillStyle = rgb(shade(base, k));
        ctx.fillRect(x + 1 - SIZE, r * bh + 1, bw - 2, bh - 2);
      }
    }
  }
}

export function createRoomTextures(rng: Rng): RoomTextures {
  const stone: Rgb = [92 + int(rng, -8, 8), 84 + int(rng, -8, 8), 76 + int(rng, -6, 6)];

  const wall = canvasTexture((ctx) => {
    drawBricks(ctx, rng, stone, [28, 24, 22], 4);
    for (let i = 0; i < 4; i++)
      crack(ctx, rng, int(rng, 0, SIZE - 1), int(rng, 0, SIZE - 8), int(rng, 4, 12), '#1a1614');
    // Moss/grime creeping up from the floor.
    for (let i = 0; i < 90; i++) {
      const x = int(rng, 0, SIZE - 1);
      const y = SIZE - 1 - Math.floor(Math.abs(float(rng) - float(rng)) * 22);
      ctx.fillStyle = float(rng) < 0.5 ? 'rgba(40,52,30,0.55)' : 'rgba(20,18,16,0.5)';
      ctx.fillRect(x, y, 1, 1);
    }
    grain(ctx, rng, 14);
  });

  const floor = canvasTexture((ctx) => {
    ctx.fillStyle = '#1b1715';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const base: Rgb = shade(stone, 0.8);
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const k = 0.75 + float(rng) * 0.35;
        const x = tx * 32;
        const y = ty * 32;
        ctx.fillStyle = rgb(shade(base, k));
        ctx.fillRect(x + 1, y + 1, 30, 30);
        ctx.fillStyle = rgb(shade(base, k * 1.2));
        ctx.fillRect(x + 1, y + 1, 30, 1);
        ctx.fillRect(x + 1, y + 1, 1, 30);
        ctx.fillStyle = rgb(shade(base, k * 0.6));
        ctx.fillRect(x + 1, y + 30, 30, 1);
        ctx.fillRect(x + 30, y + 1, 1, 30);
        if (float(rng) < 0.6) crack(ctx, rng, x + int(rng, 4, 26), y + int(rng, 2, 10), int(rng, 6, 18), '#141110');
      }
    }
    grain(ctx, rng, 12);
  });

  const ceiling = canvasTexture((ctx) => {
    drawBricks(ctx, rng, shade(stone, 0.55), [14, 12, 11], 2);
    grain(ctx, rng, 10);
  });

  const pit = canvasTexture((ctx) => {
    drawBricks(ctx, rng, shade(stone, 0.5), [10, 9, 8], 4);
    grain(ctx, rng, 8);
  });

  const door = canvasTexture((ctx) => {
    // Stone frame.
    drawBricks(ctx, rng, stone, [28, 24, 22], 4);
    // Arched wooden door.
    const wood: Rgb = [78, 50, 30];
    const x0 = 12;
    const x1 = 52;
    const top = 14;
    ctx.fillStyle = '#120d0a';
    ctx.fillRect(x0 - 2, top - 2, x1 - x0 + 4, SIZE - top + 2);
    ctx.beginPath();
    ctx.arc(32, top + 2, (x1 - x0) / 2 + 2, Math.PI, 0);
    ctx.fill();
    const planks = 5;
    const pw = (x1 - x0) / planks;
    for (let p = 0; p < planks; p++) {
      const k = 0.75 + float(rng) * 0.35;
      ctx.fillStyle = rgb(shade(wood, k));
      ctx.fillRect(x0 + p * pw, top, pw - 1, SIZE - top);
      ctx.fillStyle = rgb(shade(wood, k * 0.6));
      ctx.fillRect(x0 + p * pw + pw - 1, top, 1, SIZE - top);
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(32, top + 2, (x1 - x0) / 2, Math.PI, 0);
    ctx.clip();
    ctx.fillStyle = rgb(shade(wood, 0.8));
    ctx.fillRect(x0, 0, x1 - x0, top + 2);
    ctx.restore();
    // Iron bands and ring.
    ctx.fillStyle = '#2a2a2c';
    ctx.fillRect(x0, 26, x1 - x0, 3);
    ctx.fillRect(x0, 48, x1 - x0, 3);
    ctx.fillStyle = '#6b6258';
    ctx.fillRect(43, 37, 4, 4);
    ctx.fillStyle = '#120d0a';
    ctx.fillRect(44, 38, 2, 2);
    grain(ctx, rng, 10);
  });

  const all = [wall, floor, ceiling, door, pit];
  return {
    wall,
    floor,
    ceiling,
    door,
    pit,
    dispose: () => all.forEach((t) => t.dispose()),
  };
}
