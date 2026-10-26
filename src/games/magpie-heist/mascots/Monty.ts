import { Container, Sprite } from 'pixi.js';
import { slotPos } from '../../../board/model';
import type { Position } from '../../../book/types';
import type { LayoutSpec, Pt } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { s } from '../../../core/timing';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import type { MascotCue } from '../../../game/events';
import { glowTexture } from '../scene/textures';
import { loadMontyRig, montyDensity, releaseMontyRig } from './assets';
import { MontyStatic } from './MontyStatic';
import { MONTY_CANVAS, MONTY_TUNING as T, type LookTarget, SpineMonty } from './SpineMonty';

/** one-shot reaction delay (ms) so he never moves in lockstep with the board's own pop */
const REACT_DELAY = 90;

/**
 * MONTY — the magpie cat burglar beside the reels (layout.mascots.left; none in compact), a 2D Spine
 * character (chr_monty, art/source/magpie-heist/mascot, tools/mhart/mascot/build.sh). The rig's 2x canvas
 * (880x1448) is contain-fitted into the rect with its feet (the rig root) on the rect's bottom centre.
 * Same MascotCue contract as the engine mascots; each cue maps to a clip:
 *
 *   cue / event        clip (track 0 unless noted)
 *   round:start        spin_start (tugs his cap); held loops released
 *   idle               release -> idle (idle_bored, one routine, after ~18 s without a cue)
 *   anticipation       anticipation loop (leans in rubbing his gloves), looks at the board; released by the
 *                      next reveal / showWins / round end
 *   reactSmall         react_small (snap + finger gun at the board)
 *   reactTumble        react_tumble (wing pump), every other tumble a nod kick instead; a nest collect looks at it
 *   winBig             win_big (leap, wings up, cap twirl) -> celebrate held until the presentation ends
 *   celebrate          celebrate loop (points at the board, fist pumps); the Shooting Star: looks at the star,
 *                      the big-win screen: looks at the player
 *   fsTrigger          fs_trigger (the big leap) ; featureUpgrade: feature_upgrade (rub + double finger guns)
 *   fsEnd              fs_end (the gentleman thief's bow) ; spotUpgrade: nod kick ; featureLock: react_small / win_big
 *
 * Track 2: blink every 3-6 s (seeded). Track 3: look-at (resting aim at the board centre, focus on the best
 * cluster, the Shooting Star, a collecting nest). The rig's foley (snap, whoosh, landings) is broadcast as
 * 'sfx'. Low tier: half-density atlas and 30 Hz skeleton updates. If the rig cannot load, the static
 * stand-in (./MontyStatic.ts) plays instead. Game clock only (hit-stop freezes him, a slam retimes clips).
 * QA (DEV): window.__mhMonty = { stats(), cue(cue, intensity?), module }.
 */
export class Monty implements GameModule {
  private readonly root = new Container({ label: 'monty' });
  private readonly shadow = new Sprite({ anchor: 0.5, tint: 0x000000, alpha: 0.35 });
  private rig: SpineMonty | null = null;
  private fallback: MontyStatic | null = null;
  private failed = false;
  private loading = false;
  private dead = false;
  private enabled = false;
  private turn = 0;
  /** game time (s), and when the Shooting Star last fired (its celebrate looks at the star, not the player) */
  private now = 0;
  private starAt = -10;
  private offs: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    this.shadow.texture = glowTexture();
    this.root.addChild(this.shadow);
    ctx.layers.mascots.addChild(this.root);
    this.enabled = !!ctx.layout.mascots?.left;
    await this.ensure();
    if (this.dead || this.fallback) return;
    this.layout(ctx.layout);
    this.bind();
    this.offs.push(clock.onUpdate(this.tick));
    if (import.meta.env.DEV) {
      window.__mhMonty = {
        stats: () => ({ ...(this.rig?.stats() ?? { rig: null }), enabled: this.enabled }),
        cue: (cue: MascotCue, intensity?: number) => this.onCue(cue, intensity ?? 1),
        module: this,
      };
    }
  }

  // =================================================================== loading / layout

  /** Load the rig (or upgrade it to the full-density atlas) when the layout shows Monty. */
  private async ensure(): Promise<void> {
    if (!this.enabled || this.loading || this.dead || this.failed) return;
    const need = this.density();
    const cur = this.rig;
    if (cur && (cur.ref.density === 'full' || need === 'half')) return;
    this.loading = true;
    try {
      const ref = await loadMontyRig(need);
      if (!ref) {
        if (!cur) await this.useFallback();
        return;
      }
      if (this.dead) {
        releaseMontyRig(ref);
        return;
      }
      let m: SpineMonty;
      try {
        m = new SpineMonty(ref);
      } catch {
        releaseMontyRig(ref);
        if (!cur) await this.useFallback();
        return;
      }
      m.onSfx = (id, volume) => {
        if (this.enabled) this.ctx.game.broadcast('sfx', { id, volume });
      };
      m.stepHz = this.ctx.tier === 'low' ? T.lowTierHz : 0;
      if (cur) {
        m.setBase(cur.base);
        cur.destroy();
        releaseMontyRig(cur.ref);
      }
      this.root.addChild(m.view);
      this.rig = m;
      this.place(this.ctx.layout);
    } finally {
      this.loading = false;
    }
  }

  /** The rig could not be loaded or built: the static cut-out with code acting takes over. */
  private async useFallback(): Promise<void> {
    this.failed = true;
    if (this.dead || this.fallback) return;
    this.root.visible = false;
    this.fallback = new MontyStatic(this.ctx);
    await this.fallback.init();
  }

  /** Texel density the current layout needs. */
  private density(): 'full' | 'half' {
    const r = this.ctx.layout.mascots?.left;
    if (!r) return 'half';
    const k = Math.min(r.w / MONTY_CANVAS[0], r.h / MONTY_CANVAS[1]);
    return montyDensity(this.ctx.scale * this.ctx.app.renderer.resolution * k, this.ctx.tier);
  }

  layout(L: LayoutSpec): void {
    if (this.fallback) return; // it follows layout:change itself
    this.enabled = !!L.mascots?.left;
    this.place(L);
    if (this.enabled) void this.ensure();
  }

  /** Contain-fit the 2x canvas into layout.mascots.left, feet (the rig root) on the rect's bottom centre. */
  private place(L: LayoutSpec): void {
    const r = L.mascots?.left;
    this.root.visible = !!r && !!this.rig;
    const m = this.rig;
    if (!r || !m) return;
    const k = Math.min(r.w / MONTY_CANVAS[0], r.h / MONTY_CANVAS[1]);
    m.place({ x: r.x + r.w / 2, y: r.y + r.h }, k);
    m.restTarget = { x: L.center.x, y: L.center.y };
    this.shadow.position.set(r.x + r.w / 2, r.y + r.h - 4 * k);
    this.shadow.scale.set((560 * k) / 256, (110 * k) / 256);
  }

  private readonly tick = (dt: number): void => {
    const m = this.rig;
    if (!this.enabled || !m || !this.root.visible) return;
    this.now += dt;
    m.update(dt);
    // the shadow shrinks and fades while he is in the air
    const air = Math.min(1, m.airborne / 260);
    const k = m.k;
    this.shadow.alpha = 0.35 * (1 - 0.6 * air);
    this.shadow.scale.set(((560 * k) / 256) * (1 - 0.35 * air), ((110 * k) / 256) * (1 - 0.35 * air));
  };

  private live(): SpineMonty | null {
    return this.enabled && this.root.visible ? this.rig : null;
  }

  // =================================================================== events

  private bind(): void {
    const g = this.ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('mascot:cue', ({ cue, intensity, look }) => this.onCue(cue, intensity ?? 1, look)),
      g.on('round:start', () => this.onCue('spinStart')),
      g.on('round:end', () => this.releaseHeld()),
      g.on('board:set', () => this.releaseHeld()),
      g.on('board:reveal', () => {
        const m = this.live();
        if (m?.base === 'anticipation') m.release();
      }),
      g.on('board:showWins', ({ wins }) => {
        const m = this.live();
        if (m?.base === 'anticipation') m.release();
        const best = wins.reduce((a, b) => (b.win > a.win ? b : a), wins[0]);
        if (best) this.lookAtCells(best.positions, T.look.cluster);
      }),
      g.on('star:activate', ({ stars }) => {
        this.starAt = this.now;
        this.lookAtCells(stars.slice(0, 1), T.look.star);
      }),
      g.on('loot:collect', (p) => this.lookAtCells([p], T.look.nest)),
      g.on('win:final', () => this.releaseHeld()),
      g.on('fs:update', () => this.releaseHeld()),
    );
  }

  /** Map a scene cue to a clip. */
  private onCue(cue: MascotCue, intensity = 1, look?: Pt): void {
    const m = this.live();
    if (!m) return;
    if (look) m.lookAt(look, T.look.trigger);
    m.poke();
    const rm = reducedMotion();
    switch (cue) {
      case 'idle':
        this.releaseHeld();
        break;
      case 'spinStart':
        m.clearPending();
        m.release();
        // every spin: a quick cap tug (a small lean kick when motion is reduced or a clip is still running)
        if (rm || m.busy) m.kick(T.kick.nod * 0.4, T.kick.lean);
        else m.play('spin_start');
        break;
      case 'anticipation':
        m.setBase('anticipation');
        if (m.restTarget) m.lookAt(m.restTarget, 3);
        break;
      case 'reactSmall':
        this.react(() => m.play('react_small'));
        break;
      case 'reactTumble':
        // alternate the wing pump with a nod so a long tumble chain never loops the same reaction
        if (this.turn++ % 2 === 0 && !m.busy) this.react(() => m.play('react_tumble'));
        else m.kick(T.kick.nod, 0);
        break;
      case 'winBig':
        this.react(() => {
          m.play('win_big');
          m.setBase('celebrate');
        });
        break;
      case 'celebrate':
        m.setBase('celebrate');
        // the Shooting Star's celebrate (Glint, same tick as star:activate) keeps looking at the star; the
        // big-win screen's looks at the player
        m.later(0.05, () => {
          if (this.now - this.starAt > 0.5) m.lookAt('player', T.look.player);
        });
        break;
      case 'fsTrigger':
        m.play('fs_trigger');
        break;
      case 'featureUpgrade':
        m.play('feature_upgrade');
        break;
      case 'featureLock':
        this.react(() => m.play(intensity >= 1.5 ? 'win_big' : 'react_small'));
        break;
      case 'fsEnd':
        m.play('fs_end');
        break;
      case 'spotUpgrade':
        m.kick(T.kick.nod * Math.max(0.5, Math.min(1, intensity)), 0);
        break;
      default:
        break;
    }
  }

  private react(fn: () => void): void {
    this.live()?.later(s(REACT_DELAY), fn);
  }

  /** Drop held loops (celebrate / anticipation / bored): the presentation they belonged to is over. */
  private releaseHeld(): void {
    this.live()?.release();
  }

  private lookAtCells(positions: readonly Position[], seconds: number): void {
    const m = this.live();
    if (!m || !positions.length) return;
    const L = this.ctx.layout;
    let x = 0;
    let y = 0;
    for (const p of positions) {
      const c = slotPos(L, p.reel, p.row);
      x += c.x;
      y += c.y;
    }
    const target: LookTarget = { x: x / positions.length, y: y / positions.length };
    m.lookAt(target, seconds);
  }

  destroy(): void {
    this.dead = true;
    for (const off of this.offs) off();
    this.offs = [];
    if (this.rig) {
      this.rig.destroy();
      releaseMontyRig(this.rig.ref);
      this.rig = null;
    }
    this.fallback?.destroy();
    this.fallback = null;
    this.root.destroy({ children: true });
    if (import.meta.env.DEV) delete window.__mhMonty;
  }
}

declare global {
  interface Window {
    /** DEV only: Magpie Heist mascot handle for QA / capture scripts. */
    __mhMonty?: {
      stats: () => Record<string, unknown>;
      cue: (cue: MascotCue, intensity?: number) => void;
      module: Monty;
    };
  }
}
