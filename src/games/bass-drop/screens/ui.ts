import { gsap } from 'gsap';
import { BitmapText, Container, Sprite, Texture } from 'pixi.js';
import { uiBus } from '../../../ui/bus';
import { buttonPlate, checkBox } from './art/chrome';
import { screenArt, useBaked } from './art/ScreenArt';
import { SCR_LABEL, SCR_NUM, fitText } from './fonts';

/**
 * Shared interactive pieces of the canvas screens (UI time: hover / press never scale with
 * the speed profile). Each is one Container with play-style methods so the Spine UI rigs can
 * take them over (`btn_N` hover / pressed / disabled attachments, `txt_press` press_loop).
 */

export interface ButtonColors {
  fill: number;
  light: number;
  shade: number;
  /** label tint */
  text: number;
}

export const BUTTON_PINK: ButtonColors = { fill: 0xf828c8, light: 0xff8ae6, shade: 0xa3127f, text: 0xffffff };
export const BUTTON_GLASS: ButtonColors = { fill: 0x2a1d4a, light: 0x44356e, shade: 0x160d2a, text: 0xe8e0ff };
const BUTTON_OFF: ButtonColors = { fill: 0x4a4466, light: 0x5e5880, shade: 0x2c2840, text: 0x9a94b4 };

/**
 * Plate button with a live label: hover lift (1.04), press squash (0.92, 4 f), disabled grey.
 * The plate is baked per size / colour set; `relayout` re-bakes for a new size or resolution.
 */
export class ScreenButton extends Container {
  private readonly plate = new Sprite();
  private readonly label: BitmapText;
  private readonly inner = new Container();
  private enabled = true;
  private hovered = false;
  private tween: gsap.core.Tween | null = null;
  private w = 0;
  private h = 0;
  private res = 1;

  constructor(
    private readonly colors: ButtonColors,
    private readonly onTap: () => void,
    private readonly timing: { hover: number; press: number; pressScale: number },
  ) {
    super({ label: 'screenButton' });
    this.label = new BitmapText({ text: '', style: { fontFamily: SCR_NUM, fontSize: 40 }, anchor: 0.5 });
    this.inner.addChild(this.plate, this.label);
    this.addChild(this.inner);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => this.hover(true));
    this.on('pointerout', () => this.hover(false));
    this.on('pointertap', () => this.tap());
  }

  relayout(w: number, h: number, res: number): void {
    this.w = w;
    this.h = h;
    this.res = res;
    this.hitArea = { contains: (x: number, y: number) => Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2 };
    this.paint();
  }

  setText(text: string): void {
    this.label.text = text;
    this.fitLabel();
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.cursor = on ? 'pointer' : 'default';
    if (!on) this.hover(false);
    this.paint();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private paint(): void {
    if (!this.w) return;
    const c = this.enabled ? this.colors : BUTTON_OFF;
    const key = `btn:${this.w}x${this.h}:${c.fill}`;
    useBaked(this.plate, screenArt.get(key, this.res, () => buttonPlate(this.w, this.h, c.fill, c.light, c.shade)));
    this.label.tint = c.text;
    this.fitLabel();
  }

  private fitLabel(): void {
    if (!this.h) return;
    this.label.style.fontSize = Math.round(this.h * 0.44);
    this.label.y = -this.h * 0.04;
    fitText(this.label, this.w * 0.78);
  }

  private hover(on: boolean): void {
    if (on === this.hovered || (on && !this.enabled)) return;
    this.hovered = on;
    this.tween?.kill();
    const s = on ? 1.04 : 1;
    this.tween = gsap.to(this.inner.scale, { x: s, y: s, duration: this.timing.hover / 1000, ease: 'power2.out' });
  }

  private tap(): void {
    if (!this.enabled) return;
    this.tween?.kill();
    const back = this.hovered ? 1.04 : 1;
    const p = this.timing.pressScale;
    this.tween = gsap.fromTo(
      this.inner.scale,
      { x: p, y: p },
      { x: back, y: back, duration: (this.timing.press * 2) / 1000, ease: 'back.out(3)' },
    );
    this.onTap();
  }

  /** Back to rest (screen closed / re-opened). */
  reset(): void {
    this.tween?.kill();
    this.hovered = false;
    this.inner.scale.set(1);
  }

  override destroy(): void {
    this.tween?.kill();
    super.destroy({ children: true });
  }
}

/**
 * Pulsing prompt ("PRESS TO CONTINUE" / "TAP TO START"): alpha 0.55 <-> 1.0 and scale 1.0 <->
 * 1.04 at 1 Hz (ANIMATION_SET press_loop). Driven by an elapsed time the owner advances, so it
 * follows whichever clock the screen runs on.
 */
export class PressPrompt extends Container {
  readonly text: BitmapText;
  private t = 0;
  private running = false;

  constructor(size: number, tint = 0xffffff, private period = 1000) {
    super({ label: 'pressPrompt' });
    this.text = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: size }, anchor: 0.5 });
    this.text.tint = tint;
    this.addChild(this.text);
  }

  start(): void {
    this.running = true;
    this.t = 0;
  }

  stop(): void {
    this.running = false;
    this.text.alpha = 1;
    this.text.scale.set(1);
  }

  /** Advance by dt seconds. */
  tick(dt: number): void {
    if (!this.running) return;
    this.t += dt;
    const u = 0.5 - 0.5 * Math.cos((this.t * 1000 * Math.PI * 2) / this.period);
    this.text.alpha = 0.55 + 0.45 * u;
    this.text.scale.set(1 + 0.04 * u);
  }
}

/** "Don't show again" checkbox + label; tapping flips it. */
export class Toggle extends Container {
  private readonly box = new Sprite();
  readonly text: BitmapText;
  private checked = false;
  private size = 30;
  private res = 1;

  constructor(
    private readonly accent: number,
    private readonly onChange: (checked: boolean) => void,
  ) {
    super({ label: 'toggle' });
    this.text = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: 28 }, anchor: { x: 0, y: 0.5 } });
    this.text.tint = 0xe8e0ff;
    this.addChild(this.box, this.text);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      this.set(!this.checked);
      this.onChange(this.checked);
    });
  }

  relayout(size: number, res: number): void {
    this.size = size;
    this.res = res;
    this.text.style.fontSize = Math.round(size * 0.92);
    this.text.x = size * 0.5 + size * 0.4;
    this.box.x = 0;
    this.paint();
    const w = this.text.x + this.text.width;
    this.hitArea = { contains: (x: number, y: number) => x >= -size * 0.6 && x <= w + 8 && Math.abs(y) <= size * 0.8 };
  }

  set(on: boolean): void {
    this.checked = on;
    this.paint();
  }

  private paint(): void {
    const key = `check:${this.size}:${this.checked ? 1 : 0}:${this.accent}`;
    useBaked(this.box, screenArt.get(key, this.res, () => checkBox(this.size, this.checked, this.accent)));
  }
}

/**
 * Full-screen transparent tap catcher (sits above the stage dimmer, below the content), so a
 * screen gets taps even where OverlayStage would drop them (jurisdiction disabledSlamstop only
 * forbids skipping animations, not closing a menu-like screen).
 */
export class TapCatcher extends Sprite {
  handler: (() => void) | null = null;

  constructor() {
    super({ texture: Texture.WHITE, alpha: 0 });
    this.label = 'tapCatcher';
    this.eventMode = 'static';
    this.on('pointertap', () => this.handler?.());
  }

  cover(x: number, y: number, w: number, h: number): void {
    this.position.set(x, y);
    this.width = w;
    this.height = h;
  }
}

/**
 * uiBus 'modal:state' share of one canvas screen: open() blocks the HUD hotkeys, close()
 * hands back whatever the DOM overlay says. A DOM modal that closes while this screen is
 * still open does not unblock the HUD (the gate re-asserts its own 'open').
 */
export class ModalGate {
  private mine = false;
  private domOpen = false;
  private sending = false;
  private readonly off: () => void;

  constructor() {
    this.off = uiBus.on('modal:state', ({ open }) => {
      if (this.sending) return;
      this.domOpen = open;
      if (!open && this.mine) this.send(true);
    });
  }

  get isOpen(): boolean {
    return this.mine;
  }

  open(): void {
    if (this.mine) return;
    this.mine = true;
    this.send(true);
  }

  close(): void {
    if (!this.mine) return;
    this.mine = false;
    this.send(this.domOpen);
  }

  private send(open: boolean): void {
    this.sending = true;
    try {
      uiBus.broadcast('modal:state', { open });
    } finally {
      this.sending = false;
    }
  }

  destroy(): void {
    this.close();
    this.off();
  }
}

/** Keys a screen reacts to while it is open (the HUD ignores them under modal:state). */
export const onScreenKey = (fn: (key: 'confirm' | 'escape') => void): (() => void) => {
  const handler = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body && el.closest('#ui-root')) return;
    if (e.code === 'Escape') fn('escape');
    else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      fn('confirm');
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
};
