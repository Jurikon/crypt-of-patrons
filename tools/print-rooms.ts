// Prints rooms as ASCII for eyeballing the generator: pnpm rooms [startSeed] [count]
import { createGame } from '../src/sim/state';

const start = Number(process.argv[2] ?? 1);
const count = Number(process.argv[3] ?? 4);
const glyph = { floor: '.', wall: '#', pillar: 'O', pit: '~', door: '+' } as const;
const arrow = ['^', '>', 'v', '<'];
for (let seed = start; seed < start + count; seed++) {
  const s = createGame(seed);
  const p = s.players[0]!;
  console.log(`seed ${seed}: ${s.room.shape} ${s.room.interior.w}x${s.room.interior.h}`);
  for (let y = 0; y < s.room.grid.h; y++) {
    let line = '';
    for (let x = 0; x < s.room.grid.w; x++) {
      line += p.x === x && p.y === y ? arrow[p.dir] : glyph[s.room.grid.cells[y * s.room.grid.w + x]!];
    }
    console.log(line);
  }
  console.log();
}
