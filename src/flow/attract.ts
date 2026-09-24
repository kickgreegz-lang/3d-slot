import { GRID } from '../config/game';

/**
 * Deterministic idle board shown before the first spin: premium-heavy, no two
 * orthogonal neighbours alike (so it can never read as an unpaid cluster), one
 * wild and one scatter as "specials" teasers. [reel][paddedRow], 7 x 7.
 */
const POOL = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5', 'H1', 'H2', 'H3', 'H4'];
const SPECIALS: Record<string, string> = { '1,2': 'W', '5,4': 'S' };

export const attractBoard = (seed = 7): string[][] => {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
  const board: string[][] = [];
  for (let r = 0; r < GRID.reels; r++) {
    const reel: string[] = [];
    for (let row = 0; row < GRID.paddedRows; row++) {
      const special = SPECIALS[`${r},${row}`];
      if (special) {
        reel.push(special);
        continue;
      }
      const left = board[r - 1]?.[row];
      const up = reel[row - 1];
      let id = POOL[Math.floor(rand() * POOL.length)];
      for (let guard = 0; (id === left || id === up) && guard < 16; guard++) id = POOL[Math.floor(rand() * POOL.length)];
      reel.push(id);
    }
    board.push(reel);
  }
  return board;
};
