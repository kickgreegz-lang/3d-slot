// Tiny ElevenLabs REST client (no SDK dependency) with a dry-run request log.
// Endpoints/params verified against elevenlabs-python / elevenlabs-js (2026-09-24):
//   POST v1/sound-generation?output_format=  {text, model_id, duration_seconds, prompt_influence, loop}
//   POST v1/music?output_format=             {prompt|composition_plan, music_length_ms, model_id, force_instrumental,
//                                             store_for_inpainting, seed}   -> audio; header 'song-id'
//   POST v1/music/plan                        {prompt, music_length_ms, model_id} -> composition plan JSON
//   POST v1/music/stem-separation (multipart) file, stem_variation_id -> ZIP
//   POST v1/music/video-to-music (multipart)  videos, description, tags, model_id -> audio
import fs from 'node:fs';
import path from 'node:path';
import { GenError } from '../../gen/lib/genlib.mjs';
import { sha256File } from '../../gen/lib/provenance.mjs';

export const API = 'https://api.elevenlabs.io';

export class Client {
  constructor({ apiBase = process.env.ELEVENLABS_API_BASE ?? API, apiKey = process.env.ELEVENLABS_API_KEY, dry = false } = {}) {
    this.base = apiBase.replace(/\/$/, '');
    this.key = apiKey;
    this.dry = dry;
    this.log = [];
    if (!dry && !apiKey) throw new GenError('set ELEVENLABS_API_KEY (ElevenLabs > API keys; Enterprise terms before shipping)');
  }

  url(p, query) {
    const q = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null);
    return `${this.base}/${p.replace(/^\//, '')}${q.length ? `?${new URLSearchParams(q.map(([k, v]) => [k, String(v)]))}` : ''}`;
  }

  /** json body or multipart `form` ({field: value | {file: path}}). Returns {status, headers, body: Buffer}. */
  async request(method, p, { query, json, form } = {}) {
    const url = this.url(p, query);
    const entry = { method, url, headers: { 'xi-api-key': '<redacted>' } };
    if (json) { entry.headers['Content-Type'] = 'application/json'; entry.body = json; }
    if (form) {
      entry.headers['Content-Type'] = 'multipart/form-data';
      entry.form = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v?.file ? { file: v.file, sha256: fs.existsSync(v.file) ? sha256File(v.file) : '<missing>' } : v]));
    }
    this.log.push(entry);
    if (this.dry) return null;
    let body;
    if (json) body = JSON.stringify(json);
    if (form) {
      body = new FormData();
      for (const [k, v] of Object.entries(form)) {
        const vals = Array.isArray(v) ? v : [v];
        for (const x of vals) {
          if (x?.file) body.append(k, new Blob([fs.readFileSync(x.file)]), path.basename(x.file));
          else body.append(k, typeof x === 'string' ? x : JSON.stringify(x));
        }
      }
    }
    let last;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(url, { method, body, headers: { 'xi-api-key': this.key, ...(json ? { 'Content-Type': 'application/json' } : {}) } });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.status === 429 || r.status >= 500) { last = `HTTP ${r.status}: ${buf.toString().slice(0, 300)}`; await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt)); continue; }
        if (!r.ok) throw new GenError(`${method} ${p}: HTTP ${r.status}: ${buf.toString().slice(0, 1000)}`, 5);
        return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: buf };
      } catch (e) {
        if (e instanceof GenError) throw e;
        last = e.message;
        await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
      }
    }
    throw new GenError(`${method} ${p}: ${last}`, 5);
  }
}
