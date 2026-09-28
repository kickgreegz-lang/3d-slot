#!/usr/bin/env node
/**
 * Glyph coverage masks for tools/royals/build_royals.py, rendered by Chromium from the game's own WOFF2
 * (PIL cannot read WOFF2 and the tools venv has no fontTools/brotli).
 *   node tools/royals/glyph_masks.mjs --out build/royals/masks [--px 4096] [--font LilitaOne-Regular]
 * Writes <out>/<glyph>.png: white glyph on black, glyph em size 0.8 x px, drawn at (0.3 px, 0.3 px) baseline-top.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../capture/browser.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs();
const out = path.resolve(args.out ?? 'build/royals/masks');
const px = Number(args.px ?? 4096);
const fontName = args.font ?? 'LilitaOne-Regular';
const glyphs = (args.glyphs ?? 'A,K,Q,J,10').split(',');
const font = fs.readFileSync(path.join(REPO, 'public/assets/fonts', `${fontName}.woff2`)).toString('base64');
if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>@font-face{font-family:G;src:url(data:font/woff2;base64,${font}) format('woff2');}</style><div style="font-family:G">x</div>`);
  await page.evaluate(() => document.fonts.load('100px G'));
  for (const g of glyphs) {
    const url = await page.evaluate(([g, px]) => {
      const c = document.createElement('canvas');
      c.width = px * 2; c.height = px * 2;
      const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff'; x.font = `${px * 0.8}px G`; x.textBaseline = 'top';
      if ('letterSpacing' in x && g.length > 1) x.letterSpacing = `${-0.04 * px * 0.8}px`;
      x.fillText(g, px * 0.3, px * 0.3);
      return c.toDataURL('image/png');
    }, [g, px]);
    fs.writeFileSync(path.join(out, `${g}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`glyph_masks: ${g}`);
  }
} finally {
  await browser.close();
}
