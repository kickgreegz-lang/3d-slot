import { Container, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';
import { glowTexture } from '../../../fx/textures';
import { mixColor } from '../../../fx/util';
import { Cable } from './Cable';
import { cabinetGeom, drawCabinet, drawCabinetTrim, drawWoofer } from './cabinetArt';
import { STAGE_LOOK } from './look';
import { Playhead, bake, bakeCentred, placeBaked, sample } from './rig';

const C = STAGE_LOOK.cabinet;

export type CabinetClip = 'boom_follow' | 'feature_follow' | 'pump';

/**
 * `env_speaker_stack` placeholder (ANIMATION_SET §4.1): the lower speaker cabinet under the
 * Groove Meter, behind Gumbo and the menu / bonus-buy hexes. Anchor = bottom centre of the
 * lowerCabinet rect. Clips (Spine names): `idle` (woofer breathes per beat, runs always),
 * `pump` (overlay, woofer 1.06), `boom_follow` (18 f: woofer punch at f2, squash-stretch,
 * 3 px hop, cable whip, glow + floor light flash), `feature_follow` (54 f: pumps at f2 / f20
 * / f38). Parts: cabinet, woofer (pumps), fx_glow, floor_light (additive), skin trim, cable.
 */
export class LowerCabinet {
  readonly view = new Container({ label: 'envSpeakerStack' });
  /** squash / hop pivot at the feet */
  private readonly body = new Container();
  private readonly cabinet = new Sprite();
  private readonly trim = new Sprite();
  private readonly woofer = new Sprite();
  private readonly glow = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add' });
  private readonly floor = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add' });
  private readonly cable = new Cable(9);
  private readonly clip = new Playhead();
  private readonly overlay = new Playhead();
  private textures: Texture[] = [];
  private key = '';
  private w = 0;
  private color = 0xffffff;
  private lastF = -1;
  /** 0..1 screen-space motion (reduced motion: hops / whips drop, scales stay) */
  motion = 1;

  constructor() {
    this.woofer.anchor.set(0.5);
    this.body.addChild(this.cabinet, this.woofer, this.glow, this.trim);
    this.view.addChild(this.floor, this.body, this.cable.rope);
  }

  /** (Re)bake for a w x h rect at `res`; no-op when unchanged. */
  build(renderer: Renderer, w: number, h: number, res: number): void {
    const key = `${w}x${h}@${res}`;
    if (key === this.key) return;
    this.key = key;
    this.w = w;
    for (const t of this.textures) t.destroy(true);
    const G = cabinetGeom(w, h);
    const frame = new Rectangle(-w / 2 - 12, -h - 12, w + 34, h + 30);
    const body = bake(renderer, drawCabinet(w, h), frame, res);
    const trim = bake(renderer, drawCabinetTrim(w, h), frame, res);
    const wooferTex = bakeCentred(renderer, drawWoofer(G.coneR), G.coneR + 6, res);
    this.textures = [body.tex, trim.tex, wooferTex];
    placeBaked(this.cabinet, body);
    placeBaked(this.trim, trim);
    this.woofer.texture = wooferTex;
    this.woofer.position.set(G.wx, G.wy);
    this.glow.position.set(G.wx, G.wy);
    this.glow.width = this.glow.height = G.coneR * 2.8;
    this.floor.position.set(0, -4);
    this.floor.width = w * 1.7;
    this.floor.height = Math.max(60, h * 0.22);
    // cable: socket on the right side, down to the floor right of the feet
    this.cable.setWidth(9);
    this.cable.set(G.socket.x + 4, G.socket.y, w / 2 + 44, -3, h * 0.08);
    this.setColor(this.color);
  }

  setColor(color: number): void {
    this.color = color;
    this.trim.tint = color;
    this.glow.tint = color;
    this.floor.tint = mixColor(color, 0xffffff, 0.15);
  }

  play(name: CabinetClip): void {
    if (name === 'pump') {
      this.overlay.play(name, C.pumpFrames);
      return;
    }
    this.clip.play(name, name === 'boom_follow' ? C.boomFrames : C.featureFrames);
    if (name === 'boom_follow') this.cable.kick(C.cableKick * this.motion);
  }

  /** Per frame: dt game seconds, env = beat envelope (1 at the kick, decaying). */
  update(dt: number, env: number): void {
    if (!this.w) return;
    const f = this.clip.advance(dt);
    const o = this.overlay.advance(dt);
    let cone = 1 + (C.breathe - 1) * env;
    let sy = 1;
    let hop = 0;
    let flash = 0;
    if (f >= 0 && this.clip.is('boom_follow')) {
      cone *= sample(C.boomWoofer, f);
      sy = sample(C.boomSy, f);
      hop = sample(C.boomHop, f);
      flash = sample(C.boomGlow, f);
    } else if (f >= 0) {
      cone *= sample(C.featureWoofer, f);
      sy = sample(C.featureSy, f);
      flash = sample(C.featureGlow, f);
      // whip on the big third pump
      if (f >= 38 && this.lastF < 38) this.cable.kick(C.cableKick * this.motion);
    }
    this.lastF = f;
    if (o >= 0) cone *= sample(C.pump, o);
    this.woofer.scale.set(cone);
    this.body.scale.set(1 + (1 - sy) * 0.5, sy);
    this.body.y = hop * this.motion;
    this.glow.alpha = Math.min(1, C.glowIdle + C.glowBeat * env + flash);
    this.floor.alpha = Math.min(1, C.floorIdle + C.floorBeat * env + flash * 0.6);
    this.cable.update(dt);
  }

  destroy(): void {
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    this.view.destroy({ children: true });
  }
}
