import { ATTRACT, GRID } from '../config/game';

/**
 * Deterministic idle board shown before the first spin: drawn from the game's
 * ATTRACT pool with no two orthogonal neighbours alike (so it can never read as an
 * unpaid cluster), plus the game's fixed "specials" teasers (wild, scatter, ...).
 * [reel][paddedRow], GRID.reels x GRID.paddedRows.
 */
const POOL = ATTRACT.pool;
const SPECIALS = ATTRACT.specials;

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
