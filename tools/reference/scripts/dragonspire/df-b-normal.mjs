// (b) >= 20 normal-speed spins. spin-01..05 every frame, the rest every 3rd frame.
import { meta as m, boot, enterGame, spin } from './df-lib.mjs';
export const meta = { ...m, name: 'df-b-normal' };
const N = Number(process.env.DF_N ?? 20), START = Number(process.env.DF_START ?? 1); // DF_START: continue a cut-off run
export default async function (ref) {
  await boot(ref);
  await enterGame(ref);
  for (let k = START; k <= N; k++) {
    const id = String(k).padStart(2, '0');
    await spin(ref, `spin-${id}`, { every: k <= 5 ? 1 : 3, minMs: 2500, maxMs: 40_000, notes: `normal spin ${id}` });
  }
  await ref.screenshot('end', { grid: true });
}
