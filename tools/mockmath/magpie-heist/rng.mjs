/**
 * Deterministic seeded RNG for the mock math (no Math.random anywhere in the generator).
 * Seeds are built from any list of parts (strings / numbers), hashed with a
 * murmur-style mixer, then fed to sfc32 — the same parts always give the same stream.
 */

/** 32-bit hash stream of the joined seed parts (xmur3). */
const seedStream = (parts) => {
  const str = parts.map(String).join('|');
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
};

/**
 * @param {...(string|number)} parts seed parts, e.g. createRng('bass-drop', 'BASE', 17)
 */
export const createRng = (...parts) => {
  const s = seedStream(parts);
  let a = s();
  let b = s();
  let c = s();
  let d = s();
  /** sfc32: uniform float in [0, 1) */
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // warm up so near-identical seeds diverge immediately
  for (let i = 0; i < 12; i++) next();

  /** integer in [0, n) */
  const int = (n) => Math.floor(next() * n);

  /** key of a {key: weight} table, drawn proportionally to the weights */
  const weighted = (table) => {
    const entries = Object.entries(table);
    let total = 0;
    for (const [, w] of entries) total += w;
    let x = next() * total;
    for (const [k, w] of entries) {
      x -= w;
      if (x < 0) return k;
    }
    return entries[entries.length - 1][0];
  };

  /** in-place Fisher-Yates */
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  };

  return { next, int, weighted, shuffle };
};
