import { useEffect, useRef } from 'preact/hooks';
import type { CellType } from '../core/grid';
import { getEnemy } from '../content';
import { intentCells, type GameState } from '../sim';

const CELL_PX = 9;

const COLORS: Record<CellType, string> = {
  floor: '#5a3a30',
  wall: '#1a0e0e',
  pillar: '#a07a68',
  pit: '#d0500e',
  door: '#8a5a2e',
};

/** Tactical minimap, north up. Drawn from the simulation state only. */
export function Minimap({ game }: { game: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { grid } = game.room;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = grid.w * CELL_PX;
    canvas.height = grid.h * CELL_PX;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const t = grid.cells[y * grid.w + x] as CellType;
        ctx.fillStyle = COLORS[t];
        ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
        if (t === 'pit') {
          ctx.strokeStyle = '#ffa030';
          ctx.strokeRect(x * CELL_PX + 1.5, y * CELL_PX + 1.5, CELL_PX - 3, CELL_PX - 3);
        } else if (t === 'pillar') {
          ctx.fillStyle = COLORS.floor;
          ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
          ctx.fillStyle = COLORS.pillar;
          ctx.beginPath();
          ctx.arc((x + 0.5) * CELL_PX, (y + 0.5) * CELL_PX, CELL_PX * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Telegraphed attacks: ice-blue cells, like the frames on the floor (lava is already orange).
    ctx.fillStyle = 'rgba(150, 225, 255, 0.6)';
    for (const e of game.enemies) {
      if (!e.intent) continue;
      for (const c of intentCells(game, e, e.intent).cells)
        ctx.fillRect(c.x * CELL_PX, c.y * CELL_PX, CELL_PX, CELL_PX);
    }
    for (const e of game.enemies) {
      ctx.fillStyle = getEnemy(e.type).behavior.kind === 'ranged' ? '#e8a040' : '#e04030';
      ctx.beginPath();
      ctx.arc((e.x + 0.5) * CELL_PX, (e.y + 0.5) * CELL_PX, CELL_PX * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of game.players) {
      const cx = (p.x + 0.5) * CELL_PX;
      const cy = (p.y + 0.5) * CELL_PX;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((p.dir * Math.PI) / 2);
      ctx.fillStyle = '#ffc04a';
      ctx.beginPath();
      ctx.moveTo(0, -CELL_PX * 0.45);
      ctx.lineTo(CELL_PX * 0.38, CELL_PX * 0.38);
      ctx.lineTo(-CELL_PX * 0.38, CELL_PX * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, [game, grid]);

  return <canvas ref={ref} class="minimap" data-testid="minimap" />;
}
