#!/usr/bin/env node
/**
 * (Re)build contact sheets, grid overlays, MP4s and index.html for an existing capture run.
 *
 *   node tools/reference/postprocess.mjs <runDir> [--video] [--no-sheets] [--sheet-cols 8] [--sheet-max 60]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from './lib/args.mjs';
import { postprocess } from './lib/post.mjs';

const args = parseArgs(process.argv.slice(2), { booleans: ['video', 'no-sheets', 'help'] });
const runDir = args._[0];
if (!runDir || args.help || !fs.existsSync(path.join(runDir, 'segments.json'))) {
  console.log('usage: node tools/reference/postprocess.mjs <runDir> [--video] [--no-sheets] [--sheet-cols 8] [--sheet-max 60]');
  process.exit(runDir ? 2 : 0);
}
const execPath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: execPath, args: ['--no-sandbox'] });
try {
  await postprocess(path.resolve(runDir), {
    browser,
    video: !!args.video,
    sheets: !args['no-sheets'],
    sheetCols: Number(args['sheet-cols'] ?? 8),
    sheetMax: Number(args['sheet-max'] ?? 60),
  });
} finally {
  await browser.close();
}
console.log(`done: ${path.join(runDir, 'index.html')}`);
