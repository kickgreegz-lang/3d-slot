// (e) Dragon Bonus. DF_BUY="buy,buyPick,buyConfirm" (point names, set with --point) buys it;
// otherwise hunt: turbo on, up to DF_HUNT (200) spins with no capture until a play response
// carries a bonus (or a big win), which is captured in full at every 2nd frame. On a hunted
// bonus, turbo is switched off (DF_TURBO_OFF=0 to keep it) so the feature plays at normal speed.
import { meta as m, boot, enterGame, spin, capture, toggleTurbo, plays, endRounds, nf } from './df-lib.mjs';
export const meta = { ...m, name: 'df-e-bonus' };
const HUNT = Number(process.env.DF_HUNT ?? 200), BUY = process.env.DF_BUY;
export default async function (ref) {
  await boot(ref);
  await enterGame(ref);
  if (BUY) {
    const steps = BUY.split(',').map((s) => s.trim()).filter(Boolean);
    const playsBefore = plays(ref).length, endsBefore = endRounds(ref).length;
    for (const [k, pt] of steps.entries()) {
      await ref.click(pt, { note: `buy step ${k + 1}: ${pt}` });
      if (k < steps.length - 1) {
        await ref.frames(`buy-${k + 1}-${pt}`, nf(1500), { every: 2, notes: `bonus-buy screen after clicking ${pt}` });
        await ref.screenshot(`buy-${k + 1}-${pt}`, { grid: true });
      }
    }
    await ref.move([0.5, 0.03], {}); // park the mouse off the HUD (spin-button state detection)
    await capture(ref, 'bonus-bought', { playsBefore, endsBefore, every: 2, forceFeature: true, minMs: 5000, featureMaxMs: 420_000, notes: 'bought Dragon Bonus: trigger, intro, free spins, outro' });
    await ref.screenshot('after-bonus', { grid: true });
    return;
  }
  await toggleTurbo(ref, 'hunt');
  let found = 0, bigwins = 0;
  for (let k = 1; k <= HUNT && !found; k++) {
    const id = String(k).padStart(3, '0');
    const seg = await spin(ref, `hunt-${id}`, {
      every: 0, minMs: 700, maxMs: 30_000, stillMs: 450, featureEvery: 2,
      onFeature: async (info) => {
        if (info.bonus && process.env.DF_TURBO_OFF !== '0') await ref.click('turbo', { note: 'turbo off for the bonus' });
      },
    });
    if (seg.feature === 'bonus') found = k;
    if (seg.feature === 'bigwin') bigwins++;
    if (k % 20 === 0) console.log(`    hunt: ${k} spins, ${bigwins} big wins, no bonus yet`);
  }
  await ref.note(found ? `bonus hunted at spin ${found}` : `no bonus in ${HUNT} spins`);
  await ref.screenshot('hunt-end', { grid: true });
}
