import type { PointData } from 'pixi.js';
import { hexPoints } from '../hud/geometry';
import { BOLT, ringArrowPoints } from '../hud/icons';

/**
 * SVG twins of the Pixi HUD controls for the UI guide, generated from the SAME
 * geometry (hex corners, ring arrow, bolt) so the guide matches the game exactly.
 * Output is static trusted markup (numbers only).
 */
const DEG = Math.PI / 180;
const f = (n: number): string => n.toFixed(2);

/** Rounded polygon path (quadratic corners), like Graphics.roundShape(useQuadratic). */
const roundPath = (pts: PointData[], k: number): string => {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    const a = { x: p.x + (prev.x - p.x) * k, y: p.y + (prev.y - p.y) * k };
    const b = { x: p.x + (next.x - p.x) * k, y: p.y + (next.y - p.y) * k };
    d += `${i === 0 ? 'M' : 'L'}${f(a.x)},${f(a.y)} Q${f(p.x)},${f(p.y)} ${f(b.x)},${f(b.y)} `;
  }
  return `${d}Z`;
};

const polyPath = (pts: PointData[]): string => `M${pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' L')} Z`;

const GREY = `<linearGradient id="g" x1="0.3" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="#eeeeee"/><stop offset="1" stop-color="#8e8e8e"/></linearGradient>`;

const hexSvg = (inner: string, opts: { fill: string; stroke: string; sw: number; tilt: number; defs?: string }): string =>
  `<svg viewBox="-50 -50 100 100" width="100%" height="100%"><defs>${GREY}${opts.defs ?? ''}</defs>` +
  `<path d="${roundPath(hexPoints(44, opts.tilt), 0.2)}" fill="${opts.fill}" stroke="${opts.stroke}" stroke-width="${opts.sw}"/>${inner}</svg>`;

const small = (inner: string, tilt = 20): string =>
  hexSvg(inner, { fill: 'rgba(12,10,16,.85)', stroke: '#8a8a8a', sw: 2.5, tilt });

export const SVG_ICONS = {
  spin: hexSvg(
    `<path d="${polyPath(ringArrowPoints(18, 11, -64 * DEG, 192 * DEG, 30, 21))}" fill="#fff"/>`,
    { fill: 'rgba(0,0,0,.35)', stroke: 'rgba(255,255,255,.7)', sw: 2, tilt: 20 },
  ),
  autoplay: small(
    `<path d="${polyPath(ringArrowPoints(18, 5.5, -50 * DEG, 225 * DEG, 14, 9))}" fill="url(#g)"/>` +
      `<path d="M-6,-9 L10,0 L-6,9 Z" fill="url(#g)"/>`,
  ),
  turbo: small(`<path d="${polyPath(BOLT.map(([x, y]) => ({ x: x * 34, y: y * 34 })))}" fill="#fcd828"/>`),
  bet: small(`<path d="M0,-17 L16,-2 L6,-2 L6,17 L-6,17 L-6,-2 L-16,-2 Z" fill="url(#g)"/>`),
  menu: small(
    [-9, 0, 9].map((y) => `<rect x="-14" y="${y - 2.6}" width="28" height="5.2" rx="2.6" fill="url(#g)"/>`).join(''),
    -20,
  ),
  buy: hexSvg(
    `<circle r="19" fill="none" stroke="#fff" stroke-width="4"/>` +
      `<path d="${polyPath(
        Array.from({ length: 10 }, (_, i) => {
          const a = (-90 + i * 36) * DEG;
          const rr = i % 2 === 0 ? 12 : 5.6;
          return { x: Math.cos(a) * rr, y: Math.sin(a) * rr + 0.6 };
        }),
      )}" fill="#fff"/>`,
    {
      fill: 'url(#pk)',
      stroke: '#f828c8',
      sw: 3.5,
      tilt: -20,
      defs: `<linearGradient id="pk" x1="0.15" y1="0.1" x2="0.85" y2="0.95"><stop offset="0" stop-color="rgba(248,40,200,.1)"/><stop offset=".5" stop-color="rgba(214,28,172,.5)"/><stop offset="1" stop-color="rgba(248,40,200,.88)"/></linearGradient>`,
    },
  ),
  sound: small(
    `<path d="M-14,-6 L-7,-6 L2,-14 L2,14 L-7,6 L-14,6 Z" fill="url(#g)"/>` +
      `<path d="M7,-8 Q13,0 7,8" fill="none" stroke="#bbb" stroke-width="3.2" stroke-linecap="round"/>` +
      `<path d="M11,-13 Q20,0 11,13" fill="none" stroke="#999" stroke-width="3.2" stroke-linecap="round"/>`,
  ),
  close: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 7v6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17" r="1.6" fill="currentColor"/></svg>`,
} as const;
