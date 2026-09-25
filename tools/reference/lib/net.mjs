/**
 * Network logging for reference captures.
 *
 *  - network.json : every request (url, method, status, resourceType, mime, sizes, timing, frame/t)
 *  - rgs/NNNN-<endpoint>.json : Stake-Engine RGS calls (authenticate/play/end-round/balance,
 *                   bet/event, bet/replay) with parsed request + response bodies
 *  - rgs/summary.json : per-round event-type sequence + union of fields per book event type
 *  - assets.json  : art/audio/data asset URLs, classified (spine json/skel/atlas, image, audio…)
 *  - assets/…     : only with --save-assets (STUDY ONLY — never ship or commit)
 *
 * The sessionID from the launch URL is redacted everywhere by default.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RGS_PATH = /\/(wallet\/(authenticate|play|end-round|balance)|bet\/(event|replay))(\/|$|\?)/;
const EXT = (u) => {
  try {
    const p = new URL(u).pathname.toLowerCase();
    const m = /\.([a-z0-9]{1,6})$/.exec(p);
    return m ? m[1] : '';
  } catch {
    return '';
  }
};
const KIND_BY_EXT = {
  skel: 'spine-skel', atlas: 'atlas',
  png: 'image', webp: 'image', jpg: 'image', jpeg: 'image', avif: 'image', gif: 'image', svg: 'image', ktx: 'texture', ktx2: 'texture', basis: 'texture',
  mp3: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', opus: 'audio', flac: 'audio',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', fnt: 'bitmap-font',
  mp4: 'video', webm: 'video', mov: 'video',
  json: 'json', xml: 'data', txt: 'data', glsl: 'shader', frag: 'shader', vert: 'shader', wasm: 'wasm',
};
const ASSET_KINDS = new Set(['spine-skel', 'spine-json', 'atlas', 'texture-atlas-json', 'image', 'texture', 'audio', 'font', 'bitmap-font', 'video', 'json', 'data', 'shader']);

export function classify(url, mime = '', bodyHead = '') {
  const ext = EXT(url);
  let kind = KIND_BY_EXT[ext] ?? '';
  if (!kind) {
    if (/^image\//.test(mime)) kind = 'image';
    else if (/^audio\//.test(mime)) kind = 'audio';
    else if (/^video\//.test(mime)) kind = 'video';
    else if (/^font\/|woff/.test(mime)) kind = 'font';
    else if (/json/.test(mime)) kind = 'json';
    else if (/javascript|ecmascript/.test(mime) || ext === 'js' || ext === 'mjs') kind = 'code';
    else if (/css/.test(mime) || ext === 'css') kind = 'style';
    else if (/html/.test(mime) || ext === 'html') kind = 'document';
  }
  if (ext === 'webm' && /^audio\//.test(mime)) kind = 'audio';
  if (kind === 'json' && bodyHead) {
    if (/"skeleton"\s*:/.test(bodyHead) && /"bones"\s*:/.test(bodyHead)) kind = 'spine-json';
    else if (/"frames"\s*:/.test(bodyHead) && /"meta"\s*:/.test(bodyHead)) kind = 'texture-atlas-json';
  }
  return { kind: kind || 'other', ext };
}

const safeSeg = (s) => s.replace(/[^\w.@-]+/g, '_').slice(0, 120) || '_';

export class NetLog {
  /**
   * @param {object} o
   * @param {string} o.outDir run directory
   * @param {string} o.pageUrl launch URL (for rgs_url + sessionID)
   * @param {() => {frame:number|null,t:number|null}} o.now virtual timeline position
   * @param {boolean} [o.saveAssets]
   * @param {boolean} [o.redact] default true
   */
  constructor({ outDir, pageUrl, now, saveAssets = false, redact = true }) {
    this.outDir = outDir;
    this.now = now;
    this.saveAssets = saveAssets;
    this.entries = [];
    this.byReq = new Map();
    this.inflight = new Set();
    this.pending = new Set();
    this.rgs = [];
    this.websockets = [];
    this.lastActivity = Date.now();
    this.t0 = Date.now();
    this.seenUrls = [];
    let u;
    try {
      u = new URL(pageUrl);
    } catch {
      u = null;
    }
    this.session = redact && u ? u.searchParams.get('sessionID') : null;
    this.pageUrl = pageUrl;
    const rgs = u?.searchParams.get('rgs_url');
    this.rgsBase = rgs ? rgs.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
    this.savedAssetBytes = 0;
  }

  redact(s) {
    if (typeof s !== 'string' || !this.session) return s;
    return s.split(this.session).join('<sessionID>');
  }

  isRgs(url) {
    const bare = url.replace(/^https?:\/\//, '');
    if (this.rgsBase && bare.startsWith(this.rgsBase + '/')) return true;
    return RGS_PATH.test(new URL(url).pathname + '/');
  }

  rgsEndpoint(url) {
    const p = new URL(url).pathname;
    const m = RGS_PATH.exec(p + '/');
    return m ? m[1].replace(/\//g, '-') : safeSeg(p.split('/').filter(Boolean).slice(-2).join('-'));
  }

  attach(context) {
    this.context = context;
    context.on('request', (r) => this.onRequest(r));
    context.on('response', (r) => this.track(this.onResponse(r)));
    context.on('requestfinished', (r) => this.track(this.onDone(r, null)));
    context.on('requestfailed', (r) => this.track(this.onDone(r, r.failure()?.errorText ?? 'failed')));
    context.on('page', (p) => this.watchPage(p));
  }

  watchPage(page) {
    page.on('websocket', (ws) => {
      const e = { url: this.redact(ws.url()), openedAt: Date.now() - this.t0, ...this.now(), sent: 0, received: 0 };
      this.websockets.push(e);
      ws.on('framesent', () => e.sent++);
      ws.on('framereceived', () => e.received++);
    });
  }

  track(p) {
    this.pending.add(p);
    p.catch(() => {}).finally(() => this.pending.delete(p));
  }

  onRequest(req) {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const pos = this.now();
    const e = {
      id: this.entries.length + 1,
      url: this.redact(url),
      method: req.method(),
      type: req.resourceType(),
      start: Date.now() - this.t0,
      frame: pos.frame,
      t: pos.t,
    };
    this.entries.push(e);
    this.byReq.set(req, e);
    this.inflight.add(req);
    this.lastActivity = Date.now();
    this.seenUrls.push(url);
  }

  async onResponse(res) {
    const req = res.request();
    const e = this.byReq.get(req);
    if (!e) return;
    const headers = res.headers();
    e.status = res.status();
    e.mime = (headers['content-type'] ?? '').split(';')[0].trim();
    if (res.fromServiceWorker()) e.fromServiceWorker = true;
    const url = req.url();
    let rgs = false;
    try {
      rgs = this.isRgs(url) && req.method() !== 'OPTIONS';
    } catch {}
    if (rgs) return this.saveRgs(req, res, e);
    const { kind, ext } = classify(url, e.mime);
    e.kind = kind;
    e.ext = ext;
    const wantJsonPeek = kind === 'json';
    if (!ASSET_KINDS.has(kind) || (!this.saveAssets && !wantJsonPeek)) return;
    if (e.status < 200 || e.status >= 300) {
      if (e.status === 206) e.partial = true;
      else return;
    }
    let body;
    try {
      body = await res.body();
    } catch (err) {
      e.bodyError = String(err.message ?? err).split('\n')[0];
      return;
    }
    if (!body.length && (e.partial || this.saveAssets)) {
      // Chromium hands back an empty body for responses the page consumed as a Blob/stream
      // (Pixi: fetch -> blob -> createImageBitmap). Re-download those at the end.
      e.refetch = true;
      return;
    }
    e.bodyBytes = body.length;
    if (wantJsonPeek) e.kind = classify(url, e.mime, body.subarray(0, 64 * 1024).toString('utf8')).kind;
    if (this.saveAssets && !e.partial) this.saveAsset(url, body, e);
    else if (this.saveAssets) e.refetch = true;
  }

  /** Re-download assets whose body the browser could not hand back (blob-consumed, 206 ranges). */
  async refetchAssets() {
    let n = 0;
    for (const [req, e] of this.byReq) {
      if (!e.refetch) continue;
      try {
        const res = await this.context.request.get(req.url(), { headers: { referer: this.pageUrl }, timeout: 60_000 });
        const body = await res.body();
        if (res.ok() && body.length) {
          e.bodyBytes = body.length;
          e.refetched = true;
          if (e.kind === 'json') e.kind = classify(req.url(), e.mime, body.subarray(0, 64 * 1024).toString('utf8')).kind;
          if (this.saveAssets) this.saveAsset(req.url(), body, e);
          n++;
        } else e.bodyError = `refetch status ${res.status()}`;
      } catch (err) {
        e.bodyError = `refetch failed: ${String(err.message ?? err).split('\n')[0]}`;
      }
      delete e.refetch;
    }
    return n;
  }

  saveAsset(url, body, e) {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).map(safeSeg);
    let file = segs.pop() ?? 'index';
    if (u.search) {
      const h = crypto.createHash('sha1').update(u.search).digest('hex').slice(0, 8);
      const dot = file.lastIndexOf('.');
      file = dot > 0 ? `${file.slice(0, dot)}__${h}${file.slice(dot)}` : `${file}__${h}`;
    }
    const rel = path.join('assets', safeSeg(u.host), ...segs, file);
    const abs = path.join(this.outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    e.savedAs = rel.split(path.sep).join('/');
    this.savedAssetBytes += body.length;
  }

  async saveRgs(req, res, e) {
    const seq = this.rgs.length + 1;
    const endpoint = this.rgsEndpoint(req.url());
    e.kind = 'rgs';
    e.rgs = endpoint;
    const rec = { seq, endpoint, method: req.method(), url: e.url, status: e.status, frame: e.frame, t: e.t, wallStart: e.start };
    this.rgs.push(rec);
    const parse = (s) => {
      if (s == null) return null;
      const r = this.redact(s);
      try {
        return JSON.parse(r);
      } catch {
        return r;
      }
    };
    rec.request = parse(req.postData());
    try {
      rec.response = parse(await res.text());
    } catch (err) {
      rec.response = null;
      rec.bodyError = String(err.message ?? err).split('\n')[0];
    }
    const pos = this.now();
    rec.frameResponse = pos.frame;
    rec.tResponse = pos.t;
    rec.wallEnd = Date.now() - this.t0;
    rec.file = `rgs/${String(seq).padStart(4, '0')}-${endpoint}.json`;
    fs.mkdirSync(path.join(this.outDir, 'rgs'), { recursive: true });
    fs.writeFileSync(path.join(this.outDir, rec.file), JSON.stringify(rec, null, 2));
  }

  async onDone(req, failure) {
    const e = this.byReq.get(req);
    this.inflight.delete(req);
    this.lastActivity = Date.now();
    if (!e) return;
    const pos = this.now();
    e.end = Date.now() - this.t0;
    e.frameEnd = pos.frame;
    e.tEnd = pos.t;
    if (failure) e.failure = failure;
    try {
      const s = await req.sizes();
      e.size = s.responseBodySize;
      e.headersSize = s.responseHeadersSize;
      e.requestBodySize = s.requestBodySize;
    } catch {}
  }

  /** In-flight requests of the given resource types (default fetch/xhr). */
  busy(types = ['fetch', 'xhr'], olderThanMs = Infinity) {
    const now = Date.now();
    let n = 0;
    for (const r of this.inflight) {
      const e = this.byReq.get(r);
      if (!e || !types.includes(e.type)) continue;
      if (now - this.t0 - e.start > olderThanMs) continue; // long-lived (streaming/long-poll): ignore
      n++;
    }
    return n;
  }

  /** Wait until no fetch/xhr is in flight (or timeout). Returns ms waited, or -1 on timeout. */
  async waitIdle({ timeout = 5000, types = ['fetch', 'xhr'] } = {}) {
    const start = Date.now();
    if (!this.busy(types, timeout)) return 0;
    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 5));
      if (!this.busy(types, timeout)) {
        await Promise.allSettled([...this.pending]);
        return Date.now() - start;
      }
    }
    return -1;
  }

  seen(pattern) {
    const re = pattern instanceof RegExp ? pattern : null;
    return this.seenUrls.some((u) => (re ? re.test(u) : u.includes(pattern)));
  }

  summarizeRgs() {
    const rounds = [];
    const fieldsByType = {};
    const typeCounts = {};
    const findEvents = (o) => {
      if (!o || typeof o !== 'object') return null;
      if (Array.isArray(o.round?.state)) return o.round.state;
      if (Array.isArray(o.state)) return o.state;
      if (Array.isArray(o.round?.events)) return o.round.events;
      if (Array.isArray(o.events)) return o.events;
      return null;
    };
    for (const r of this.rgs) {
      const evs = findEvents(r.response);
      if (!evs) continue;
      const types = evs.map((ev) => (ev && typeof ev === 'object' ? ev.type ?? '?' : typeof ev));
      for (const ev of evs) {
        if (!ev || typeof ev !== 'object') continue;
        const t = ev.type ?? '?';
        typeCounts[t] = (typeCounts[t] ?? 0) + 1;
        const f = (fieldsByType[t] ??= {});
        for (const [k, v] of Object.entries(ev)) f[k] = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      }
      const round = r.response?.round ?? r.response;
      rounds.push({
        seq: r.seq,
        endpoint: r.endpoint,
        file: r.file,
        frame: r.frame,
        t: r.t,
        tResponse: r.tResponse,
        betID: round?.betID ?? round?.roundID ?? null,
        mode: round?.mode ?? null,
        payoutMultiplier: round?.payoutMultiplier ?? null,
        active: round?.active ?? null,
        events: types,
      });
    }
    return { calls: this.rgs.map(({ seq, endpoint, file, status, frame, t, tResponse }) => ({ seq, endpoint, file, status, frame, t, tResponse })), rounds, typeCounts, fieldsByType };
  }

  async finalize() {
    await Promise.allSettled([...this.pending]);
    if (this.context) await this.refetchAssets();
    const w = (name, data) => fs.writeFileSync(path.join(this.outDir, name), JSON.stringify(data, null, 2));
    w('network.json', { note: 'every request seen by the browser context; sizes are encoded body bytes', websockets: this.websockets, requests: this.entries });
    const assets = this.entries
      .filter((e) => e.kind && ASSET_KINDS.has(e.kind))
      .map(({ url, kind, ext, mime, status, size, bodyBytes, savedAs, partial, frame, t }) => ({ url, kind, ext, mime, status, size: bodyBytes ?? size, savedAs, partial, frame, t }));
    const byKind = {};
    for (const a of assets) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    w('assets.json', {
      note: 'Third-party asset URLs, for reference/study only. Never ship, commit or redistribute these files.',
      saved: this.saveAssets,
      byKind,
      assets,
    });
    if (this.rgs.length) {
      fs.mkdirSync(path.join(this.outDir, 'rgs'), { recursive: true });
      w('rgs/summary.json', this.summarizeRgs());
    }
    if (this.saveAssets) {
      fs.mkdirSync(path.join(this.outDir, 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(this.outDir, 'assets', 'STUDY-ONLY.txt'),
        'These files were downloaded from a third-party game demo by tools/reference/capture.mjs --save-assets.\n' +
          'They are copyrighted by their owners and are kept ONLY for local study of animation, timing and design.\n' +
          'Never ship, commit, redistribute, trace or derive production assets from them.\n',
      );
    }
    const failedHosts = {};
    for (const e of this.entries) {
      if (!e.failure && !(e.status >= 400)) continue;
      let host = '?';
      try {
        host = new URL(e.url).host;
      } catch {}
      const k = `${host} ${e.failure ?? `HTTP ${e.status}`}`;
      failedHosts[k] = (failedHosts[k] ?? 0) + 1;
    }
    return { requests: this.entries.length, rgs: this.rgs.length, assets: assets.length, savedAssetBytes: this.savedAssetBytes, failedHosts };
  }
}
