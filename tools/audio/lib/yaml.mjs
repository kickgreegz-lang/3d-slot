// Minimal YAML subset parser for audio/cues.yaml (no dependency may be added to package.json).
// Supported: block mappings, block sequences (incl. "- key: value" items), flow sequences and
// flow mappings on one line, quoted/plain scalars, numbers, booleans, null, '#' comments.
// Not supported (a clear error is raised): block scalars (| >), anchors/aliases, tags, multi-doc.
// tools/audio/test checks it against PyYAML on tools/audio/cues.example.yaml.

class YamlError extends Error {}

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { i++; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).replace(/\s+$/, '');
    }
  }
  return s.replace(/\s+$/, '');
}

function scalar(s, where) {
  const t = s.trim();
  if (t === '') return null;
  if (t[0] === '"') {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(t)) throw new YamlError(`${where}: unterminated "string"`);
    return JSON.parse(t.replace(/\\'/g, "'"));
  }
  if (t[0] === "'") {
    if (!/^'(?:[^']|'')*'$/.test(t)) throw new YamlError(`${where}: unterminated 'string'`);
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[&*!]/.test(t)) throw new YamlError(`${where}: anchors, aliases and tags are not supported`);
  if (t === '|' || t === '>' || /^[|>][-+]?$/.test(t)) throw new YamlError(`${where}: block scalars are not supported; use a quoted single-line string`);
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^(null|Null|NULL|~)$/.test(t)) return null;
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

/** Flow collection parser ([a, b], {k: v}) over a single string. */
function flow(src, where) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const value = () => {
    ws();
    if (src[i] === '[') {
      i++; const out = []; ws();
      if (src[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value()); ws();
        if (src[i] === ',') { i++; ws(); if (src[i] === ']') { i++; return out; } continue; }
        if (src[i] === ']') { i++; return out; }
        throw new YamlError(`${where}: expected , or ] in flow sequence`);
      }
    }
    if (src[i] === '{') {
      i++; const out = {}; ws();
      if (src[i] === '}') { i++; return out; }
      for (;;) {
        ws();
        const k = token(':');
        if (src[i] !== ':') throw new YamlError(`${where}: expected ':' in flow mapping`);
        i++;
        out[String(scalar(k, where))] = value(); ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return out; }
        throw new YamlError(`${where}: expected , or } in flow mapping`);
      }
    }
    return scalar(token(''), where);
  };
  const token = (extra) => {
    ws();
    const start = i;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      while (i < src.length && src[i] !== q) { if (q === '"' && src[i] === '\\') i++; i++; }
      i++;
      return src.slice(start, i);
    }
    while (i < src.length && !',]}'.includes(src[i]) && !(extra && src[i] === extra && /[\s,]|$/.test(src[i + 1] ?? ''))) i++;
    return src.slice(start, i).trim();
  };
  const v = value(); ws();
  if (i !== src.length) throw new YamlError(`${where}: trailing characters after flow collection`);
  return v;
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#:[\]{},][^:]*?)\s*:(?:\s+(.*))?$/;

export function parseYaml(text, file = 'yaml') {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, n) => {
    if (/^\s*\t/.test(raw)) throw new YamlError(`${file}:${n + 1}: tabs are not allowed for indentation`);
    if (/^(---|\.\.\.)\s*$/.test(raw)) { if (lines.length) throw new YamlError(`${file}:${n + 1}: multiple documents are not supported`); return; }
    const s = stripComment(raw);
    if (!s.trim()) return;
    lines.push({ indent: s.length - s.trimStart().length, text: s.trim(), where: `${file}:${n + 1}` });
  });
  let pos = 0;
  const isSeq = (l) => l.text === '-' || l.text.startsWith('- ');
  const val = (s, where) => (s.startsWith('[') || s.startsWith('{') ? flow(s, where) : scalar(s, where));

  function node(indent) {
    return isSeq(lines[pos]) ? seq(indent) : map(indent);
  }
  function seq(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && isSeq(lines[pos])) {
      const l = lines[pos];
      const rest = l.text === '-' ? '' : l.text.slice(2).trim();
      if (!rest) {
        pos++;
        out.push(pos < lines.length && lines[pos].indent > indent ? node(lines[pos].indent) : null);
      } else if (KEY.test(rest) && !rest.startsWith('[') && !rest.startsWith('{')) {
        lines[pos] = { ...l, indent: indent + 2, text: rest };   // "- k: v" opens a mapping at indent+2
        out.push(map(indent + 2));
      } else {
        pos++;
        out.push(val(rest, l.where));
      }
    }
    return out;
  }
  function map(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !isSeq(lines[pos])) {
      const l = lines[pos];
      const m = KEY.exec(l.text);
      if (!m) throw new YamlError(`${l.where}: expected "key: value", got ${JSON.stringify(l.text)}`);
      const key = String(scalar(m[1], l.where));
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlError(`${l.where}: duplicate key ${key}`);
      pos++;
      const rest = (m[2] ?? '').trim();
      if (rest) {
        out[key] = val(rest, l.where);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        out[key] = node(lines[pos].indent);
      } else if (pos < lines.length && lines[pos].indent === indent && isSeq(lines[pos])) {
        out[key] = seq(indent);
      } else {
        out[key] = null;
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new YamlError(`${lines[pos].where}: unexpected indentation`);
    return out;
  }
  if (!lines.length) return null;
  const root = node(lines[0].indent);
  if (pos < lines.length) throw new YamlError(`${lines[pos].where}: unexpected content at indentation ${lines[pos].indent}`);
  return root;
}

export { YamlError };
