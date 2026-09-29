import { gsap } from 'gsap';
import { slotPos } from '../../../board/model';
import type { Position } from '../../../book/types';
import type { LayoutSpec, Pt } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, s, speedScale } from '../../../core/timing';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import type { MascotCue, SfxId } from '../../../game/events';
import { chargeSeconds } from '../drop/DropRun';
import { type Arc, arcAt, byCell, dropArc, newArc } from '../drop/geometry';
import type { DroppedWild } from '../events';
import { BASS_DROP_LAYOUT } from '../layout';
import { grooveBeat } from '../stage/beat';
import { BASS_DROP_TIMING } from '../timing';
import { type MascotDensity, MASCOT_PAGE_BYTES, loadMascotRig, mascotDensity, releaseMascotRig } from './assets';
import { MASCOT_DEFS, MASCOT_TUNING as T } from './defs';
import { type LookTarget, SpineMascot } from './SpineMascot';

const D = BASS_DROP_TIMING.drop;
const O = BASS_DROP_TIMING.orbs;
const FPS = 30;

/**
 * SWAMP FUNK: BASS DROP MASCOTS — Gumbo (left) and Baron Croak (right) as 2D Spine characters
 * (DESIGN §16, ANIMATION_SET §5), replacing the engine's three.js Mascots for this game. Same
 * MascotCue contract; each cue maps to the rigs' clips:
 *
 *   cue              Gumbo                               Croak
 *   idle             release -> idle (idle_bored after ~20 s without a cue, both)
 *   spinStart        lean kick (track 3)                 nod kick
 *   reactSmall       react_small (+reactDelay)           react_small = the scratch, in sync with the booth
 *   reactTumble      alternating react_small / nod kick
 *   meterHeat        meter_heat loop (0 = release)       anticipation loop (hand on the fader)
 *   meterThreshold   react_point at the meter            nod + react_point; react_small from notch 3
 *   bassDropCharge   bass_drop (its f15 = the boom)      bass_drop_charge timescaled to the charge (f14
 *                                                        button_slam, f15 = boom) -> bass_drop, mix 0
 *   bassDrop         blow-back continues (chained: f15)  follow-through (chained: bass_drop)
 *   wildLand         wild_land_react overlay (track 1, additive), both
 *   featureLock      1: react_small, 2: win_big, both
 *   fsTrigger        fs_trigger: cooler slam f36         fs_trigger: mic drop f36 (= trigger pump 3)
 *   featureUpgrade   win_big, cooler slam on the slam    fs_trigger, mic drop on the Mega Mix slam
 *   spotUpgrade      nod kick                            pouch_pump overlay
 *   winBig           win_big -> celebrate (held until the presentation ends)
 *   celebrate        celebrate loop, both look at the player
 *   fsEnd            fs_end, both
 *
 * Look-at (track 3): the best cluster on board:showWins, the exploding cells on board:tumble and
 * the meter while the orbs fly, the meter on the charge / threshold / trigger cues, each flying
 * wild along its arc (drop/geometry, same schedule as DropRun), the landing cell on wildLand, the
 * player while celebrating. The rigs' `sfx` events are broadcast as 'sfx' (cooler_slam,
 * button_slam, mic_drop, dj_scratch); without a live Croak the booth's button_slam is scheduled
 * here at f14 of the charge instead. Off in compact (layout.mascots null: nothing loads or runs).
 * Low tier: half-density atlas and 30 Hz skeleton updates. Everything runs on the game clock
 * (hit-stop freezes the rigs, a slam retimes the one-shots and every scheduled call).
 * QA (DEV): window.__bdMascots = { stats(), cue(cue, intensity?), module }.
 */
export class BassDropMascots implements GameModule {
  private readonly mascots: (SpineMascot | null)[] = MASCOT_DEFS.map(() => null);
  private readonly failed = MASCOT_DEFS.map(() => false);
  private offs: (() => void)[] = [];
  private readonly calls = new Set<gsap.core.Animation>();
  private enabled = false;
  private loading = false;
  private dead = false;
  private orbs = false;
  private turn = 0;
  private readonly arc: Arc = newArc();
  private readonly pt: Pt = { x: 0, y: 0 };

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    grooveBeat.retain();
    this.enabled = this.ctx.layout.mascots !== null;
    // mascots are decoration: a rig that cannot load leaves its side empty, the game plays on
    await this.ensure();
    if (this.dead) return;
    this.layout(this.ctx.layout);
    this.bind();
    this.offs.push(clock.onUpdate(this.tick));
    if (import.meta.env.DEV) {
      window.__bdMascots = {
        stats: () => ({ mascots: this.live().map((m) => m.stats()), textureBytes: this.textureBytes() }),
        cue: (cue: MascotCue, intensity?: number) => this.onCue(cue, intensity ?? 1),
        module: this,
      };
    }
  }

  // =================================================================== loading / layout

  /** Load (or upgrade to the full-density atlas) every character the current layout shows. */
  private async ensure(): Promise<void> {
    const slots = this.ctx.layout.mascots;
    if (!slots || this.loading || this.dead) return;
    this.loading = true;
    try {
      await Promise.all(
        MASCOT_DEFS.map(async (def, i) => {
          if (this.failed[i]) return;
          const need = this.density(i);
          const cur = this.mascots[i];
          if (cur && (cur.ref.density === 'full' || need === 'half')) return;
          const ref = await loadMascotRig(def.id, need);
          if (!ref) {
            if (!cur) this.failed[i] = true;
            return;
          }
          if (this.dead) {
            releaseMascotRig(ref);
            return;
          }
          let m: SpineMascot;
          try {
            m = new SpineMascot(def, ref);
          } catch {
            releaseMascotRig(ref);
            this.failed[i] = true;
            return;
          }
          this.install(i, m);
        }),
      );
    } finally {
      this.loading = false;
    }
  }

  /** Texel density character `i` needs in the current layout. */
  private density(i: number): MascotDensity {
    const def = MASCOT_DEFS[i];
    const r = this.ctx.layout.mascots?.[def.side];
    if (!r) return 'half';
    const k = Math.min(r.w / def.canvas[0], r.h / def.canvas[1]);
    return mascotDensity(this.ctx.scale * this.ctx.app.renderer.resolution * k, this.ctx.tier);
  }

  private install(i: number, m: SpineMascot): void {
    const old = this.mascots[i];
    m.onSfx = (id) => this.sfx(id);
    m.stepHz = this.ctx.tier === 'low' ? T.lowTierHz : 0;
    if (old) {
      m.setBase(old.base);
      this.ctx.layers.mascots.addChildAt(m.view, this.ctx.layers.mascots.getChildIndex(old.view));
      old.destroy();
      releaseMascotRig(old.ref);
    } else this.ctx.layers.mascots.addChild(m.view);
    this.mascots[i] = m;
    if (!this.dead) this.place(this.ctx.layout);
  }

  layout(L: LayoutSpec): void {
    this.enabled = L.mascots !== null;
    this.place(L);
    if (this.enabled) void this.ensure().then(() => this.place(this.ctx.layout));
  }

  /** Contain-fit each 2x canvas into its layout rect, feet (the rig root) on the rect's bottom centre. */
  private place(L: LayoutSpec): void {
    const slots = L.mascots;
    MASCOT_DEFS.forEach((def, i) => {
      const m = this.mascots[i];
      if (!m) return;
      const r = slots?.[def.side];
      m.view.visible = !!r;
      if (!r) return;
      const k = Math.min(r.w / def.canvas[0], r.h / def.canvas[1]);
      m.place({ x: r.x + r.w / 2, y: r.y + r.h }, k);
    });
  }

  private readonly tick = (dt: number): void => {
    if (!this.enabled) return;
    for (const m of this.mascots) if (m?.view.visible) m.update(dt);
  };

  private live(): SpineMascot[] {
    if (!this.enabled) return [];
    return this.mascots.filter((m): m is SpineMascot => !!m && m.view.visible);
  }

  private sfx(id: SfxId): void {
    if (this.enabled) this.ctx.game.broadcast('sfx', { id });
  }

  // =================================================================== events

  private bind(): void {
    const g = this.ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('mascot:cue', ({ cue, intensity, look }) => this.onCue(cue, intensity ?? 1, look)),
      g.on('round:start', () => {
        this.cancel();
        this.orbs = false;
        this.onCue('spinStart');
      }),
      g.on('round:end', () => {
        this.cancel();
        this.releaseHeld();
      }),
      g.on('board:set', () => {
        this.cancel();
        this.releaseHeld();
      }),
      g.on('board:reveal', () => this.releaseHeld()),
      g.on('board:showWins', ({ wins, totalWin }) => {
        const best = wins.reduce((a, b) => (b.win > a.win ? b : a), wins[0]);
        if (best) this.lookAtCells(best.positions, T.look.cluster);
        // a strong tumble win without a big-win screen: win_big (the Board already cued reactSmall)
        if (totalWin >= T.bigWinX * 100) for (const m of this.live()) m.play('win_big');
      }),
      g.on('meter:update', ({ delta }) => {
        if (delta > 0) this.orbs = true;
      }),
      g.on('board:tumble', ({ exploding }) => {
        this.lookAtCells(exploding, T.look.tumble);
        if (!this.orbs) return;
        this.orbs = false;
        // the orbs pop out of the bursting cells and fly to the meter: follow them in
        const b = BASS_DROP_LAYOUT[this.ctx.layout.kind].meter;
        this.after(s(O.popOut + O.flight * 0.35), () => this.lookAll({ x: b.cx, y: b.cy }, T.look.orbs));
      }),
      g.on('wild:drop', (p) => this.onWildDrop(p.wilds, p.chainIndex)),
      g.on('bigwin:show', () => this.onCue('celebrate')),
      g.on('fs:update', () => this.releaseHeld()),
      g.on('win:final', () => this.releaseHeld()),
      g.on('fs:end', () => this.onCue('fsEnd')),
    );
  }

  /** Map a scene cue to per-character clips (DESIGN §16). */
  private onCue(cue: MascotCue, intensity = 1, look?: Pt): void {
    const live = this.live();
    if (!live.length) return;
    const [gumbo, croak] = [this.mascots[0], this.mascots[1]].map((m) => (m && live.includes(m) ? m : null));
    if (look) this.lookAll(look, cue === 'fsTrigger' ? T.look.trigger : cue === 'wildLand' ? T.look.wildLand : T.look.meter);
    for (const m of live) m.poke();
    switch (cue) {
      case 'idle':
        this.releaseHeld();
        break;
      case 'spinStart':
        for (const m of live) {
          m.clearPending();
          m.release();
        }
        gumbo?.kick(T.kick.spinNod * 0.5, T.kick.spinLean);
        croak?.kick(T.kick.spinNod, 0);
        break;
      case 'anticipation':
        this.each((m) => m.setBase('anticipation'));
        break;
      case 'reactSmall':
        this.each((m) => m.play('react_small'));
        break;
      case 'reactTumble': {
        // alternate who cheers so a long tumble chain doesn't look robotic
        const pair = this.turn++ % 2 === 0 ? [croak, gumbo] : [gumbo, croak];
        const [who, other] = pair;
        who?.play('react_small');
        other?.kick(T.kick.nod, 0);
        break;
      }
      case 'meterHeat':
        for (const m of live) {
          if (intensity > 0) m.setBase(m.def.heatClip);
          else if (m.base === m.def.heatClip) m.setBase('idle');
        }
        break;
      case 'meterThreshold': {
        // minor notch, intensity = notch / 6; the booth scratches from notch 3 on (Stage)
        const k = Math.max(0, Math.min(1, intensity));
        this.lookMeter(T.look.meter);
        gumbo?.later(s(gumbo.def.reactDelay), () => gumbo.play('react_point'));
        if (croak) {
          if (k >= 0.5) croak.play('react_small');
          else {
            croak.kick(T.kick.thresholdNod, 0);
            croak.play('react_point');
          }
        }
        break;
      }
      case 'bassDropCharge': {
        // the first drop of a step: f15 of both clips lands on the boom at t = C
        const C = chargeSeconds(0);
        const rate = T.frames.chargeHit / FPS / C;
        this.lookMeter(C + s(D.launchDelay));
        gumbo?.play('bass_drop', { rate, mix: 0.1 });
        croak?.play('bass_drop_charge', { rate, mix: 0.08, next: 'bass_drop' });
        break;
      }
      case 'bassDrop':
        if (gumbo) {
          if (gumbo.current === 'bass_drop') gumbo.normalRate();
          else gumbo.play('bass_drop', { from: T.frames.chargeHit / FPS, mix: 0.08 });
        }
        // a charged drop hands over by itself (mix 0 queue); a chained one follows through now
        if (croak && croak.current !== 'bass_drop_charge' && croak.current !== 'bass_drop') croak.play('bass_drop', { mix: 0.08 });
        break;
      case 'wildLand':
        this.each((m) => m.overlayClip('wild_land_react'));
        break;
      case 'featureLock':
        this.each((m) => m.play(intensity >= 1.5 ? 'win_big' : 'react_small'));
        break;
      case 'fsTrigger':
        // no react delay: both hits land on the meter's third pump (cue + 1.2 s)
        for (const m of live) m.play('fs_trigger');
        break;
      case 'featureUpgrade': {
        // line the hits up with the Mega Mix emblem slam (upgradeSlamAt after the cue)
        const slam = s(T.upgradeSlamAt);
        const sp = speedScale();
        if (gumbo) gumbo.later(Math.max(0, slam - T.frames.coolerSlamWinBig / FPS / sp), () => gumbo.play('win_big'));
        croak?.play('fs_trigger', { from: Math.max(0, T.frames.micDrop / FPS - slam * sp) });
        break;
      }
      case 'spotUpgrade':
        gumbo?.kick(T.kick.nod * Math.max(0.5, Math.min(1, intensity)), 0);
        croak?.overlayClip('pouch_pump');
        break;
      case 'winBig':
        this.each((m) => {
          m.play('win_big');
          m.setBase('celebrate');
        });
        break;
      case 'celebrate':
        for (const m of live) {
          m.setBase('celebrate');
          m.lookAt('player', T.look.player);
        }
        break;
      case 'fsEnd':
        this.each((m) => m.play('fs_end'));
        break;
    }
  }

  /** Run per character after its react delay (game time). */
  private each(fn: (m: SpineMascot) => void): void {
    for (const m of this.live()) m.later(s(m.def.reactDelay), () => fn(m));
  }

  /** Drop held loops (celebrate / heat / bored): the presentation they belonged to is over. */
  private releaseHeld(): void {
    for (const m of this.live()) m.release();
  }

  // =================================================================== look-at

  private lookAll(p: LookTarget, seconds: number): void {
    for (const m of this.live()) m.lookAt(p, seconds);
  }

  private lookMeter(seconds: number): void {
    const b = BASS_DROP_LAYOUT[this.ctx.layout.kind].meter;
    this.lookAll({ x: b.cx, y: b.cy }, seconds);
  }

  private lookAtCells(positions: readonly Position[], seconds: number): void {
    if (!positions.length) return;
    const L = this.ctx.layout;
    let x = 0;
    let y = 0;
    for (const p of positions) {
      const c = slotPos(L, p.reel, p.row);
      x += c.x;
      y += c.y;
    }
    this.lookAll({ x: x / positions.length, y: y / positions.length }, seconds);
  }

  /**
   * DropRun's flight schedule (DESIGN §8.1/§8.2): launch i at C + launchDelay + i x stagger,
   * `flight` long along dropArc (linear progress). Both heads follow each wild in turn. Without
   * a live Croak, the booth's button_slam comes from here (f14 of the 15 f press).
   */
  private onWildDrop(wilds: readonly DroppedWild[], chainIndex: number): void {
    const C = chargeSeconds(chainIndex);
    if (chainIndex <= 0 && !this.mascots[1]?.view.visible && BASS_DROP_LAYOUT[this.ctx.layout.kind].booth) {
      this.after((C * 14) / 15, () => this.ctx.game.broadcast('sfx', { id: 'button_slam' }));
    }
    if (!this.live().length) return;
    const sorted = [...wilds].sort(byCell);
    const launch0 = C + s(D.launchDelay);
    const flight = s(D.flight);
    const rm = reducedMotion();
    sorted.forEach((w, i) => {
      const t0 = launch0 + i * s(D.launchStagger);
      if (rm) {
        this.after(t0, () => this.lookAtCells([w], flight + 0.3));
        return;
      }
      const f = { u: 0 };
      const tw = followSpeed(
        gsap.to(f, {
          u: 1,
          duration: flight,
          delay: t0,
          ease: 'none',
          onUpdate: () => {
            const L = this.ctx.layout;
            arcAt(dropArc(L, w.reel, w.row, this.arc), f.u, this.pt);
            this.lookAll(this.pt, 0.3);
          },
          onComplete: () => this.calls.delete(tw),
        }),
      );
      this.calls.add(tw);
    });
  }

  /** Game-clock call `sec` (already s()-scaled) from now; a slam retimes it (followSpeed). */
  private after(sec: number, fn: () => void): void {
    const call = followSpeed(
      gsap.delayedCall(sec, () => {
        this.calls.delete(call);
        fn();
      }),
    );
    this.calls.add(call);
  }

  private cancel(): void {
    for (const c of this.calls) c.kill();
    this.calls.clear();
  }

  private textureBytes(): number {
    let n = 0;
    for (const m of this.mascots) if (m) n += MASCOT_PAGE_BYTES[m.def.id][m.ref.density];
    return n;
  }

  destroy(): void {
    this.dead = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.cancel();
    this.mascots.forEach((m, i) => {
      if (!m) return;
      m.destroy();
      releaseMascotRig(m.ref);
      this.mascots[i] = null;
    });
    grooveBeat.release();
    if (import.meta.env.DEV) delete window.__bdMascots;
  }
}

declare global {
  interface Window {
    /** DEV only: Bass Drop 2D mascot handles for QA / capture scripts. */
    __bdMascots?: {
      stats: () => { mascots: Record<string, unknown>[]; textureBytes: number };
      cue: (cue: MascotCue, intensity?: number) => void;
      module: BassDropMascots;
    };
  }
}
