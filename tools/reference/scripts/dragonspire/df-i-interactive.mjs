// (i) Interactive exploration (STUDY ONLY): boots the game, dismisses the intro, then executes
// commands appended to $DF_CMD (default <run>/cmd.txt), one per line, and logs each result to
// <run>/done.txt. The clock stays paused between commands, so the game only moves when told to.
//   click x,y [note]     click at canvas fractions         pt <name> [note]   click a POINTS entry
//   key <Key> [note]     key press (Escape, Space, ...)    move x,y           hover
//   frames <name> <n> [every]  step n frames, capture every N (default 3)
//   hold <n>             step n frames, no capture         shot <name>        grid screenshot
//   spin <name>          df-lib spin() (capture until idle, every 3)
//   real <ms>            let the clock run in real time    quit
// Use it to find buttons and dialogs without paying a ~2 min boot per probe.
import fs from 'node:fs';
import path from 'node:path';
import { meta as m, boot, enterGame, spin, plays, roundOf } from './df-lib.mjs';
export const meta = { ...m, name: 'df-i-interactive' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (ref) {
  const d = ref.driver;
  const cmdFile = process.env.DF_CMD ?? path.join(d.outDir, 'cmd.txt');
  const doneFile = path.join(d.outDir, 'done.txt');
  if (!fs.existsSync(cmdFile)) fs.writeFileSync(cmdFile, '');
  await boot(ref);
  if (process.env.DF_NO_ENTER !== '1') await enterGame(ref);
  let n = 0;
  const say = (s) => fs.appendFileSync(doneFile, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
  say(`ready (frame ${d.frame}); commands from ${cmdFile}`);
  let lastCmd = Date.now();
  for (;;) {
    const lines = fs.readFileSync(cmdFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length <= n) {
      if (Date.now() - lastCmd > Number(process.env.DF_IDLE_QUIT_MS ?? 1_800_000)) {
        say('no command for 30 min: quitting');
        break;
      }
      await sleep(1000);
      continue;
    }
    const line = lines[n++];
    lastCmd = Date.now();
    const [op, a1, ...rest] = line.split(/\s+/);
    const xy = (s) => s.split(',').map(Number);
    const t0 = Date.now();
    try {
      if (op === 'quit') {
        say('quit');
        break;
      } else if (op === 'click') await ref.click(xy(a1), { note: rest.join(' ') || `interactive ${a1}` });
      else if (op === 'pt') await ref.click(a1, { note: rest.join(' ') || `interactive ${a1}` });
      else if (op === 'move') await ref.move(xy(a1), {});
      else if (op === 'key') await ref.key(a1, { note: rest.join(' ') || `interactive ${a1}` });
      else if (op === 'frames') await ref.frames(a1, Number(rest[0] ?? 60), { every: Number(rest[1] ?? 3) });
      else if (op === 'hold') await ref.wait((Number(a1) * 1000) / 60);
      else if (op === 'shot') await ref.screenshot(a1 ?? `shot${n}`, { grid: true });
      else if (op === 'spin') {
        const seg = await spin(ref, a1 ?? `spin${n}`, { every: 3, minMs: 1500, maxMs: 40_000 });
        say(`  spin ${seg.name}: ${seg.durationMs} ms, feature ${seg.feature ?? '-'}, round ${JSON.stringify(seg.round ?? null)}`);
      } else if (op === 'real') await ref.waitReal(Number(a1 ?? 2000));
      else throw new Error(`unknown op ${op}`);
      const shots = d.shots.slice(-1)[0];
      say(`ok #${n} ${line} (${((Date.now() - t0) / 1000).toFixed(1)} s, frame ${d.frame}${op === 'shot' ? `, ${shots.file}` : ''})`);
    } catch (e) {
      say(`ERR #${n} ${line}: ${String(e.message ?? e).split('\n')[0]}`);
    }
  }
  const last = plays(ref).slice(-1)[0];
  if (last) say(`last play: ${JSON.stringify(roundOf(last))}`);
}
