import { Container, Graphics } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import { mixColor } from '../../../fx/util';
import { BOUNCE, BUTTON, CAB, CYPRESS, INK, LINE, METAL, OUTLINE, RIM, bolt, orb, ramp } from './palette';

/**
 * `env_dj_booth` code parts (ANIMATION_SET §4.2; the generated booth is unfunded, ART_STATUS §5),
 * in the formula-D finish of the painted set (palette.ts): the frame's cypress with soft top-lit
 * ramps and a warm floor bounce, glossy enamel / brass / vinyl with white speculars, a thin cool
 * rim on the far edges, one bold outline. Croak's turntable crate. Local space
 * anchored at the bottom centre of the booth rect (x in [-w/2, w/2], y in [-h, 0]). A wooden
 * record crate (cypress planks like the reel frame, record sleeves peeking through the gaps)
 * under an enamel deck seen slightly from above: the drop button on the deck's top-left (the
 * spin hex covers the booth's right edge), the turntable, the fader and a 4-LED strip on the
 * deck lip. Moving parts (platter, tonearm, fader knob, button dome, LEDs) are separate.
 */
export interface BoothGeom {
  w: number;
  h: number;
  /** deck top surface (seen from above) and the front lip under it */
  deckY: number;
  deckH: number;
  lipH: number;
  /** crate front face */
  crateY: number;
  crateH: number;
  /** drop button centre + radius; platter centre + radius (top view) + squash */
  button: { x: number; y: number; r: number };
  platter: { x: number; y: number; r: number; squash: number };
  /** tonearm pivot and fader slot */
  arm: { x: number; y: number; len: number };
  fader: { x0: number; x1: number; y: number };
  /** LED centres on the lip */
  leds: Array<{ x: number; y: number }>;
  ledR: number;
  /** cable socket */
  socket: { x: number; y: number };
}

/**
 * `button`: the drop button's centre in booth space (origin = bottom centre, design px), where
 * Croak's charge palm comes down; clamped so the collar stays inside the deck plate (it may sit at
 * the deck's back edge, the dome rising over it). Default: 0.2 w from the left, mid-deck.
 */
export const boothGeom = (w: number, h: number, button?: { x: number; y: number }): BoothGeom => {
  const deckH = Math.min(64, Math.max(40, h * 0.3));
  const lipH = Math.min(18, Math.max(12, h * 0.07));
  const deckY = -h;
  const crateY = deckY + deckH + lipH;
  const crateH = -10 - crateY;
  const cy = deckY + deckH * 0.52;
  const pr = Math.min(w * 0.26, deckH * 1.15);
  const platter = { x: w * 0.1, y: cy, r: pr, squash: 0.42 };
  const br = Math.min(w * 0.1, deckH * 0.34);
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const btn = button
    ? { x: clamp(button.x, -w / 2 + br + w * 0.05, -w * 0.02 - br), y: clamp(button.y, deckY + br * 0.45, deckY + deckH - br * 0.6), r: br }
    : { x: -w / 2 + w * 0.2, y: cy - deckH * 0.02, r: br };
  const ledY = deckY + deckH + lipH / 2;
  const leds = [0, 1, 2, 3].map((i) => ({ x: -w * 0.2 + i * w * 0.12, y: ledY }));
  return {
    w,
    h,
    deckY,
    deckH,
    lipH,
    crateY,
    crateH,
    button: btn,
    platter,
    arm: { x: platter.x + pr * 1.08, y: cy - deckH * 0.28, len: pr * 0.92 },
    fader: { x0: -w / 2 + w * 0.08, x1: -w / 2 + w * 0.34, y: deckY + deckH * 0.86 },
    leds,
    ledR: Math.max(3.4, w * 0.018),
    socket: { x: -w / 2 + 10, y: crateY + 16 },
  };
};

/** Crate + deck (static): planks, sleeves in the gaps, corner posts, deck plate, collar, fader slot. */
export const drawBooth = (w: number, h: number, button?: { x: number; y: number }): Container => {
  const G = boothGeom(w, h, button);
  const rnd = mulberry32(0xb007);
  const root = new Container();
  const x0 = -w / 2 + 2;
  const cw = w - 11;
  const g = new Graphics();

  // ---- crate: dark interior, record sleeves, planks, posts, feet
  g.roundRect(x0, G.crateY, cw, G.crateH, 10)
    .fill(ramp([
      [0, 0x2a1830],
      [1, CAB.hole],
    ]))
    .stroke({ width: OUTLINE, color: INK });
  // record sleeves standing in the crate (muted and top-lit, so the gaps read as depth, not stripes)
  const sleeves = [0x35f2e0, 0xff3fa8, 0xffc629, 0xa8f03a, 0xff8a3d, 0x8d86ad];
  for (let x = x0 + 12, i = 0; x < x0 + cw - 26; i++) {
    const sw = 20 + rnd() * 10;
    const col = mixColor(sleeves[(i * 4 + 1) % sleeves.length], CAB.shade, 0.4);
    const top = G.crateY + 6 + rnd() * 10;
    g.rect(x, top, sw, G.crateH - 12)
      .fill(ramp([
        [0, mixColor(col, 0xffffff, 0.25)],
        [0.45, col],
        [1, mixColor(col, CAB.hole, 0.6)],
      ]))
      .stroke({ width: LINE, color: INK });
    g.rect(x + 2, top + 2, 2.5, G.crateH - 16).fill({ color: 0xffffff, alpha: 0.28 });
    x += sw + 2 + rnd() * 5;
  }
  const planks = G.crateH > 110 ? 3 : 2;
  const gap = Math.max(7, G.crateH * 0.07);
  const ph = (G.crateH - gap * planks) / planks;
  for (let i = 0; i < planks; i++) {
    const py = G.crateY + gap * (i + 0.5) + ph * i + gap * 0.5;
    // painted cypress: key light from the top-left, the lower planks a touch darker. The ramp sits
    // on the frame's measured range (mean ~ #7a4a2a at display size), so the crate reads as the
    // same wood as the reel frame beside it rather than a lighter prop
    const dim = i / Math.max(1, planks - 1);
    g.roundRect(x0 - 3, py, cw + 6, ph, 5)
      .fill(ramp([
        [0, mixColor(mixColor(CYPRESS.face, CYPRESS.top, 0.4), CYPRESS.mid, dim * 0.5)],
        [0.55, mixColor(CYPRESS.mid, CYPRESS.low, 0.35 + dim * 0.3)],
        [1, mixColor(CYPRESS.low, CYPRESS.deep, 0.35)],
      ], 0.2, 0, 0.35, 1))
      .stroke({ width: OUTLINE * 0.85, color: INK });
    // grain streaks (thin interior lines) + a soft sheen along the top edge
    for (let k = 0; k < 4; k++) {
      const gy = py + ph * (0.3 + rnd() * 0.5);
      const gx = x0 + 10 + rnd() * (cw - 70);
      g.moveTo(gx, gy)
        .bezierCurveTo(gx + 14, gy - 2.5, gx + 30, gy + 2.5, gx + 44 + rnd() * 26, gy + (rnd() - 0.5) * 2)
        .stroke({ width: 1.2, color: CYPRESS.grain, alpha: 0.55 });
    }
    g.roundRect(x0 + 4, py + 2.5, cw * 0.62, Math.max(2, ph * 0.12), 2).fill({ color: 0xfff0d8, alpha: 0.16 });
    // thin cool rim along the far (right / lower) edges
    g.moveTo(x0 + cw * 0.55, py + ph - 1.6).lineTo(x0 + cw + 1, py + ph - 1.6).stroke({ width: 1.3, color: RIM, alpha: 0.45 });
    // brass nails
    for (const nx of [x0 + 12, x0 + cw - 12]) {
      g.circle(nx, py + ph / 2, 2.8).fill(orb([
        [0, 0xfff3b8],
        [0.5, 0xe0a030],
        [1, 0x7a4410],
      ])).stroke({ width: 1.1, color: INK });
    }
  }
  // warm floor bounce on the crate foot
  g.rect(x0 + 2, G.crateY + G.crateH * 0.72, cw - 4, G.crateH * 0.26).fill({
    fill: ramp([
      [0, CYPRESS.low],
      [1, BOUNCE],
    ], 0.5, 0, 0.5, 1),
    alpha: 0.16,
  });
  // corner posts (darker cypress)
  for (const px of [x0 - 4, x0 + cw - 14]) {
    g.roundRect(px, G.crateY - 2, 18, G.crateH + 4, 4)
      .fill(ramp([
        [0, CYPRESS.face],
        [0.6, CYPRESS.low],
        [1, CYPRESS.deep],
      ], 0, 0.2, 1, 0.8))
      .stroke({ width: OUTLINE * 0.85, color: INK });
    g.rect(px + 3, G.crateY + 3, 2.5, G.crateH - 6).fill({ color: 0xffe2bc, alpha: 0.3 });
    g.moveTo(px + 15, G.crateY + 6).lineTo(px + 15, G.crateY + G.crateH - 4).stroke({ width: 1.2, color: RIM, alpha: 0.4 });
  }
  // feet
  for (const fx of [x0 + 10, x0 + cw - 38]) {
    g.roundRect(fx, -12, 28, 12, 4)
      .fill(ramp([
        [0, METAL.base],
        [1, METAL.dark],
      ]))
      .stroke({ width: LINE, color: INK });
  }

  // ---- deck: lip (front edge) + top plate (seen from above), glossy enamel
  const dx0 = -w / 2 - 4;
  const dw = w + 2;
  g.roundRect(dx0, G.deckY + G.deckH - 4, dw, G.lipH + 4, 6)
    .fill(ramp([
      [0, 0x2c2046],
      [1, 0x120c20],
    ]))
    .stroke({ width: OUTLINE, color: INK });
  g.moveTo(dx0 + dw * 0.4, G.deckY + G.deckH + G.lipH - 1.5).lineTo(dx0 + dw - 6, G.deckY + G.deckH + G.lipH - 1.5).stroke({
    width: 1.3,
    color: RIM,
    alpha: 0.5,
  });
  g.roundRect(dx0, G.deckY, dw, G.deckH, 12)
    .fill(ramp([
      [0, 0x4d3c78],
      [0.45, 0x2e2150],
      [1, 0x1a1232],
    ], 0.15, 0, 0.6, 1))
    .stroke({ width: OUTLINE, color: INK });
  // gloss band + a crisp specular on the top-left corner
  g.roundRect(dx0 + 8, G.deckY + 4, dw * 0.55, 5, 2.5).fill({ color: 0xffffff, alpha: 0.22 });
  g.circle(dx0 + 12, G.deckY + 6.5, 1.8).fill({ color: 0xffffff, alpha: 0.9 });
  // platter well (the platter sprite spins on top)
  const P = G.platter;
  g.ellipse(P.x, P.y + 3, P.r * 1.06, P.r * P.squash * 1.06 + 3).fill(METAL.dark).stroke({ width: LINE, color: INK });
  g.ellipse(P.x, P.y, P.r * 1.02, P.r * P.squash * 1.02)
    .fill(ramp([
      [0, METAL.light],
      [0.5, METAL.base],
      [1, METAL.shade],
    ]))
    .stroke({ width: LINE, color: INK });
  // tonearm base
  bolt(g, G.arm.x, G.arm.y, Math.max(4, P.r * 0.1), METAL.light);
  // fader slot
  const F = G.fader;
  g.roundRect(F.x0 - 4, F.y - 3.5, F.x1 - F.x0 + 8, 7, 3.5).fill(0x0b0511).stroke({ width: 1.4, color: INK });
  // drop-button collar (the dome sprite sits in it)
  const B = G.button;
  g.ellipse(B.x, B.y + B.r * 0.28, B.r * 1.42, B.r * 0.72).fill(METAL.dark).stroke({ width: OUTLINE * 0.8, color: INK });
  g.ellipse(B.x, B.y + B.r * 0.14, B.r * 1.26, B.r * 0.6)
    .fill(ramp([
      [0, METAL.light],
      [1, METAL.shade],
    ]))
    .stroke({ width: LINE, color: INK });
  // LED housings on the lip
  for (const l of G.leds) g.circle(l.x, l.y, G.ledR + 1.8).fill(0x0b0511).stroke({ width: 1.3, color: INK });
  root.addChild(g);
  return root;
};

/** Vinyl record on the platter, TOP view (squashed by its container): grooves, label, spindle. */
export const drawRecord = (r: number): Graphics => {
  const g = new Graphics();
  g.circle(0, 0, r)
    .fill(orb([
      [0, 0x3a3150],
      [0.55, 0x1a1428],
      [1, 0x0c0814],
    ], 0.4, 0.35, 0.75))
    .stroke({ width: OUTLINE * 0.8, color: INK });
  for (const k of [0.9, 0.78, 0.66, 0.54]) g.circle(0, 0, r * k).stroke({ width: 1.1, color: 0x3a3150, alpha: 0.9 });
  // label: pink with a gold wedge so the spin reads
  g.circle(0, 0, r * 0.36)
    .fill(orb([
      [0, 0xff9ad8],
      [0.6, 0xff3fa8],
      [1, 0xb3246f],
    ]))
    .stroke({ width: LINE, color: INK });
  g.moveTo(0, 0).arc(0, 0, r * 0.36, -0.5, 0.7).closePath().fill(0xffc629);
  g.circle(0, 0, r * 0.07).fill(METAL.bolt).stroke({ width: 1, color: INK });
  // glossy sheen (fixed to the record: turns with it, as a real vinyl highlight would not; reads as spin)
  g.moveTo(Math.cos(-2.4) * r * 0.72, Math.sin(-2.4) * r * 0.72)
    .arc(0, 0, r * 0.72, -2.4, -1.6)
    .stroke({ width: r * 0.08, color: 0xffffff, alpha: 0.4 });
  return g;
};

/** Tonearm: pivot at (0, 0), arm along +x (length len) ending in the headshell. */
export const drawTonearm = (len: number): Graphics => {
  const g = new Graphics();
  g.moveTo(0, 0).lineTo(len, 0).stroke({ width: 5.4, color: INK, cap: 'round' });
  g.moveTo(0, 0).lineTo(len, 0).stroke({ width: 3, color: METAL.light, cap: 'round' });
  g.moveTo(2, -0.8).lineTo(len - 4, -0.8).stroke({ width: 1, color: 0xffffff, alpha: 0.7, cap: 'round' });
  g.roundRect(len - 6, -5, 14, 10, 3)
    .fill(ramp([
      [0, METAL.light],
      [1, METAL.shade],
    ]))
    .stroke({ width: 1.5, color: INK });
  return g;
};

/** Drop-button dome (button_up art), centred at the collar top; pressed = squashed + lowered. */
export const drawButton = (r: number): Graphics => {
  const g = new Graphics();
  // skirt ring under the dome
  g.ellipse(0, r * 0.14, r * 1.08, r * 0.5)
    .fill(ramp([
      [0, BUTTON.base],
      [1, 0x5a0a14],
    ]))
    .stroke({ width: OUTLINE * 0.7, color: INK });
  // dome: upper half-ellipse over the front half of the base ellipse, a glossy radial ramp
  const pts: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (i / 16) * Math.PI;
    pts.push(Math.cos(a) * r, r * 0.08 + Math.sin(a) * r * 0.9);
  }
  for (let i = 1; i < 16; i++) {
    const a = (i / 16) * Math.PI;
    pts.push(Math.cos(a) * r, r * 0.08 + Math.sin(a) * r * 0.4);
  }
  g.poly(pts, true)
    .fill(orb([
      [0, BUTTON.light],
      [0.45, BUTTON.base],
      [1, 0x8c0f1c],
    ], 0.34, 0.25, 0.85))
    .stroke({ width: OUTLINE * 0.7, color: INK, join: 'round' });
  // gloss + crisp specular top-left, cool rim on the lower right
  g.ellipse(-r * 0.34, -r * 0.46, r * 0.34, r * 0.14).fill({ color: 0xffffff, alpha: 0.55 });
  g.circle(-r * 0.54, -r * 0.5, r * 0.08).fill(0xffffff);
  g.moveTo(r * 0.35, r * 0.34).quadraticCurveTo(r * 0.8, r * 0.2, r * 0.94, -r * 0.1).stroke({ width: 1.2, color: RIM, alpha: 0.6, cap: 'round' });
  return g;
};

/** Fader knob (moves along the slot). */
export const drawKnob = (): Graphics =>
  new Graphics()
    .roundRect(-6, -9, 12, 18, 3)
    .fill(ramp([
      [0, 0xd9d4ea],
      [0.5, METAL.light],
      [1, METAL.shade],
    ]))
    .stroke({ width: 1.6, color: INK })
    .rect(-4, -1, 8, 2)
    .fill(INK);

/** LED dot (white; tinted per state) with a small specular. */
export const drawLed = (r: number): Graphics =>
  new Graphics()
    .circle(0, 0, r)
    .fill(0xffffff)
    .stroke({ width: 1.1, color: INK })
    .circle(-r * 0.35, -r * 0.35, r * 0.28)
    .fill({ color: 0xffffff, alpha: 0.9 });
