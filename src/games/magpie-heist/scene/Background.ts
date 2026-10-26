import { gsap } from 'gsap';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { sUi } from '../../../core/timing';
import { onReducedMotion, reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import type { HeistFeature } from '../config';
import { CRIMSON, GOLD, MOON_TEAL, NAVY } from '../timing';
import { glowTexture, streakTexture } from './textures';

/** per-channel colour mix (a numeric tween of a hex value would smear the channels) */
const mixColor = (a: number, b: number, t: number): number => {
  const ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** design px past the visible edge (shake never shows a seam) */
const BLEED = 24;
const ROOT = './assets/magpie-heist/bg';
type Orient = 'landscape' | 'portrait';

/**
 * The look per heist: the plate tint (multiplied), the alarm wash (additive crimson pulse) and how
 * busy the lasers are. Night Prowl stays moonlit, Vault Raid turns gold, Starfall turns violet.
 */
const LOOKS: Record<'base' | HeistFeature, { tint: number; alarm: number; lasers: number; motes: number; vault: number }> = {
  base: { tint: 0xffffff, alarm: 0, lasers: 0.35, motes: 1, vault: 0.5 },
  prowl: { tint: 0xd8dcff, alarm: 0.22, lasers: 0.75, motes: 1, vault: 0.6 },
  vault: { tint: 0xffe2c4, alarm: 0.3, lasers: 0.9, motes: 0.8, vault: 1 },
  starfall: { tint: 0xe6d2ff, alarm: 0.18, lasers: 0.6, motes: 1.6, vault: 0.8 },
};

interface Mote {
  sp: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
}

interface Laser {
  sp: Sprite;
  /** anchor at the ceiling, sweep angle range (rad) and phase */
  x: number;
  y: number;
  a0: number;
  a1: number;
  speed: number;
  phase: number;
}

/**
 * BACKGROUND — the moonlit museum treasure hall (owns ctx.layers.background and ctx.layers.bgFx):
 *  - the painted plate (2:1 landscape, 1:2 portrait) cover-fitted to the visible design rect;
 *    a missing plate leaves a midnight gradient, never a console message;
 *  - living light on bgFx: moonbeam dust motes drifting down the skylight shafts, the crimson
 *    security lasers sweeping slowly under the dome, the vault's gold spill breathing, and in the
 *    heists an alarm wash pulsing over the walls;
 *  - looks crossfade (UI time) when a heist starts / upgrades / ends.
 * Nothing moves behind the reels: the motes and lasers live in the upper corners and side walls.
 */
export class Background implements GameModule {
  private readonly root = new Container({ label: 'mhBackground' });
  private readonly fx = new Container({ label: 'mhBgFx' });
  private readonly backdrop = new Graphics();
  private readonly plate = new Sprite({ anchor: 0.5 });
  private readonly alarm = new Sprite({ texture: Texture.WHITE, blendMode: 'add', tint: CRIMSON });
  private readonly moonGlow = new Sprite({ anchor: 0.5, blendMode: 'add', tint: MOON_TEAL });
  private readonly vaultGlow = new Sprite({ anchor: 0.5, blendMode: 'add', tint: GOLD });
  private readonly laserLayer = new Container({ label: 'lasers' });
  private readonly moteLayer = new Container({ label: 'motes' });
  private motes: Mote[] = [];
  private lasers: Laser[] = [];
  private offs: Array<() => void> = [];
  private orient: Orient = 'landscape';
  private readonly plates = new Map<Orient, Texture | null>();
  private readonly look = { ...LOOKS.base };
  private lookTween: gsap.core.Timeline | null = null;
  private tintFrom = 0xffffff;
  private tintTo = 0xffffff;
  private readonly tintMix = { t: 1 };
  private time = 0;
  private still = false;
  private readonly vis = { x: 0, y: 0, w: 1920, h: 1080 };

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    const glow = glowTexture(ctx.app.renderer);
    this.moonGlow.texture = glow;
    this.vaultGlow.texture = glow;
    this.root.addChild(this.backdrop, this.plate);
    this.fx.addChild(this.moonGlow, this.vaultGlow, this.laserLayer, this.moteLayer, this.alarm);
    ctx.layers.background.addChild(this.root);
    ctx.layers.bgFx.addChild(this.fx);
    this.still = reducedMotion();
    const streak = streakTexture(ctx.app.renderer);
    for (let i = 0; i < 4; i++) {
      const sp = new Sprite({ texture: streak, anchor: { x: 0.5, y: 0 }, blendMode: 'add', tint: 0xff3048 });
      this.laserLayer.addChild(sp);
      this.lasers.push({ sp, x: 0, y: 0, a0: 0, a1: 0, speed: 0.11 + i * 0.037, phase: i * 1.7 });
    }
    for (let i = 0; i < (ctx.tier === 'low' ? 18 : 36); i++) {
      const sp = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add', tint: 0xdff6ff });
      this.moteLayer.addChild(sp);
      this.motes.push(this.spawn({ sp, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1 }, true));
    }

    const g = ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('heist:mode', ({ feature }) => this.setLook(feature ?? 'base')),
      g.on('mode:change', ({ gameType }) => {
        if (gameType === 'basegame') this.setLook('base');
      }),
      onReducedMotion((on) => void (this.still = on)),
      clock.onUpdate((dt) => this.update(dt)),
    );
    this.layout(ctx.layout);
    await this.load(this.orient);
    this.fit();
  }

  layout(L: LayoutSpec): void {
    const { width: sw, height: sh } = this.ctx.app.screen;
    const cover = Math.max(sw / L.width, sh / L.height, 1e-6);
    const w = sw / cover;
    const h = sh / cover;
    Object.assign(this.vis, { x: (L.width - w) / 2, y: (L.height - h) / 2, w, h });
    const orient: Orient = L.kind === 'portrait' || (L.kind === 'tablet' && h > w) ? 'portrait' : 'landscape';
    if (orient !== this.orient) {
      this.orient = orient;
      void this.load(orient).then(() => this.fit());
    }
    this.fit();
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.lookTween?.kill();
    this.root.destroy({ children: true });
    this.fx.destroy({ children: true });
  }

  private async load(orient: Orient): Promise<void> {
    if (this.plates.has(orient)) return;
    this.plates.set(orient, null);
    // portrait falls back to the landscape plate (centre crop) until its own plate ships
    for (const url of orient === 'portrait' ? [`${ROOT}/base_portrait.webp`, `${ROOT}/base_landscape.webp`] : [`${ROOT}/base_landscape.webp`]) {
      try {
        const tex = await Assets.load<Texture>(url);
        this.plates.set(orient, tex);
        return;
      } catch {
        /* try the next one */
      }
    }
  }

  private setLook(key: 'base' | HeistFeature): void {
    this.lookTween?.kill();
    const { tint, ...rest } = LOOKS[key];
    this.tintFrom = this.plate.tint as number;
    this.tintTo = tint;
    this.tintMix.t = 0;
    const d = sUi(1400);
    this.lookTween = gsap
      .timeline()
      .to(this.look, { ...rest, duration: d, ease: 'sine.inOut' }, 0)
      .to(this.tintMix, { t: 1, duration: d, ease: 'sine.inOut', onUpdate: () => void (this.plate.tint = mixColor(this.tintFrom, this.tintTo, this.tintMix.t)) }, 0);
  }

  /** Where the light sources of the painting sit (fractions of the plate). */
  private anchors(): { moon: [number, number]; vault: [number, number]; dome: [number, number] } {
    return this.orient === 'portrait'
      ? { moon: [0.18, 0.22], vault: [0.84, 0.36], dome: [0.5, 0.06] }
      : { moon: [0.14, 0.36], vault: [0.84, 0.55], dome: [0.5, 0.08] };
  }

  private fit(): void {
    const v = this.vis;
    const W = v.w + BLEED * 2;
    const H = v.h + BLEED * 2;
    this.backdrop.clear().rect(v.x - BLEED, v.y - BLEED, W, H).fill({ color: NAVY });
    this.alarm.position.set(v.x - BLEED, v.y - BLEED);
    this.alarm.width = W;
    this.alarm.height = H;
    const tex = this.plates.get(this.orient) ?? null;
    this.plate.visible = !!tex;
    let pw = W;
    let ph = H;
    if (tex) {
      this.plate.texture = tex;
      const k = Math.max(W / tex.width, H / tex.height);
      this.plate.scale.set(k);
      pw = tex.width * k;
      ph = tex.height * k;
    }
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    this.plate.position.set(cx, cy);
    const a = this.anchors();
    const at = (f: [number, number]): [number, number] => [cx - pw / 2 + f[0] * pw, cy - ph / 2 + f[1] * ph];
    const [mx, my] = at(a.moon);
    this.moonGlow.position.set(mx, my);
    this.moonGlow.scale.set((pw * 0.32) / 256);
    const [vx, vy] = at(a.vault);
    this.vaultGlow.position.set(vx, vy);
    this.vaultGlow.scale.set((pw * 0.26) / 256);
    const [dx, dy] = at(a.dome);
    const spread = pw * 0.2;
    this.lasers.forEach((l, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      l.x = dx + side * spread * (0.6 + 0.35 * (i >> 1));
      l.y = dy;
      l.a0 = side * 0.35;
      l.a1 = side * 1.15;
      l.sp.height = ph * 0.48;
      l.sp.width = 10;
    });
  }

  private spawn(m: Mote, anywhere = false): Mote {
    const v = this.vis;
    // the skylight shafts: upper third, left and right of the reel area
    const side = Math.random() < 0.5 ? 0 : 1;
    const band = this.orient === 'portrait' ? [0.05, 0.95] : side === 0 ? [0.02, 0.3] : [0.72, 0.98];
    m.x = v.x + v.w * (band[0] + Math.random() * (band[1] - band[0]));
    m.y = v.y + v.h * (anywhere ? Math.random() * 0.9 : -0.02);
    m.vx = (Math.random() - 0.5) * 8;
    m.vy = 6 + Math.random() * 14;
    m.max = 6 + Math.random() * 8;
    m.life = anywhere ? Math.random() * m.max : 0;
    m.size = 0.03 + Math.random() * 0.05;
    return m;
  }

  private update(dt: number): void {
    this.time += dt;
    const L = this.look;
    const t = this.time;
    const calm = this.still ? 0 : 1;
    this.moonGlow.alpha = 0.16 + 0.04 * Math.sin(t * 0.7) * calm;
    this.vaultGlow.alpha = (0.12 + 0.06 * Math.sin(t * 1.3 + 1) * calm) * (0.5 + L.vault);
    // alarm: a slow double pulse (whoop-whoop) in the heists
    const ph = (t * 0.8) % 1;
    const pulse = Math.max(0, Math.sin(ph * Math.PI * 2)) ** 3;
    this.alarm.alpha = L.alarm * (0.25 + 0.75 * pulse * calm) * 0.35;
    this.alarm.visible = this.alarm.alpha > 0.003;
    for (const l of this.lasers) {
      const k = 0.5 + 0.5 * Math.sin(t * l.speed * Math.PI * 2 * calm + l.phase);
      l.sp.position.set(l.x, l.y);
      l.sp.rotation = l.a0 + (l.a1 - l.a0) * k;
      l.sp.alpha = L.lasers * (0.28 + 0.12 * Math.sin(t * 9 + l.phase));
    }
    const v = this.vis;
    for (const m of this.motes) {
      m.life += dt;
      if (m.life > m.max || m.y > v.y + v.h * 0.75) this.spawn(m);
      m.x += (m.vx + Math.sin(t * 0.6 + m.max) * 4) * dt * calm;
      m.y += m.vy * dt * calm;
      const fade = Math.min(1, m.life / 1.5, (m.max - m.life) / 1.5);
      m.sp.position.set(m.x, m.y);
      m.sp.scale.set(m.size);
      m.sp.alpha = 0.55 * fade * L.motes;
    }
  }
}
