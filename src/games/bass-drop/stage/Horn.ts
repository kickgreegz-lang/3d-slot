import { gsap } from 'gsap';
import { Container, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import { followSpeed, s } from '../../../core/timing';
import { glowTexture } from '../../../fx/textures';
import { HORN, drawHornBell, drawHornBracket, drawHornCan, drawHornTrim, drawPuff } from './hornArt';
import { STAGE_LOOK } from './look';
import { Playhead, bake, bakeCentred, placeBaked, sample } from './rig';

const H = STAGE_LOOK.horn;

export type HornClip = 'boom_follow' | 'feature_follow' | 'pump';

interface Puff {
  sprite: Sprite;
  tween: gsap.core.Timeline | null;
}

/**
 * `env_horn` placeholder (ANIMATION_SET §4.3): a brass PA horn bolted on the frame beam's top
 * corner (anchor = the bolt point = the frame corner); the right one is the same rig with
 * scale.x -1. Clips: `idle` (tiny bell breathe per beat), `pump` (overlay, bell 1.05),
 * `boom_follow` (18 f: bell flares 1.18 at f2, the horn recoils 4 px along its axis, glow
 * flash and a dust puff `fx_puff` out of the mouth), `feature_follow` (54 f: pumps at f2 / f20
 * / f38). The bracket stays bolted; the can + bell recoil.
 */
export class Horn {
  readonly view = new Container({ label: 'envHorn' });
  private readonly bracket = new Sprite();
  /** recoiling part: driver can + bell */
  private readonly moving = new Container();
  private readonly can = new Sprite();
  private readonly bell = new Container();
  private readonly bellArt = new Sprite();
  private readonly trim = new Sprite();
  private readonly glow = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add' });
  private readonly puffLayer = new Container();
  private readonly puffs: Puff[] = [];
  private puffTex: Texture | null = null;
  private readonly clip = new Playhead();
  private readonly overlay = new Playhead();
  private textures: Texture[] = [];
  private key = '';
  private readonly rng: () => number;
  motion = 1;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.bell.position.set(HORN.throat.x, HORN.throat.y);
    this.bell.addChild(this.bellArt, this.trim, this.glow);
    this.glow.position.set(HORN.M.x - HORN.throat.x, HORN.M.y - HORN.throat.y);
    this.glow.width = this.glow.height = HORN.mouthR * 3.2;
    this.moving.addChild(this.can, this.bell);
    this.view.addChild(this.bracket, this.moving, this.puffLayer);
    this.view.visible = false;
  }

  /** (Re)bake at `res` (texture px per design px). */
  build(renderer: Renderer, res: number): void {
    const key = `${res}`;
    if (key === this.key) return;
    this.key = key;
    for (const t of this.textures) t.destroy(true);
    const bracket = bake(renderer, drawHornBracket(), new Rectangle(-12, -12, 84, 64), res);
    const can = bake(renderer, drawHornCan(), new Rectangle(-10, -12, 72, 70), res);
    // bell + trim in bell space (throat at 0, 0)
    const bellFrame = new Rectangle(-86, -78, 110, 104);
    const bell = bake(renderer, drawHornBell(), bellFrame, res);
    const trim = bake(renderer, drawHornTrim(), bellFrame, res);
    this.puffTex = bakeCentred(renderer, drawPuff(), 24, res);
    this.textures = [bracket.tex, can.tex, bell.tex, trim.tex, this.puffTex];
    placeBaked(this.bracket, bracket);
    placeBaked(this.can, can);
    placeBaked(this.bellArt, bell);
    placeBaked(this.trim, trim);
    for (const p of this.puffs) p.sprite.texture = this.puffTex;
  }

  setColor(color: number): void {
    this.trim.tint = color;
    this.glow.tint = color;
  }

  play(name: HornClip): void {
    if (name === 'pump') {
      this.overlay.play(name, H.pumpFrames);
      return;
    }
    this.clip.play(name, name === 'boom_follow' ? H.boomFrames : H.featureFrames);
    if (name === 'boom_follow') this.puff();
  }

  update(dt: number, env: number): void {
    const f = this.clip.advance(dt);
    const o = this.overlay.advance(dt);
    let flare = 1 + (H.breathe - 1) * env;
    let recoil = 0;
    let flash = 0;
    if (f >= 0 && this.clip.is('boom_follow')) {
      flare *= sample(H.boomBell, f);
      recoil = sample(H.boomRecoil, f);
      flash = sample(H.boomGlow, f);
    } else if (f >= 0) {
      flare *= sample(H.featureBell, f);
      recoil = sample(H.featureRecoil, f);
      flash = sample(H.featureGlow, f);
    }
    if (o >= 0) flare *= sample(H.pump, o);
    this.bell.scale.set(flare);
    const d = -recoil * HORN.recoil * this.motion;
    this.moving.position.set(HORN.u.x * d, HORN.u.y * d);
    this.glow.alpha = Math.min(1, 0.08 + 0.1 * env + flash);
  }

  /** fx_puff: a few cel dust puffs blown out of the mouth along the horn axis. */
  private puff(): void {
    if (!this.puffTex) return;
    const { u, n, M } = HORN;
    for (let i = 0; i < H.puffs; i++) {
      let p = this.puffs[i];
      if (!p) {
        p = { sprite: new Sprite({ texture: this.puffTex, anchor: 0.5 }), tween: null };
        this.puffs.push(p);
        this.puffLayer.addChild(p.sprite);
      }
      p.tween?.kill();
      const sp = p.sprite;
      const side = (this.rng() - 0.5) * 2;
      const travel = H.puffTravel * (0.7 + this.rng() * 0.6);
      sp.visible = true;
      sp.alpha = 1;
      sp.position.set(M.x + n.x * side * 14, M.y + n.y * side * 14);
      sp.scale.set(0.35 + this.rng() * 0.2);
      sp.rotation = this.rng() * Math.PI * 2;
      const life = s(H.puffLife * (0.8 + this.rng() * 0.4));
      const tl = gsap.timeline({ onComplete: () => void (sp.visible = false) });
      tl.to(sp, { x: sp.x + (u.x + n.x * side * 0.6) * travel, y: sp.y + (u.y + n.y * side * 0.6) * travel, rotation: sp.rotation + side, duration: life, ease: 'power2.out' }, 0);
      tl.to(sp.scale, { x: 1 + this.rng() * 0.3, y: 1 + this.rng() * 0.3, duration: life, ease: 'power2.out' }, 0);
      tl.to(sp, { alpha: 0, duration: life * 0.6, ease: 'power1.in' }, life * 0.4);
      p.tween = followSpeed(tl);
    }
  }

  destroy(): void {
    for (const p of this.puffs) p.tween?.kill();
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    this.view.destroy({ children: true });
  }
}
