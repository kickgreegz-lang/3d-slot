// (d) >= 15 quick-stop spins at normal speed: click spin, then Space DF_QUICK_MS (150) later
// (the spin button is disabled while a round runs, so the slam is on Space). Compare with df-b.
import { meta as m, boot, enterGame, spin } from './df-lib.mjs';
export const meta = { ...m, name: 'df-d-quickstop' };
const N = Number(process.env.DF_N ?? 15), Q = Number(process.env.DF_QUICK_MS ?? 150);
export default async function (ref) {
  await boot(ref);
  await enterGame(ref);
  for (let k = 1; k <= N; k++) {
    const id = String(k).padStart(2, '0');
    await spin(ref, `quick-${id}`, { quickMs: Q, every: k <= 8 ? 1 : 2, minMs: 800, maxMs: 40_000, checkEvery: 3, notes: `quick-stop spin ${id}: Space at +${Q} ms` });
  }
  await ref.screenshot('end', { grid: true });
}
