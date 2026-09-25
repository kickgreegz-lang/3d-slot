import { Container, MeshRope, Point, Sprite } from 'pixi.js';
import { speedScale } from '../../../core/timing';
import type { GameContext } from '../../../game/context';
import { createSymbolView } from '../../../symbols/createSymbolView';
import type { SymbolView } from '../../../symbols/types';
import type { DropArt } from './art';
import { clipMs, DROP_LOOK as LOOK, W_CLIPS } from './look';

type ProxyClip = 'drop_launch' | 'drop_fall';

/**
 * The flying wild of a bass drop (DESIGN.md §8.1 / §8.2): a pooled W symbol view on the
 * drop's winLayer holder, an additive glow flare and the `fx_wild_trail` ribbon (a 12-point
 * MeshRope, tier-tinted, laid along the last stretch of the flight path by the controller). The flight controller owns the path, depth scale and spin (they
 * are runtime-owned, ANIMATION_SET §2.6); this class plays the body clips on top:
 *   drop_launch (8 f)  f0 compressed sy 0.8 / sx 1.15, f2 released sy 1.25 / sx 0.86, glow flare 1.4;
 *   drop_fall (12 f)   stretch pulses sy 1.10 <-> 1.14 along the body axis (loop).
 * When the W Spine rig lands, `sym` plays those clips itself and the procedural keys go.
 */
export class WildProxy {
  readonly view = new Container({ label: 'wildProxy' });
  /** trail ribbon, a sibling drawn under the proxy (root space, it does not spin) */
  readonly trail: MeshRope;
  private readonly body = new Container({ label: 'proxyBody' });
  private readonly glow: Sprite;
  private readonly sym: SymbolView;
  private readonly points: Point[] = [];
  /** world-space trail points, [x0, y0, x1, y1, ...], tail first (written by the flight) */
  private readonly hist = new Float32Array(LOOK.trailPoints * 2);
  private readonly texH: number;
  private clip: ProxyClip = 'drop_fall';
  /** clip time (ms, game time scaled by the speed profile) */
  private t = 0;
  private scaleNow = 1;
  private angle = 0;
  busy = false;

  constructor(
    private readonly ctx: GameContext,
    art: DropArt,
  ) {
    this.sym = createSymbolView(ctx, 'W');
    // a static rig: no idle breath / shaders while pooled
    this.sym.reset();
    this.glow = new Sprite({ texture: art.tex.glow, anchor: 0.5, blendMode: 'add', alpha: 0 });
    this.body.addChild(this.sym.view);
    this.view.addChild(this.glow, this.body);
    for (let i = 0; i < LOOK.trailPoints; i++) this.points.push(new Point());
    this.trail = new MeshRope({ texture: art.tex.trail, points: this.points });
    this.trail.blendMode = 'add';
    this.texH = art.tex.trail.height;
    this.view.visible = false;
    this.trail.visible = false;
  }

  /** Take off at (x, y): the trail collapses onto the start point, the launch clip plays. */
  begin(x: number, y: number, tint: number): void {
    this.busy = true;
    this.sym.reset();
    this.view.visible = true;
    this.trail.visible = true;
    this.trail.tint = tint;
    this.trail.alpha = 0;
    this.glow.tint = tint;
    for (let i = 0; i < this.hist.length; i += 2) {
      this.hist[i] = x;
      this.hist[i + 1] = y;
    }
    this.place(x, y, 0.001, 0);
    this.play('drop_launch');
  }

  play(clip: ProxyClip): void {
    this.clip = clip;
    this.t = 0;
  }

  /** Path sample from the flight controller: centre, depth scale, spin (radians). */
  place(x: number, y: number, scale: number, angle: number): void {
    this.view.position.set(x, y);
    this.scaleNow = scale;
    this.angle = angle;
    this.view.rotation = angle;
  }

  /** Per frame (game dt, seconds): body clip keys, glow, trail history. */
  update(dt: number): void {
    if (!this.busy) return;
    this.t += dt * 1000 * speedScale();
    let sx = 1;
    let sy = 1;
    let flare = 0;
    if (this.clip === 'drop_launch') {
      const f = this.t / clipMs(1);
      if (f < 2) {
        // f0 compressed -> f2 released
        const u = f / 2;
        sy = 0.8 + (1.25 - 0.8) * u;
        sx = 1.15 + (0.86 - 1.15) * u;
      } else {
        // f2 -> f8 relax toward the drop_fall pose
        const u = Math.min(1, (f - 2) / (W_CLIPS.drop_launch - 2));
        sy = 1.25 + (1.12 - 1.25) * u;
        sx = 0.86 + (0.94 - 0.86) * u;
      }
      flare = f < 2 ? 1.4 * (f / 2) : 1.4 - 0.5 * Math.min(1, (f - 2) / 6);
      if (f >= W_CLIPS.drop_launch) this.play('drop_fall');
    } else {
      const ph = (this.t / clipMs(W_CLIPS.drop_fall)) * Math.PI * 2;
      sy = 1.12 + 0.02 * Math.sin(ph);
      sx = 1 / Math.sqrt(sy);
      flare = 0.9 + 0.1 * Math.sin(ph * 2);
    }
    const k = this.scaleNow;
    this.body.scale.set(sx, sy);
    this.view.scale.set(k);
    const cell = this.ctx.layout.cell;
    this.glow.width = cell * LOOK.proxyGlow;
    this.glow.height = cell * LOOK.proxyGlow;
    this.glow.alpha = Math.min(1, flare) * 0.55;
    this.glow.rotation = -this.angle;

    // trail: the flight writes the ribbon's world points (trailAt); the rope is drawn in
    // (x / sc) space so its texture height maps to a width that follows the depth scale
    const h = this.hist;
    const sc = (cell * LOOK.trailWidth * k) / this.texH;
    this.trail.scale.set(sc);
    const pts = this.points;
    for (let i = 0; i < pts.length; i++) pts[i].set(h[i * 2] / sc, h[i * 2 + 1] / sc);
    this.trail.alpha = Math.min(1, this.trail.alpha + dt * 8);
  }

  /** World point `i` of the trail ribbon (0 = tail ... trailPoints - 1 = head), from the flight path. */
  trailAt(i: number, x: number, y: number): void {
    this.hist[i * 2] = x;
    this.hist[i * 2 + 1] = y;
  }

  /** Hide on the placement frame (the Board's W takes the cell). */
  end(): void {
    this.busy = false;
    this.view.visible = false;
    this.trail.visible = false;
    this.sym.reset();
  }

  destroy(): void {
    this.sym.destroy();
    this.trail.destroy();
    this.view.destroy({ children: true });
  }
}
