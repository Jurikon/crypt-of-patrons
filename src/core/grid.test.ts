import { describe, expect, it } from 'vitest';
import { createGrid, floodFill, getCell, index, isConnected, neighbors4, rotateDir, setCell } from './grid';

describe('grid', () => {
  it('reads out of bounds as wall', () => {
    const g = createGrid(3, 3, 'floor');
    expect(getCell(g, -1, 0)).toBe('wall');
    expect(getCell(g, 3, 1)).toBe('wall');
    expect(getCell(g, 1, 1)).toBe('floor');
  });

  it('rotates directions both ways', () => {
    expect(rotateDir(0, 1)).toBe(1);
    expect(rotateDir(0, -1)).toBe(3);
    expect(rotateDir(3, 1)).toBe(0);
    expect(rotateDir(2, 2)).toBe(0);
  });

  it('lists in-bounds neighbours only', () => {
    const g = createGrid(3, 3, 'floor');
    expect(neighbors4(g, { x: 0, y: 0 })).toHaveLength(2);
    expect(neighbors4(g, { x: 1, y: 1 })).toHaveLength(4);
  });

  it('flood fill stops at walls and detects disconnected regions', () => {
    const g = createGrid(5, 3, 'floor');
    for (let y = 0; y < 3; y++) setCell(g, 2, y, 'wall');
    const seen = floodFill(g, { x: 0, y: 0 }, (t) => t === 'floor');
    expect(seen[index(g, 1, 2)]).toBe(true);
    expect(seen[index(g, 3, 0)]).toBe(false);
    expect(isConnected(g, { x: 0, y: 0 }, (t) => t === 'floor')).toBe(false);
    setCell(g, 2, 1, 'floor');
    expect(isConnected(g, { x: 0, y: 0 }, (t) => t === 'floor')).toBe(true);
  });
});
