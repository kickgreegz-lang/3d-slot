// (c) >= 20 spins with turbo on (the lightning button is a 2-state toggle: there is no super
// turbo state), then DF_N2 (10) turbo spins slam-stopped with Space at +DF_QUICK_MS (100) ms, to
// see whether a slam shortens turbo further. Turbo is switched off again at the end.
import { meta as m, boot, enterGame, spin, toggleTurbo } from './df-lib.mjs';
export const meta = { ...m, name: 'df-c-turbo' };
const N = Number(process.env.DF_N ?? 20), N2 = Number(process.env.DF_N2 ?? 10), Q = Number(process.env.DF_QUICK_MS ?? 100);
export default async function (ref) {
  await boot(ref);
  await enterGame(ref);
  await toggleTurbo(ref, 'on');
  for (let k = 1; k <= N; k++) {
    const id = String(k).padStart(2, '0');
    await spin(ref, `turboA-${id}`, { every: k <= 8 ? 1 : 2, minMs: 400, maxMs: 30_000, tailMs: 600, checkEvery: 3, notes: `turbo spin ${id}` });
  }
  for (let k = 1; k <= N2; k++) {
    const id = String(k).padStart(2, '0');
    await spin(ref, `turboQ-${id}`, { quickMs: Q, every: k <= 5 ? 1 : 2, minMs: 400, maxMs: 30_000, tailMs: 600, checkEvery: 3, notes: `turbo spin ${id} + Space slam at +${Q} ms` });
  }
  await toggleTurbo(ref, 'off');
}
