import { Container, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';
import { speedScale } from '../../../core/timing';
import { glowTexture } from '../../../fx/textures';
import { Cable } from './Cable';
import { boothGeom, drawBooth, drawButton, drawKnob, drawLed, drawRecord, drawTonearm } from './boothArt';
import { STAGE_LOOK } from './look';
import { BUTTON } from './palette';
import { FPS, Playhead, bake, bakeCentred, placeBaked, sample } from './rig';

const B = STAGE_LOOK.booth;
const LED_OFF = 0x3a2d52;

export type BoothClip = 'scratch' | 'drop_press' | 'boom_follow' | 'frenzy_loop';

/**
 * `env_dj_booth` placeholder (ANIMATION_SET §4.2): Croak's turntable crate, drawn in front of
 * him. Anchor = bottom centre of the booth rect. Clips: `idle` (platter 1 rev / 72 f, LEDs
 * chase once per beat), `scratch` (36 f: platter back-and-forth x2, tonearm jitter, fader;
 * sfx dj_scratch at f4 through `onSfx`), `drop_press` (15 f stretched over the charge: button
 * glow ramps f0-f13, button down f14-f15 with sfx button_slam on the first charge of a step,
 * standing in for Croak's palm until the 2D mascot rig plays it), `boom_follow` (18 f: crate hop, all LEDs on and
 * fading, the button pops back up), `frenzy_loop` (LEDs strobe 2.5 Hz, platter fast).
 */
export class Booth {
  readonly view = new Container({ label: 'envDjBooth' });
  /** hop pivot at the feet */
  private readonly crate = new Container();
  private readonly deck = new Sprite();
  private readonly platter = new Container();
  private readonly record = new Sprite();
  private readonly arm = new Sprite();
  private readonly knob = new Sprite();
  private readonly buttonGlow = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add' });
  private readonly button = new Sprite();
  private readonly leds: Sprite[] = [];
  private readonly ledGlows: Sprite[] = [];
  private readonly cable = new Cable(7);
  private readonly clip = new Playhead();
  private readonly press = new Playhead();
  private textures: Texture[] = [];
  private key = '';
  private geom: ReturnType<typeof boothGeom> | null = null;
  private color = 0xffffff;
  private spin = 0;
  private frenzy = false;
  private strobeT = 0;
  private pressed = false;
  private lastScratchF = -1;
  /** tonearm rest angle (pivot -> the record's outer grooves) */
  private armAngle = 0;
  motion = 1;
  /** Spine `sfx` events: dj_scratch (scratch f4), button_slam (drop_press f14, first drop of a step) */
  onSfx: ((id: 'dj_scratch' | 'button_slam') => void) | null = null;
  /** this press ends in a button_slam (Croak's palm on the first charge; chained presses are silent) */
  private slamSfx = false;

  constructor() {
    this.record.anchor.set(0.5);
    this.button.anchor.set(0.5, 0.62);
    this.knob.anchor.set(0.5);
    this.arm.anchor.set(0.08, 0.5);
    this.platter.addChild(this.record);
    this.crate.addChild(this.deck, this.platter, this.arm, this.knob, this.buttonGlow, this.button);
    for (let i = 0; i < 4; i++) {
      const led = new Sprite();
      led.anchor.set(0.5);
      const glow = new Sprite({ texture: glowTexture(64), anchor: 0.5, blendMode: 'add' });
      this.leds.push(led);
      this.ledGlows.push(glow);
      this.crate.addChild(led, glow);
    }
    this.view.addChild(this.cable.rope, this.crate);
  }

  build(renderer: Renderer, w: number, h: number, res: number): void {
    const key = `${w}x${h}@${res}`;
    if (key === this.key) return;
    this.key = key;
    for (const t of this.textures) t.destroy(true);
    const G = boothGeom(w, h);
    this.geom = G;
    const deck = bake(renderer, drawBooth(w, h), new Rectangle(-w / 2 - 12, -h - 10, w + 34, h + 22), res);
    const record = bakeCentred(renderer, drawRecord(G.platter.r), G.platter.r + 4, res * 1.5);
    const arm = bake(renderer, drawTonearm(G.arm.len), new Rectangle(-4, -8, G.arm.len + 14, 16), res);
    const button = bakeCentred(renderer, drawButton(G.button.r), G.button.r * 1.3, res);
    const knob = bakeCentred(renderer, drawKnob(), 11, res);
    const led = bakeCentred(renderer, drawLed(G.ledR), G.ledR + 2, Math.max(res, 1.5));
    this.textures = [deck.tex, record, arm.tex, button, knob, led];
    placeBaked(this.deck, deck);
    this.record.texture = record;
    this.platter.position.set(G.platter.x, G.platter.y);
    this.platter.scale.set(1, G.platter.squash);
    this.arm.texture = arm.tex;
    this.arm.anchor.set(4 / (G.arm.len + 14), 0.5);
    this.arm.position.set(G.arm.x, G.arm.y);
    this.armAngle = Math.atan2(G.platter.y + G.platter.r * G.platter.squash * 0.25 - G.arm.y, G.platter.x + G.platter.r * 0.5 - G.arm.x);
    this.button.texture = button;
    this.button.position.set(G.button.x, G.button.y);
    this.buttonGlow.position.set(G.button.x, G.button.y);
    this.buttonGlow.width = this.buttonGlow.height = G.button.r * 5;
    this.buttonGlow.tint = BUTTON.base;
    this.knob.texture = knob;
    for (let i = 0; i < 4; i++) {
      const p = G.leds[i];
      this.leds[i].texture = led;
      this.leds[i].position.set(p.x, p.y);
      this.ledGlows[i].position.set(p.x, p.y);
      this.ledGlows[i].width = this.ledGlows[i].height = G.ledR * 7;
    }
    this.cable.set(G.socket.x, G.socket.y, -w / 2 - 34, -3, h * 0.06);
  }

  setColor(color: number): void {
    this.color = color;
  }

  play(name: BoothClip, lengthSec = 0, slam = false): void {
    switch (name) {
      case 'frenzy_loop':
        this.frenzy = true;
        return;
      case 'drop_press':
        // 15 f stretched over the charge (game s, already s()-scaled), like Croak's bass_drop_charge;
        // the playhead multiplies by speedScale(), so a slam mid-charge retimes it with the boom
        this.pressed = false;
        this.slamSfx = slam;
        this.press.play(name, B.pressFrames, lengthSec > 0 ? B.pressFrames / (FPS * lengthSec * speedScale()) : 1);
        return;
      case 'scratch':
        // never over a drop (the press and boom own the deck then)
        if (this.press.name || this.clip.is('boom_follow')) return;
        this.clip.play(name, B.scratchFrames);
        this.lastScratchF = -1;
        return;
      case 'boom_follow':
        this.clip.play(name, B.boomFrames);
        this.cable.kick(50 * this.motion);
    }
  }

  stopLoop(): void {
    this.frenzy = false;
  }

  /** Per frame: dt game seconds, beat = beat phase 0..1, env = beat envelope. */
  update(dt: number, beat: number, env: number): void {
    const G = this.geom;
    if (!G) return;
    const f = this.clip.advance(dt);
    // drop_press runs on its own playhead (stretched to the charge)
    const pressing = !!this.press.name;
    const pf = this.press.advance(dt);
    if (!this.pressed && (pf >= B.pressDownFrame || (pressing && pf < 0))) {
      this.pressed = true;
      if (this.slamSfx) this.onSfx?.('button_slam');
      this.slamSfx = false;
    }
    let hop = 0;
    let spinOff = 0;
    let fader = 0.7;
    let armJitter = 0;
    let ledsAll = -1;
    if (f >= 0 && this.clip.is('scratch')) {
      spinOff = sample(B.scratchSpin, f);
      fader = sample(B.scratchFader, f);
      armJitter = Math.sin(f * 1.7) * 0.05;
      if (f >= B.scratchSfxFrame && this.lastScratchF < B.scratchSfxFrame) this.onSfx?.('dj_scratch');
      this.lastScratchF = f;
    } else if (f >= 0 && this.clip.is('boom_follow')) {
      hop = sample(B.boomHop, f);
      ledsAll = sample(B.boomLeds, f);
      if (f >= B.releaseFrame) this.pressed = false;
    }
    // drop_press: glow ramp, button down at f14
    let glow = 0.1 + 0.08 * env;
    if (pf >= 0) glow = sample(B.pressGlow, pf);
    else if (this.pressed) glow = 1;
    this.button.position.y = G.button.y + (this.pressed ? G.button.r * 0.22 : 0);
    this.button.scale.set(1, this.pressed ? 0.78 : 1);
    this.buttonGlow.alpha = glow;
    this.buttonGlow.scale.set((G.button.r * 5 * (0.85 + glow * 0.3)) / 128);

    // platter + tonearm + fader
    this.spin += (dt * Math.PI * 2 * (this.frenzy ? B.frenzySpin : 1)) / B.platterRev;
    this.record.rotation = this.spin + spinOff;
    this.arm.rotation = this.armAngle + armJitter;
    this.knob.position.set(G.fader.x0 + (G.fader.x1 - G.fader.x0) * fader, G.fader.y);

    // LEDs: chase once per beat; boom: all on and fading; frenzy: strobe
    this.strobeT += dt;
    const strobeOn = Math.floor(this.strobeT * B.strobeHz * 2) % 2 === 0;
    const chase = Math.floor(beat * 4) % 4;
    for (let i = 0; i < 4; i++) {
      let on = i === chase ? 0.55 + 0.45 * env : 0;
      if (this.frenzy) on = strobeOn ? 1 : 0;
      if (ledsAll >= 0) on = Math.max(on, ledsAll);
      // write tints only on change: pixi's tint setter allocates even for an unchanged value
      const tint = on > 0.05 ? this.color : LED_OFF;
      if (this.leds[i].tint !== tint) this.leds[i].tint = tint;
      this.leds[i].alpha = 1;
      if (this.ledGlows[i].tint !== this.color) this.ledGlows[i].tint = this.color;
      this.ledGlows[i].alpha = on * 0.9;
    }
    this.crate.y = hop * this.motion;
    this.cable.update(dt);
  }

  destroy(): void {
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    this.view.destroy({ children: true });
  }
}
