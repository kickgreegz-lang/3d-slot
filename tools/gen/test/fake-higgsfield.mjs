#!/usr/bin/env node
// Offline stand-in for the `higgsfield` CLI (tests only). Logs argv to $FAKE_HF_LOG and
// answers `version`, `generate cost`, `generate create ... --wait --json`, `model list --json`
// with the JSON shapes documented for @higgsfield/cli 1.1.x (id + result_url).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
if (process.env.FAKE_HF_LOG) fs.appendFileSync(process.env.FAKE_HF_LOG, `${JSON.stringify(argv)}\n`);

/** Minimal valid 8x8 RGB PNG of a flat colour (deterministic bytes). */
function png(r, g, b) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [r, g, b]).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const [cmd, sub, model] = argv;
if (cmd === 'version') { console.log('higgsfield 1.1.26 (fake)'); process.exit(0); }
if (cmd === 'model' && sub === 'list') { console.log(JSON.stringify([{ id: 'nano_banana_2', name: 'Nano Banana Pro' }])); process.exit(0); }
if (cmd === 'generate' && sub === 'cost') {
  // FAKE_HF_COST_UNKNOWN: a response without any recognised credit field (the wrapper must fail closed)
  console.log(JSON.stringify(process.env.FAKE_HF_COST_UNKNOWN ? { model, estimate: 'twelve' } : { model, credits: 12 }));
  process.exit(0);
}
if (cmd === 'generate' && sub === 'create') {
  if (!argv.includes('--wait') || !argv.includes('--json')) { console.error('fake: expected --wait --json'); process.exit(9); }
  if (process.env.FAKE_HF_FAIL) { console.log(JSON.stringify({ id: 'job-fail', status: 'failed' })); process.exit(0); }
  const dir = process.env.FAKE_HF_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fakehf-'));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `result_${model}.png`);
  fs.writeFileSync(out, png(0, 255, 0));
  if (process.env.FAKE_HF_TWO) {
    // two results; the second file does not exist yet (a download that fails until the test creates it)
    console.log(JSON.stringify({ id: 'job-0002', status: 'completed', result_urls: [pathToFileURL(out).href, pathToFileURL(path.join(dir, 'second.png')).href] }));
    process.exit(0);
  }
  console.log(JSON.stringify({ id: 'job-0001', status: 'completed', job_set_type: model, result_url: pathToFileURL(out).href }));
  process.exit(0);
}
console.error(`fake higgsfield: unsupported ${argv.join(' ')}`);
process.exit(2);
