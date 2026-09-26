import type { LayoutKind, LayoutSpec, Pt, Rect } from '../../../config/layout';
import { registerTiming } from '../../../core/timing';
import type { GlyphPalette } from '../../../present/common/glyphs';
import type { GrooveFeature } from '../events';
import { GOLD, PINK, TEAL } from '../timing';

/** One authored Spine frame (every rig in ANIMATION_SET is authored at 30 fps). */
const F = 1000 / 30;
const f = (n: number): number => Math.round(n * F);

/**
 * SCREEN choreography (ms), registered as timing section `bassDropScreens` so the animation
 * lab can tune it. Frame windows follow ANIMATION_SET §6 (30 fps rigs): the placeholder
 * visuals play the same clips, so a Spine rig can replace them without re-timing the flow.
 *
 * Domains: the feature intro / upgrade / outro are GAMEPLAY time (s(), DESIGN §18.1: 2,600 /
 * 1,300 / 867 ms), the game intro cards and the buy screen are UI time (sUi(): never scaled).
 * The shared feature beats (trigger hold, dim, pump grid, tap locks) stay in BASS_DROP_TIMING.
 */
export const SCREENS_TIMING = registerTiming('bassDropScreens', {
  trigger: {
    /** board dim fade (DESIGN §10.1: 0.5 over 300 ms) */
    dimIn: 300,
    /** dim under the wipe while the banner shows (the curtain is the backdrop) */
    stageDim: 0.35,
    wipe: 620,
    /** mascot fsTrigger cue offset (DESIGN §10.1 t = 200) */
    mascotAt: 200,
    /** music duck from t 0 (the engine's fs:trigger scene duck: -6 dB held 2.4 s) */
    duckDb: -6,
    duckHold: 2400,
  },
  /** ui_feature_intro: in 36 f (title_hit f10, banner f10-f18, count_hit f20, shine f24), out 12 f */
  featureIntro: {
    in: f(36),
    titleHit: f(10),
    bannerFrom: f(10),
    bannerTo: f(18),
    countHit: f(20),
    shine: f(24),
    out: f(12),
    /** emblem pump once per 15 f at bpm / 120 (lands on the beat) */
    pumpFrames: 15,
    /** "TAP TO START" fades in once the count has landed */
    pressIn: f(28),
    pressPeriod: 1000,
  },
  /** ui_feature_upgrade: in 42 f (crack f12, shatter f18, title_hit f28, count_hit f34), 2,200 ms total */
  upgrade: {
    in: f(42),
    crack: f(12),
    shatter: f(18),
    titleHit: f(28),
    countHit: f(34),
    out: f(12),
    shardFlight: 700,
    flashMs: 140,
  },
  /** ui_feature_outro: in 30 f (title_hit f12), amount_punch 9 f, out 12 f; count = FS outroCount */
  outro: {
    in: f(30),
    titleHit: f(12),
    count: 1800,
    punch: f(9),
    out: f(12),
    pressIn: 300,
  },
  /** feature plate (landscape / tablet) */
  plate: { show: 400, hide: 250, punch: 260, punchScale: 1.22, retitle: 300 },
  /** ui_intro_cards (UI time): in 27 f, cards 4 f apart, card_land f12 / f16 / f20, title_hit f18 */
  introCards: {
    dim: 0.8,
    dimIn: 300,
    in: f(27),
    cardStagger: f(4),
    cardDrop: f(12),
    dropFrom: 150,
    settle: [-4, 3, -2],
    /** card titles slam in as whole words on card_land: scale titleFrom -> 1 over titleSlam ms */
    titleFrom: 1.35,
    titleSlam: 260,
    logoFrom: f(6),
    logoTo: f(18),
    loop: f(60),
    bob: 2,
    pressPeriod: 1000,
    out: f(12),
    outLift: 40,
  },
  /** ui_buy_cards (UI time): in 18 f (card_land f10 / f14), select 12 f, hover 6 f, press 4 f, out 12 f */
  buy: {
    dim: 0.82,
    dimIn: 250,
    in: f(18),
    cardLand: [f(10), f(14)],
    rise: 120,
    select: f(12),
    confirmScale: 1.08,
    hover: f(6),
    hoverLift: 6,
    press: f(4),
    pressScale: 0.92,
    out: f(12),
    confirmPulse: 1000,
  },
});

export type FeatureSkin = 'jukejam' | 'megamix';
export const skinOf = (feature: GrooveFeature): FeatureSkin => (feature === 'super' ? 'megamix' : 'jukejam');

/** Per-skin accent (wipe stripes, god rays, plate rim, title palette). */
export interface SkinLook {
  accent: number;
  second: number;
  rays: number;
  titleKey: string;
  wipe: { body: number; stripes: ReadonlyArray<{ w: number; color: number }> };
}

export const SKINS: Record<FeatureSkin, SkinLook> = {
  jukejam: {
    accent: GOLD,
    second: TEAL,
    rays: 0xffb321,
    titleKey: 'bd.feature.jukeJam',
    wipe: {
      body: 0x140a22,
      stripes: [
        { w: 150, color: GOLD },
        { w: 44, color: TEAL },
        { w: 110, color: 0xff8a3d },
      ],
    },
  },
  megamix: {
    accent: PINK,
    second: GOLD,
    rays: PINK,
    titleKey: 'bd.feature.megaMix',
    wipe: {
      body: 0x1c0622,
      stripes: [
        { w: 150, color: PINK },
        { w: 44, color: GOLD },
        { w: 110, color: 0xa66bff },
      ],
    },
  },
};

/** The CONFIRM / BUY accent (DESIGN §13). */
export const BUY_ACCENT = 0xf828c8;
export const CAPTION = 0xf8d828;
export const INK = 0x000000;
export const PLUM = 0x4b283d;

/** Glyph palettes for the baked display titles (ids must stay unique: they key the glyph cache). */
export const HOT_PINK: GlyphPalette = {
  id: 'bd-hot-pink',
  bands: [
    [0, '#ffe6fb'],
    [0.2, '#ff9ae6'],
    [0.5, '#f828c8'],
    [0.76, '#c4169c'],
    [0.9, '#8c0f70'],
  ],
  extrude: '#3d1233',
  extrudeFar: '#220a1d',
  outline: '#000000',
  specular: '#ffffff',
};

/** Juke Jam gold with a warmer, deeper foot than the engine GOLD (reads against the gold wipe). */
export const JAM_GOLD: GlyphPalette = {
  id: 'bd-jam-gold',
  bands: [
    [0, '#fffbe0'],
    [0.18, '#ffe45a'],
    [0.46, '#ffc629'],
    [0.72, '#ff9a1f'],
    [0.88, '#e0600c'],
  ],
  extrude: '#4b283d',
  extrudeFar: '#2c1224',
  outline: '#000000',
  specular: '#ffffff',
};

// ---------------------------------------------------------------------------------------
// screen rects (DESIGN §15.5 / layout.json intro + buy). Tablet = landscape + 420,
// compact = landscape x 0.5.

export interface IntroRects {
  logo: Rect;
  cards: [Rect, Rect, Rect];
  press: Pt;
  /** 'don't show again' toggle (left edge, vertical centre) */
  toggle: Pt;
  /** design-px scale of type and ornaments relative to landscape */
  k: number;
}

export interface BuyRects {
  title: Pt;
  cards: [Rect, Rect];
  confirmCard: Rect;
  buttons: Pt;
  close: Pt;
  k: number;
}

const INTRO_LANDSCAPE: IntroRects = {
  logo: { x: 760, y: 96, w: 400, h: 270 },
  cards: [
    { x: 160, y: 190, w: 480, h: 580 },
    { x: 720, y: 400, w: 480, h: 580 },
    { x: 1280, y: 190, w: 480, h: 580 },
  ],
  press: { x: 960, y: 1034 },
  toggle: { x: 164, y: 812 },
  k: 1,
};

const INTRO_PORTRAIT: IntroRects = {
  logo: { x: 240, y: 90, w: 600, h: 250 },
  cards: [
    { x: 100, y: 380, w: 880, h: 440 },
    { x: 100, y: 860, w: 880, h: 440 },
    { x: 100, y: 1340, w: 880, h: 440 },
  ],
  press: { x: 540, y: 1850 },
  toggle: { x: 100, y: 1850 },
  k: 1,
};

const BUY_LANDSCAPE: BuyRects = {
  title: { x: 960, y: 150 },
  cards: [
    { x: 400, y: 230, w: 500, h: 640 },
    { x: 1020, y: 230, w: 500, h: 640 },
  ],
  confirmCard: { x: 710, y: 200, w: 500, h: 640 },
  buttons: { x: 960, y: 940 },
  close: { x: 1580, y: 190 },
  k: 1,
};

const BUY_PORTRAIT: BuyRects = {
  title: { x: 540, y: 220 },
  cards: [
    { x: 140, y: 300, w: 800, h: 640 },
    { x: 140, y: 1000, w: 800, h: 640 },
  ],
  confirmCard: { x: 140, y: 520, w: 800, h: 640 },
  buttons: { x: 540, y: 1290 },
  close: { x: 980, y: 200 },
  k: 1,
};

const moveRect = (r: Rect, dy: number, k: number): Rect => ({ x: r.x * k, y: (r.y + dy) * k, w: r.w * k, h: r.h * k });
const movePt = (p: Pt, dy: number, k: number): Pt => ({ x: p.x * k, y: (p.y + dy) * k });

const deriveIntro = (b: IntroRects, dy: number, k: number): IntroRects => ({
  logo: moveRect(b.logo, dy, k),
  cards: [moveRect(b.cards[0], dy, k), moveRect(b.cards[1], dy, k), moveRect(b.cards[2], dy, k)],
  press: movePt(b.press, dy, k),
  toggle: movePt(b.toggle, dy, k),
  k,
});

const deriveBuy = (b: BuyRects, dy: number, k: number): BuyRects => ({
  title: movePt(b.title, dy, k),
  cards: [moveRect(b.cards[0], dy, k), moveRect(b.cards[1], dy, k)],
  confirmCard: moveRect(b.confirmCard, dy, k),
  buttons: movePt(b.buttons, dy, k),
  close: movePt(b.close, dy, k),
  k,
});

const INTRO: Record<LayoutKind, IntroRects> = {
  landscape: INTRO_LANDSCAPE,
  portrait: INTRO_PORTRAIT,
  tablet: deriveIntro(INTRO_LANDSCAPE, 420, 1),
  compact: deriveIntro(INTRO_LANDSCAPE, 0, 0.5),
};

const BUY: Record<LayoutKind, BuyRects> = {
  landscape: BUY_LANDSCAPE,
  portrait: BUY_PORTRAIT,
  tablet: deriveBuy(BUY_LANDSCAPE, 420, 1),
  compact: deriveBuy(BUY_LANDSCAPE, 0, 0.5),
};

export const introRects = (L: LayoutSpec): IntroRects => INTRO[L.kind];
export const buyRects = (L: LayoutSpec): BuyRects => BUY[L.kind];

/** Centre of a rect. */
export const centreOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
