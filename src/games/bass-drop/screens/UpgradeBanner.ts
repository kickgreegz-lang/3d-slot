import { gsap } from 'gsap';
import { Container, Sprite } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import { followSpeed } from '../../../core/timing';
import { GodRays } from '../../../fx/filters/GodRays';
import { glowTexture } from '../../../fx/textures';
import { CYAN, type GlyphStyle } from '../../../present/common/glyphs';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { FONTS } from '../../../assets/fonts';
import { cracks, ribbon, shard } from './art/chrome';
import { jukebox, speakerStack } from './art/emblems';
import { screenArt, useBaked } from './art/ScreenArt';
import { HOT_PINK, JAM_GOLD, SCREENS_TIMING, SKINS } from './look';

export type UpgradeEvent = 'crack' | 'shatter' | 'title_hit' | 'count_hit';

const TYPE = { family: FONTS.title, extrude: 0.1 } as const;
const TITLE_STYLE: GlyphStyle = { ...TYPE, size: 118, palette: HOT_PINK, outline: 0.07, tracking: 0.03 };
const ADD_STYLE: GlyphStyle = { ...TYPE, size: 200, palette: JAM_GOLD, outline: 0.06, tracking: 0.02 };
const SUB_STYLE: GlyphStyle = { ...TYPE, size: 84, palette: CYAN, outline: 0.075, tracking: 0.03 };

const P = { emblemY: -150, emblemH: 380, ribbonY: 92, ribbonW: 780, ribbonH: 132, addY: 250, subY: 250 };
const SHARDS = 6;

interface ShardFlight {
  sprite: Sprite;
  /** launch offset from the emblem centre */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * UPGRADE BANNER — placeholder for the `ui_feature_upgrade` rig (DESIGN §10.4, ANIMATION_SET
 * §6.4): the Juke Jam jukebox cracks (f12) and shatters into six shards (f18), the crowned
 * speaker stack slams in (f28) with the MEGA MIX ribbon, then "+4" and FREE SPINS slam (f34).
 * `playIn()` is `in` (gameplay time, followSpeed) and reports the four events at their
 * frames; `playOut()` is `out`. Shard flights are seeded (same every time).
 */
export class UpgradeBanner {
  readonly back = new Container({ label: 'upgradeBack' });
  readonly front = new Container({ label: 'upgradeFront' });
  private readonly rays = new GodRays({ size: 1500, color: SKINS.megamix.rays, speed: 0.24, alpha: 0.75 });
  private readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0 });
  private readonly oldHolder = new Container();
  private readonly oldEmblem = new Sprite();
  private readonly crackSprite = new Sprite();
  private readonly newHolder = new Container();
  private readonly newEmblem = new Sprite();
  private readonly ribbonHolder = new Container();
  private readonly ribbon = new Sprite();
  private readonly shardLayer = new Container();
  private readonly shards: ShardFlight[] = [];
  private readonly textHolder = new Container();
  private title: Title | null = null;
  private add: Title | null = null;
  private sub: Title | null = null;
  private tl: gsap.core.Timeline | null = null;
  private extra: Array<gsap.core.Tween | gsap.core.Timeline> = [];
  private flying = false;

  constructor() {
    this.back.addChild(this.rays, this.glow);
    this.oldHolder.addChild(this.oldEmblem, this.crackSprite);
    this.newHolder.addChild(this.newEmblem);
    this.ribbonHolder.addChild(this.ribbon);
    this.front.addChild(this.oldHolder, this.shardLayer, this.newHolder, this.ribbonHolder, this.textHolder);
    for (let i = 0; i < SHARDS; i++) {
      const sprite = new Sprite();
      this.shardLayer.addChild(sprite);
      this.shards.push({ sprite, ox: 0, oy: 0, vx: 0, vy: 0, spin: 0 });
    }
    this.back.visible = this.front.visible = false;
  }

  get emblemPos(): { x: number; y: number } {
    return { x: 0, y: P.emblemY };
  }

  get addPos(): { x: number; y: number } {
    return { x: 0, y: P.addY };
  }

  setup(res: number, addFs: number): void {
    this.clear();
    const k = P.emblemH / 430;
    useBaked(this.oldEmblem, screenArt.get('emblem:jukejam', res * k, jukebox));
    this.oldEmblem.scale.set(P.emblemH / this.oldEmblem.texture.height);
    useBaked(this.crackSprite, screenArt.get('cracks', res * k, cracks));
    this.crackSprite.scale.set(this.oldEmblem.scale.x);
    this.crackSprite.alpha = 0;
    useBaked(this.newEmblem, screenArt.get('emblem:megamix', res * k, speakerStack));
    this.newEmblem.scale.set(P.emblemH / this.newEmblem.texture.height);
    useBaked(this.ribbon, screenArt.get(`ribbon:megamix:${P.ribbonW}`, res, () => ribbon(P.ribbonW, P.ribbonH, SKINS.megamix.accent, 0x7a0f5c)));
    this.oldHolder.position.set(0, P.emblemY);
    this.newHolder.position.set(0, P.emblemY);
    this.ribbonHolder.position.set(0, P.ribbonY);
    this.rays.y = P.emblemY + 60;
    this.glow.y = P.emblemY;
    this.glow.width = this.glow.height = P.emblemH * 2.1;
    this.glow.tint = SKINS.jukejam.second;
    // seeded shard directions: fan out and up, fall with gravity
    const rnd = mulberry32(0x5ad0 + addFs);
    this.shards.forEach((s, i) => {
      const b = screenArt.get(`shard:${i}`, res, () => shard(i));
      useBaked(s.sprite, b);
      const a = -Math.PI / 2 + (i / (SHARDS - 1) - 0.5) * Math.PI * 1.25 + (rnd() - 0.5) * 0.3;
      const v = 900 + rnd() * 500;
      s.ox = Math.cos(a) * 70;
      s.oy = Math.sin(a) * 90 + 40;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v - 200;
      s.spin = (rnd() - 0.5) * 14;
      s.sprite.visible = false;
    });
    this.title = new Title([{ text: label('bd.feature.megaMix', 'MEGA MIX'), style: TITLE_STYLE }], res, { maxWidth: P.ribbonW - 80 });
    this.title.y = P.ribbonY - 4;
    this.add = new Title([{ text: label('bd.feature.addSpins', '+{n}', { n: addFs }), style: ADD_STYLE }], res, { maxWidth: 420 });
    this.add.y = P.addY;
    this.sub = new Title([{ text: label('bd.feature.freeSpins', 'FREE SPINS'), style: SUB_STYLE }], res, { maxWidth: 520 });
    this.sub.y = P.subY + 6;
    // "+4" left of FREE SPINS: centre the pair
    const addW = this.add.width;
    const subW = this.sub.width;
    const gap = 36;
    const total = addW + gap + subW;
    this.add.x = -total / 2 + addW / 2;
    this.sub.x = total / 2 - subW / 2;
    this.textHolder.addChild(this.title, this.add, this.sub);
    this.back.visible = this.front.visible = true;
    this.back.alpha = this.front.alpha = 1;
    this.front.scale.set(1);
  }

  playIn(ms: (v: number) => number, onEvent: (e: UpgradeEvent) => void): gsap.core.Timeline {
    const U = SCREENS_TIMING.upgrade;
    const tl = gsap.timeline();
    const crack = ms(U.crack);
    const shatter = ms(U.shatter);
    const hit = ms(U.titleHit);
    const cHit = ms(U.countHit);
    // the jukebox pops in and trembles
    this.rays.scale.set(0);
    tl.to(this.rays.scale, { x: 0.8, y: 0.8, duration: ms(500), ease: 'back.out(1.4)' }, 0);
    tl.to(this.glow, { alpha: 0.45, duration: ms(250) }, 0);
    this.oldHolder.visible = true;
    this.oldHolder.scale.set(0);
    this.oldHolder.alpha = 1;
    tl.to(this.oldHolder.scale, { x: 1, y: 1, duration: ms(220), ease: 'back.out(2.4)' }, 0);
    tl.to(this.oldHolder, { rotation: 0.04, duration: ms(40), yoyo: true, repeat: 5, ease: 'sine.inOut' }, crack - ms(120));
    // crack (f12): lines appear, a jolt
    tl.set(this.crackSprite, { alpha: 1 }, crack);
    tl.fromTo(this.oldHolder.scale, { x: 1.06, y: 0.95 }, { x: 1, y: 1, duration: ms(160), ease: 'back.out(3)', immediateRender: false }, crack);
    tl.call(() => onEvent('crack'), undefined, crack);
    // shatter (f18): the emblem is gone, shards fly
    tl.set(this.oldHolder, { visible: false }, shatter);
    tl.call(
      () => {
        for (const s of this.shards) {
          s.sprite.visible = true;
          s.sprite.position.set(s.ox, P.emblemY + s.oy);
          s.sprite.rotation = 0;
          s.sprite.alpha = 1;
          s.sprite.scale.set(1);
        }
        this.flying = true;
        onEvent('shatter');
      },
      undefined,
      shatter,
    );
    tl.call(() => void (this.glow.tint = SKINS.megamix.accent), undefined, shatter);
    // the crowned stack slams (f28) with the ribbon + MEGA MIX
    this.newHolder.visible = true;
    this.newHolder.alpha = 0;
    this.newHolder.scale.set(2.2);
    tl.to(this.newHolder, { alpha: 1, duration: ms(80) }, hit - ms(170));
    tl.to(this.newHolder.scale, { x: 1, y: 1, duration: ms(170), ease: 'power3.in' }, hit - ms(170));
    tl.set(this.newHolder.scale, { x: 1.14, y: 0.82 }, hit);
    tl.to(this.newHolder.scale, { x: 1, y: 1, duration: ms(420), ease: 'elastic.out(1.1, 0.4)' }, hit);
    tl.to(this.rays.scale, { x: 1.1, y: 1.1, duration: ms(300), ease: 'back.out(2)' }, hit);
    tl.call(() => onEvent('title_hit'), undefined, hit);
    this.ribbonHolder.scale.set(0, 1);
    tl.to(this.ribbonHolder.scale, { x: 1, duration: ms(200), ease: 'back.out(1.7)' }, hit);
    const title = this.title;
    if (title) {
      for (const g of title.glyphs) g.sprite.alpha = 0;
      tl.call(() => void this.track(title.popIn({ duration: ms(300), stagger: ms(26), lineDelay: 0 })), undefined, hit + ms(40));
    }
    // "+4" and FREE SPINS slam (f34)
    for (const t of [this.add, this.sub]) {
      if (!t) continue;
      t.alpha = 0;
      t.scale.set(2.2);
      tl.to(t, { alpha: 1, duration: ms(70) }, cHit - ms(140));
      tl.to(t.scale, { x: 1, y: 1, duration: ms(140), ease: 'power3.in' }, cHit - ms(140));
    }
    tl.call(() => onEvent('count_hit'), undefined, cHit);
    tl.to({}, { duration: ms(U.in) - cHit }, cHit);
    for (const t of [title, this.add, this.sub]) if (t) tl.to(t, { waveAmp: 5, duration: ms(700) }, ms(U.in));
    this.tl = followSpeed(tl);
    return tl;
  }

  private track<A extends gsap.core.Tween | gsap.core.Timeline>(a: A): A {
    followSpeed(a);
    this.extra.push(a);
    return a;
  }

  /** Per frame (game dt): shard ballistics + title waves. */
  tick(dt: number): void {
    this.title?.tick(dt);
    this.add?.tick(dt);
    this.sub?.tick(dt);
    if (!this.flying) return;
    let alive = false;
    for (const s of this.shards) {
      const sp = s.sprite;
      if (!sp.visible) continue;
      s.vy += 2600 * dt;
      sp.x += s.vx * dt;
      sp.y += s.vy * dt;
      sp.rotation += s.spin * dt;
      sp.alpha = Math.max(0, sp.alpha - dt * 1.3);
      if (sp.alpha <= 0) sp.visible = false;
      else alive = true;
    }
    this.flying = alive;
  }

  playOut(duration: number): gsap.core.Timeline {
    this.tl?.kill();
    const tl = gsap.timeline();
    tl.to(this.front.scale, { x: 1.1, y: 1.1, duration, ease: 'power2.out' }, 0);
    tl.to([this.front, this.back], { alpha: 0, duration, ease: 'power1.in' }, 0);
    this.tl = followSpeed(tl);
    return tl;
  }

  clear(): void {
    this.tl?.kill();
    this.tl = null;
    for (const t of this.extra) t.kill();
    this.extra = [];
    for (const t of [this.title, this.add, this.sub]) t?.destroy();
    this.title = this.add = this.sub = null;
    this.flying = false;
    for (const s of this.shards) s.sprite.visible = false;
    this.back.visible = this.front.visible = false;
  }

  destroy(): void {
    this.clear();
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
