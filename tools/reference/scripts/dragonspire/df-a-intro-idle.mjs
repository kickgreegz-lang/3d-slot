// (a) Intro screen + 30 s idle + a controls tour (grid screenshots to verify every button).
import { meta as m, boot, calibrate, nf } from './df-lib.mjs';
export const meta = { ...m, name: 'df-a-intro-idle' };
export default async function (ref) {
  await boot(ref);
  await ref.frames('intro-idle', nf(3000), { every: 3, notes: 'intro / press-to-continue screen before any input' });
  await ref.click('intro', { note: 'press to continue' });
  await ref.frames('intro-dismiss', nf(2500), { every: 1, notes: 'intro out -> base game, every frame' });
  await ref.screenshot('base-game', { grid: true });
  await ref.frames('idle-30s', nf(30_000), { every: 3, notes: 'base game idle 30 s: attract / bored loops, meter and mini panel idle' });
  await ref.screenshot('idle-end', { grid: true });
  await calibrate(ref);
  // controls tour: every click followed by a grid screenshot so the points can be verified
  const tour = [
    ['betUp', 'bet-up'], ['betDown', 'bet-down'],
    ['autoplay', 'autoplay'], ['ESC', 'autoplay-esc'],
    ['menu', 'menu'], ['ESC', 'menu-esc'],
    ['buy', 'buy'], ['ESC', 'buy-esc'],
    ['turbo', 'turbo-1'], ['turbo', 'turbo-2'], ['turbo', 'turbo-3'], ['turbo', 'turbo-4'],
  ];
  for (const [pt, name] of tour) {
    if (pt === 'ESC') await ref.key('Escape', { note: `escape after ${name}` });
    else await ref.click(pt, { note: `tour: ${pt}` });
    await ref.frames(`tour-${name}`, nf(1200), { every: 3 });
    await ref.screenshot(`tour-${name}`, { grid: true });
  }
}
