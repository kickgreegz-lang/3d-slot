import { Container, Graphics } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import { mixColor } from '../../../fx/util';
import { BUTTON, CAB, INK, LINE, METAL, OUTLINE, PLUM, WOOD, bolt } from './palette';

/**
 * `env_dj_booth` placeholder parts (ANIMATION_SET §4.2): Croak's turntable crate. Local space
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

export const boothGeom = (w: number, h: number): BoothGeom => {
  const deckH = Math.min(64, Math.max(40, h * 0.3));
  const lipH = Math.min(18, Math.max(12, h * 0.07));
  const deckY = -h;
  const crateY = deckY + deckH + lipH;
  const crateH = -10 - crateY;
  const cy = deckY + deckH * 0.52;
  const pr = Math.min(w * 0.26, deckH * 1.15);
  const platter = { x: w * 0.1, y: cy, r: pr, squash: 0.42 };
  const button = { x: -w / 2 + w * 0.2, y: cy - deckH * 0.02, r: Math.min(w * 0.1, deckH * 0.34) };
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
    button,
    platter,
    arm: { x: platter.x + pr * 1.08, y: cy - deckH * 0.28, len: pr * 0.92 },
    fader: { x0: -w / 2 + w * 0.08, x1: -w / 2 + w * 0.34, y: deckY + deckH * 0.86 },
    leds,
    ledR: Math.max(3.4, w * 0.018),
    socket: { x: -w / 2 + 10, y: crateY + 16 },
  };
};

/** Crate + deck (static): planks, sleeves in the gaps, corner posts, deck plate, collar, fader slot. */
export const drawBooth = (w: number, h: number): Container => {
  const G = boothGeom(w, h);
  const rnd = mulberry32(0xb007);
  const root = new Container();
  const x0 = -w / 2 + 2;
  const cw = w - 11;
  const g = new Graphics();

  // ---- crate: extrusion, dark interior, record sleeves, planks, posts, feet
  g.roundRect(x0 + 8, G.crateY + 8, cw, G.crateH, 10).fill(PLUM).stroke({ width: OUTLINE, color: INK });
  g.roundRect(x0, G.crateY, cw, G.crateH, 10).fill(CAB.hole).stroke({ width: OUTLINE, color: INK });
  // record sleeves standing in the crate (muted, so the gaps read as depth, not stripes)
  const sleeves = [0x35f2e0, 0xff3fa8, 0xffc629, 0xa8f03a, 0xff8a3d, 0x8d86ad];
  for (let x = x0 + 12, i = 0; x < x0 + cw - 26; i++) {
    const sw = 20 + rnd() * 10;
    const col = mixColor(sleeves[(i * 4 + 1) % sleeves.length], CAB.shade, 0.45);
    const top = G.crateY + 6 + rnd() * 10;
    g.rect(x, top, sw, G.crateH - 12).fill(col).stroke({ width: 2, color: INK });
    g.rect(x + 2, top + 2, 3, G.crateH - 16).fill({ color: 0xffffff, alpha: 0.22 });
    x += sw + 2 + rnd() * 5;
  }
  const planks = G.crateH > 110 ? 3 : 2;
  const gap = Math.max(7, G.crateH * 0.07);
  const ph = (G.crateH - gap * planks) / planks;
  for (let i = 0; i < planks; i++) {
    const py = G.crateY + gap * (i + 0.5) + ph * i + gap * 0.5;
    g.roundRect(x0 - 3, py, cw + 6, ph, 5).fill(WOOD.face).stroke({ width: OUTLINE * 0.85, color: INK });
    g.rect(x0 + 1, py + 3, cw - 2, ph * 0.22).fill(WOOD.light);
    g.rect(x0 + 1, py + ph * 0.74, cw - 2, ph * 0.22).fill(WOOD.grain);
    // grain streaks + a couple of nails
    for (let k = 0; k < 3; k++) {
      const gy = py + ph * (0.35 + rnd() * 0.3);
      const gx = x0 + 12 + rnd() * (cw - 60);
      g.moveTo(gx, gy).lineTo(gx + 26 + rnd() * 30, gy + (rnd() - 0.5) * 2).stroke({ width: 1.6, color: WOOD.crack, alpha: 0.7 });
    }
    for (const nx of [x0 + 12, x0 + cw - 12]) g.circle(nx, py + ph / 2, 2.6).fill(METAL.shade).stroke({ width: 1.2, color: INK });
  }
  // corner posts (darker wood)
  for (const px of [x0 - 4, x0 + cw - 14]) {
    g.roundRect(px, G.crateY - 2, 18, G.crateH + 4, 4).fill(WOOD.dark).stroke({ width: OUTLINE * 0.85, color: INK });
    g.rect(px + 3, G.crateY + 2, 4, G.crateH - 4).fill(WOOD.grain);
  }
  // feet
  for (const fx of [x0 + 10, x0 + cw - 38]) g.roundRect(fx, -12, 28, 12, 4).fill(METAL.dark).stroke({ width: LINE, color: INK });

  // ---- deck: lip (front edge) + top plate (seen from above), metal rim
  const dx0 = -w / 2 - 4;
  const dw = w + 2;
  g.roundRect(dx0 + 8, G.deckY + 8, dw, G.deckH + G.lipH, 12).fill(PLUM).stroke({ width: OUTLINE, color: INK });
  g.roundRect(dx0, G.deckY + G.deckH - 4, dw, G.lipH + 4, 6).fill(0x1d1430).stroke({ width: OUTLINE, color: INK });
  g.roundRect(dx0, G.deckY, dw, G.deckH, 12).fill(0x2a1d44).stroke({ width: OUTLINE, color: INK });
  g.roundRect(dx0 + 5, G.deckY + 4, dw - 10, 7, 4).fill(0x4a3a6e);
  g.roundRect(dx0 + dw - 16, G.deckY + 10, 9, G.deckH - 16, 4).fill(0x1b1230);
  // platter well (the platter sprite spins on top)
  const P = G.platter;
  g.ellipse(P.x, P.y + 3, P.r * 1.06, P.r * P.squash * 1.06 + 3).fill(METAL.shade).stroke({ width: LINE, color: INK });
  g.ellipse(P.x, P.y, P.r * 1.02, P.r * P.squash * 1.02).fill(METAL.base).stroke({ width: LINE, color: INK });
  // tonearm base
  bolt(g, G.arm.x, G.arm.y, Math.max(4, P.r * 0.1), METAL.light);
  // fader slot
  const F = G.fader;
  g.roundRect(F.x0 - 4, F.y - 3.5, F.x1 - F.x0 + 8, 7, 3.5).fill(0x0b0511).stroke({ width: 1.8, color: INK });
  // drop-button collar (the dome sprite sits in it)
  const B = G.button;
  g.ellipse(B.x, B.y + B.r * 0.28, B.r * 1.42, B.r * 0.72).fill(METAL.shade).stroke({ width: OUTLINE * 0.8, color: INK });
  g.ellipse(B.x, B.y + B.r * 0.14, B.r * 1.26, B.r * 0.6).fill(METAL.base).stroke({ width: LINE, color: INK });
  g.ellipse(B.x - B.r * 0.3, B.y - B.r * 0.08, B.r * 0.62, B.r * 0.2).fill({ color: METAL.light, alpha: 0.9 });
  // LED housings on the lip
  for (const l of G.leds) g.circle(l.x, l.y, G.ledR + 1.8).fill(0x0b0511).stroke({ width: 1.6, color: INK });
  root.addChild(g);
  return root;
};

/** Vinyl record on the platter, TOP view (squashed by its container): grooves, label, spindle. */
export const drawRecord = (r: number): Graphics => {
  const g = new Graphics();
  g.circle(0, 0, r).fill(0x151020).stroke({ width: OUTLINE * 0.8, color: INK });
  for (const k of [0.9, 0.78, 0.66, 0.54]) g.circle(0, 0, r * k).stroke({ width: 1.4, color: 0x2e2640 });
  // label: pink with a gold wedge so the spin reads
  g.circle(0, 0, r * 0.36).fill(0xff3fa8).stroke({ width: LINE, color: INK });
  g.moveTo(0, 0).arc(0, 0, r * 0.36, -0.5, 0.7).closePath().fill(0xffc629);
  g.circle(0, 0, r * 0.07).fill(METAL.bolt).stroke({ width: 1.2, color: INK });
  // sheen (fixed to the record: turns with it, as a real vinyl highlight would not; reads as spin)
  g.moveTo(Math.cos(-2.4) * r * 0.72, Math.sin(-2.4) * r * 0.72)
    .arc(0, 0, r * 0.72, -2.4, -1.6)
    .stroke({ width: r * 0.08, color: 0xffffff, alpha: 0.35 });
  return g;
};

/** Tonearm: pivot at (0, 0), arm along +x (length len) ending in the headshell. */
export const drawTonearm = (len: number): Graphics => {
  const g = new Graphics();
  g.moveTo(0, 0).lineTo(len, 0).stroke({ width: 6, color: INK, cap: 'round' });
  g.moveTo(0, 0).lineTo(len, 0).stroke({ width: 3, color: METAL.light, cap: 'round' });
  g.roundRect(len - 6, -5, 14, 10, 3).fill(METAL.base).stroke({ width: 1.8, color: INK });
  return g;
};

/** Drop-button dome (button_up art), centred at the collar top; pressed = squashed + lowered. */
export const drawButton = (r: number): Graphics => {
  const g = new Graphics();
  // skirt ring under the dome
  g.ellipse(0, r * 0.14, r * 1.08, r * 0.5).fill(BUTTON.shade).stroke({ width: OUTLINE * 0.7, color: INK });
  // dome: upper half-ellipse over the front half of the base ellipse
  const pts: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (i / 16) * Math.PI;
    pts.push(Math.cos(a) * r, r * 0.08 + Math.sin(a) * r * 0.9);
  }
  for (let i = 1; i < 16; i++) {
    const a = (i / 16) * Math.PI;
    pts.push(Math.cos(a) * r, r * 0.08 + Math.sin(a) * r * 0.4);
  }
  g.poly(pts, true).fill(BUTTON.base).stroke({ width: OUTLINE * 0.7, color: INK, join: 'round' });
  // hard shade on the lower right, highlight + specular top-left
  g.ellipse(r * 0.3, r * 0.12, r * 0.52, r * 0.24).fill({ color: BUTTON.shade, alpha: 0.7 });
  g.ellipse(-r * 0.36, -r * 0.44, r * 0.32, r * 0.15).fill(BUTTON.light);
  g.circle(-r * 0.52, -r * 0.52, r * 0.08).fill(0xffffff);
  return g;
};

/** Fader knob (moves along the slot). */
export const drawKnob = (): Graphics =>
  new Graphics().roundRect(-6, -9, 12, 18, 3).fill(METAL.light).stroke({ width: 2, color: INK }).rect(-4, -1, 8, 2).fill(INK);

/** LED dot (white; tinted per state). */
export const drawLed = (r: number): Graphics => new Graphics().circle(0, 0, r).fill(0xffffff).stroke({ width: 1.2, color: INK });
