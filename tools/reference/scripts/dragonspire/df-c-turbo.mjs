// (c) >= 20 spins in the first turbo state, then 10 in the second state (super turbo if the
// button cycles 3 states; normal again if it is a 2-state toggle: see shots turbo-A/turbo-B).
import { meta as m, boot, enterGame, spin, toggleTurbo } from './df-lib.mjs';
export const meta = { ...m, name: 'df-c-turbo' };
const N = Number(process.env.DF_N ?? 20), N2 = Number(process.env.DF_N2 ?? 10);
export default async function (ref) {
  await boot(ref);
  await enterGame(ref);
  await toggleTurbo(ref, 'A');
  for (let k = 1; k <= N; k++) {
    const id = String(k).padStart(2, '0');
    await spin(ref, `turboA-${id}`, { every: k <= 8 ? 1 : 2, minMs: 800, maxMs: 30_000, stillMs: 500, notes: `turbo state A spin ${id}` });
  }
  await toggleTurbo(ref, 'B');
  for (let k = 1; k <= N2; k++) {
    const id = String(k).padStart(2, '0');
    await spin(ref, `turboB-${id}`, { every: k <= 5 ? 1 : 2, minMs: 800, maxMs: 30_000, stillMs: 500, notes: `turbo state B spin ${id}` });
  }
  await toggleTurbo(ref, 'C');
}
