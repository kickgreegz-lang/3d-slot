#!/usr/bin/env node
/**
 * GLB budget gate for mascots and 3D props (zero dependencies: reads the GLB JSON chunk and
 * image headers directly, so it works on meshopt/WebP-compressed files without decoders).
 *
 *   node tools/gltf/budget.mjs public/assets/mascots/mascot_gumbo.glb --mascot --json build/qa/gltf/gumbo/budget.json
 *
 * Budgets (docs/ANIMATION_CONTRACT.md §7.6, docs/PIPELINE.md §4.4):
 *   triangles < 15,000 · bones <= 65 (target 30-60) · textures <= 1024 px · file <= 1.5 MiB
 *   --mascot adds: every canonical clip (§7.2), morphs surprised + angry (§7.4), <= 2 draw calls
 *   KHR_texture_basisu fails unless --allow-ktx2 (the default Basis transcoder is a CDN fetch,
 *   which Stake's no-external-request rule forbids; self-host it first).
 * Exit: 0 pass · 3 budget breach · 1 error (unreadable file, bad arguments).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CANONICAL_CLIPS = ['idle', 'idle_bored', 'anticipation', 'react_small', 'win_big', 'celebrate', 'fs_trigger', 'fs_end'];
const MASCOT_MORPHS = ['surprised', 'angry'];

const HELP = `usage: node tools/gltf/budget.mjs <file.glb> [options]
  --max-tris N          default 15000 (fails when tris >= N)
  --max-bones N         default 65 (hard); --bones-target 30-60 warns outside the target
  --max-texture PX      default 1024
  --max-bytes N         default 1572864 (1.5 MiB)
  --max-draw-calls N    default off (--mascot: 2)
  --require-clips a,b   case-insensitive (the runtime matches names case-insensitively)
  --require-morphs a,b  case-insensitive
  --mascot              canonical clips + surprised/angry morphs + 2 draw calls
  --allow-ktx2          accept KHR_texture_basisu (only with self-hosted transcoders)
  --json PATH           write the report as JSON
  -h, --help`;

function parseArgs(argv) {
  const o = { maxTris: 15000, maxBones: 65, bonesTarget: [30, 60], maxTexture: 1024, maxBytes: 1572864,
    maxDrawCalls: null, clips: [], morphs: [], allowKtx2: false, json: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--max-tris') o.maxTris = Number(next());
    else if (a === '--max-bones') o.maxBones = Number(next());
    else if (a === '--bones-target') o.bonesTarget = next().split('-').map(Number);
    else if (a === '--max-texture') o.maxTexture = Number(next());
    else if (a === '--max-bytes') o.maxBytes = Number(next());
    else if (a === '--max-draw-calls') o.maxDrawCalls = Number(next());
    else if (a === '--require-clips') o.clips.push(...next().split(',').filter(Boolean));
    else if (a === '--require-morphs') o.morphs.push(...next().split(',').filter(Boolean));
    else if (a === '--mascot') { o.clips.push(...CANONICAL_CLIPS); o.morphs.push(...MASCOT_MORPHS); o.maxDrawCalls ??= 2; }
    else if (a === '--allow-ktx2') o.allowKtx2 = true;
    else if (a === '--json') o.json = next();
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (!o.file) o.file = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!o.file) throw new Error('missing <file.glb>');
  for (const k of ['maxTris', 'maxBones', 'maxTexture', 'maxBytes']) if (!Number.isFinite(o[k])) throw new Error(`bad --${k}`);
  return o;
}

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB (use .glb, not .gltf)`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = null;
  const off = 20 + jsonLen;
  if (off + 8 <= buf.length) bin = buf.subarray(off + 8, off + 8 + buf.readUInt32LE(off));
  return { json, bin, bytes: buf.length };
}

/** width/height from PNG, JPEG, WebP or KTX2 bytes */
function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { format: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { format: 'jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return { format: 'jpeg', w: 0, h: 0 };
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { format: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { format: 'webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { format: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  if (b.length > 28 && b[0] === 0xab && b.toString('ascii', 1, 4) === 'KTX') return { format: 'ktx2', w: b.readUInt32LE(20), h: b.readUInt32LE(24) };
  return { format: 'unknown', w: 0, h: 0 };
}

function analyse(path) {
  const { json: j, bin, bytes } = readGlb(path);
  const nodes = j.nodes ?? [];
  const meshes = j.meshes ?? [];
  const acc = j.accessors ?? [];
  // walk the default scene (instances count once per node that references a mesh)
  const sceneIdx = j.scene ?? 0;
  const roots = j.scenes?.[sceneIdx]?.nodes ?? nodes.map((_, i) => i);
  const seen = new Set();
  const meshNodes = [];
  const stack = [...roots];
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i)) continue;
    seen.add(i);
    if (nodes[i]?.mesh !== undefined) meshNodes.push(i);
    stack.push(...(nodes[i]?.children ?? []));
  }
  let tris = 0; let drawCalls = 0; let verts = 0;
  const morphs = new Set();
  for (const ni of meshNodes) {
    const m = meshes[nodes[ni].mesh];
    for (const n of m.extras?.targetNames ?? []) morphs.add(n);
    for (const p of m.primitives ?? []) {
      drawCalls++;
      const mode = p.mode ?? 4;
      const count = p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count;
      verts += acc[p.attributes.POSITION].count;
      if (mode === 4) tris += count / 3;
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
    }
  }
  const skins = (j.skins ?? []).map((s) => s.joints.length);
  const joints = new Set((j.skins ?? []).flatMap((s) => s.joints));
  const images = (j.images ?? []).map((img, i) => {
    let data = null;
    if (img.bufferView !== undefined && bin) {
      const bv = j.bufferViews[img.bufferView];
      data = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    } else if (img.uri?.startsWith('data:')) {
      data = Buffer.from(img.uri.split(',')[1], 'base64');
    } else if (img.uri) {
      const p = resolve(dirname(path), decodeURIComponent(img.uri));
      if (existsSync(p)) data = readFileSync(p);
    }
    const s = data ? imageSize(data) : { format: 'missing', w: 0, h: 0 };
    return { index: i, name: img.name ?? null, mimeType: img.mimeType ?? null, ...s, bytes: data?.length ?? 0 };
  });
  const animations = (j.animations ?? []).map((a) => {
    let dur = 0;
    for (const s of a.samplers) dur = Math.max(dur, acc[s.input]?.max?.[0] ?? 0);
    return { name: a.name ?? '', channels: a.channels.length, seconds: Math.round(dur * 1000) / 1000 };
  });
  return {
    file: path, bytes, tris: Math.round(tris), verts, drawCalls, meshNodes: meshNodes.length,
    materials: (j.materials ?? []).length, skins, bones: joints.size,
    morphs: [...morphs], animations, images,
    extensionsUsed: j.extensionsUsed ?? [], extensionsRequired: j.extensionsRequired ?? [],
    generator: j.asset?.generator ?? null,
  };
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`ERROR: ${e.message}\n${HELP}`); process.exit(1); }
  let r;
  try {
    if (!statSync(o.file).isFile()) throw new Error('not a file');
    r = analyse(o.file);
  } catch (e) { console.error(`ERROR: ${o.file}: ${e.message}`); process.exit(1); }

  const checks = [];
  const add = (name, pass, value, limit, level = 'fail') => checks.push({ name, pass, value, limit, level: pass ? 'ok' : level });
  add('tris', r.tris < o.maxTris, r.tris, `< ${o.maxTris}`);
  add('bones', r.bones <= o.maxBones, r.bones, `<= ${o.maxBones}`);
  if (r.bones > 0) add('bonesTarget', r.bones >= o.bonesTarget[0] && r.bones <= o.bonesTarget[1], r.bones, `${o.bonesTarget[0]}-${o.bonesTarget[1]}`, 'warn');
  const maxTex = Math.max(0, ...r.images.map((i) => Math.max(i.w, i.h)));
  add('textureSize', maxTex <= o.maxTexture, maxTex, `<= ${o.maxTexture} px`);
  add('fileSize', r.bytes <= o.maxBytes, r.bytes, `<= ${o.maxBytes} bytes`);
  const badImg = r.images.filter((i) => i.format === 'missing' || i.format === 'unknown');
  add('imagesReadable', badImg.length === 0, badImg.map((i) => i.index), 'all images decodable (png/jpeg/webp/ktx2)');
  const ktx2 = r.extensionsUsed.includes('KHR_texture_basisu');
  add('noKtx2', !ktx2 || o.allowKtx2, ktx2, o.allowKtx2 ? 'allowed (--allow-ktx2)' : 'no KHR_texture_basisu (Stake: no CDN transcoder)');
  const ktxDims = r.images.filter((i) => i.format === 'ktx2' && (i.w % 4 || i.h % 4));
  if (ktx2) add('ktx2MultipleOf4', ktxDims.length === 0, ktxDims.map((i) => `${i.w}x${i.h}`), 'KTX2 sizes multiple of 4');
  if (r.extensionsRequired.includes('KHR_draco_mesh_compression')) add('noDraco', false, true, 'meshopt only (runtime ships MeshoptDecoder, no Draco decoder)');
  if (o.maxDrawCalls !== null) add('drawCalls', r.drawCalls <= o.maxDrawCalls, r.drawCalls, `<= ${o.maxDrawCalls}`);
  else add('drawCalls', true, r.drawCalls, 'info (use --max-draw-calls / --mascot to gate)', 'info');
  const have = new Set(r.animations.map((a) => a.name.toLowerCase()));
  const missClips = [...new Set(o.clips)].filter((c) => !have.has(c.toLowerCase()));
  if (o.clips.length) add('clips', missClips.length === 0, missClips.length ? `missing ${missClips.join(',')}` : 'all present', o.clips.join(','));
  const haveM = new Set(r.morphs.map((m) => m.toLowerCase()));
  const missM = [...new Set(o.morphs)].filter((m) => !haveM.has(m.toLowerCase()));
  if (o.morphs.length) add('morphs', missM.length === 0, missM.length ? `missing ${missM.join(',')}` : 'all present', o.morphs.join(','));

  const failed = checks.filter((c) => c.level === 'fail');
  const report = { ...r, checks, passed: failed.length === 0, limits: o };
  if (o.json) { mkdirSync(dirname(resolve(o.json)), { recursive: true }); writeFileSync(o.json, JSON.stringify(report, null, 2) + '\n'); }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`budget ${r.file}: ${r.bytes} bytes, ${r.tris} tris, ${r.bones} bones, ${r.drawCalls} draw calls, ` +
    `${r.animations.length} clips, ${r.morphs.length} morphs, images ${r.images.map((i) => `${i.format} ${i.w}x${i.h}`).join(', ') || 'none'}`);
  for (const c of checks) console.log(`  ${pad(c.level.toUpperCase(), 5)} ${pad(c.name, 16)} ${pad(JSON.stringify(c.value), 28)} ${c.limit}`);
  if (failed.length) { console.error(`BUDGET BREACH: ${failed.map((c) => c.name).join(', ')}`); process.exit(3); }
  console.log('budget: PASS');
}

main();
