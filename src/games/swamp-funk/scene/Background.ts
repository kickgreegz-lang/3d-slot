import { gsap } from 'gsap';
import { Container, Rectangle, Sprite, type Texture } from 'pixi.js';
import type { GameType } from '../../../book/types';
import type { LayoutKind, LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import type { GameContext, GameModule } from '../../../game/context';
import { BgFx } from './background/BgFx';
import { paintScene } from './background/paint';
import { BASE_PALETTE, type Composition, FS_PALETTE, composeFor } from './background/theme';

/**
 * Environment: neon bayou juke joint at night (owns ctx.layers.background + bgFx).
 *
 * Static scene is painted procedurally per layout kind and BAKED to one texture per
 * mode (base / free spins) — production art from the manifest (env keys
 * bg_landscape / bg_portrait / bg_fs_*) replaces it when present. Both layers are
 * cover-scaled by render/layout.ts in the layout's design space, so the scene is
 * authored in design px with a small bleed. Free spins crossfade to a hotter
 * magenta/crimson grade on 'mode:change'.
 */
const LOCAL_TIMING = {
  /** base <-> free-spins background crossfade (ms, UI-time: not speed-scaled) */
  modeCrossfade: 1400,
};
const BLEED = 24;

export class Background implements GameModule {
  private root = new Container({ label: 'bg' });
  private baseSprite = new Sprite();
  private fsSprite = new Sprite();
  private fx: BgFx | null = null;
  private owned: Texture[] = [];
  private kind: LayoutKind | null = null;
  private res = 0;
  private heat = { v: 0 };
  private mode: GameType = 'basegame';
  private offTick: (() => void) | null = null;

  constructor(private ctx: GameContext) {
    this.fsSprite.alpha = 0;
    this.root.addChild(this.baseSprite, this.fsSprite);
    ctx.game.on('layout:change', ({ layout }) => this.layout(layout));
    ctx.game.on('mode:change', ({ gameType }) => this.setMode(gameType));
  }

  init(): void {
    this.ctx.layers.background.addChild(this.root);
    this.layout(this.ctx.layout);
    this.offTick = clock.onUpdate((dt) => this.fx?.update(dt));
  }

  /** Rebuild when the layout kind changes or the needed bake resolution grows. */
  layout(L: LayoutSpec): void {
    const res = this.bakeResolution(L);
    if (L.kind === this.kind && res <= this.res + 0.01) return;
    this.kind = L.kind;
    this.res = res;
    this.rebuild(L);
  }

  private bakeResolution(L: LayoutSpec): number {
    const { app, tier } = this.ctx;
    const cover = Math.max(app.screen.width / L.width, app.screen.height / L.height);
    const cap = tier === 'low' ? 1 : 1.5;
    // background is intentionally soft; never bake above what the screen shows
    return Math.min(cap, Math.max(0.5, Math.ceil(cover * app.renderer.resolution * 4) / 4));
  }

  private rebuild(L: LayoutSpec): void {
    for (const t of this.owned) t.destroy(true);
    this.owned.length = 0;
    this.fx?.destroy();
    this.fx = null;

    const comp = composeFor(L);
    const portrait = L.kind === 'portrait';
    for (const [sprite, key, hot] of [
      [this.baseSprite, portrait ? 'bg_portrait' : 'bg_landscape', false],
      [this.fsSprite, portrait ? 'bg_fs_portrait' : 'bg_fs_landscape', true],
    ] as const) {
      const prod = this.ctx.art.env(key);
      sprite.texture = prod ?? this.bakeScene(comp, hot);
      sprite.anchor.set(0.5);
      sprite.position.set(L.width / 2, L.height / 2);
      // baked scenes are in scene units; production art is cover-fitted (+bleed)
      sprite.scale.set(
        prod ? Math.max((L.width + BLEED * 2) / prod.width, (L.height + BLEED * 2) / prod.height) : comp.scale,
      );
    }

    this.fx = new BgFx(this.ctx, comp, BASE_PALETTE, FS_PALETTE);
    this.fx.setHeat(this.heat.v);
    this.ctx.layers.bgFx.removeChildren();
    this.ctx.layers.bgFx.addChild(this.fx.view);
  }

  private bakeScene(comp: Composition, hot: boolean): Texture {
    const scene = paintScene(comp, hot ? FS_PALETTE : BASE_PALETTE, this.ctx.art.particle('glow'));
    const holder = new Container();
    holder.addChild(scene);
    const tex = this.ctx.app.renderer.generateTexture({
      target: holder,
      frame: new Rectangle(-BLEED, -BLEED, comp.W + BLEED * 2, comp.H + BLEED * 2),
      resolution: this.res * comp.scale,
    });
    holder.destroy({ children: true });
    this.owned.push(tex);
    return tex;
  }

  private setMode(gameType: GameType): void {
    if (gameType === this.mode) return;
    this.mode = gameType;
    const to = gameType === 'freegame' ? 1 : 0;
    gsap.killTweensOf(this.heat);
    gsap.to(this.heat, {
      v: to,
      duration: LOCAL_TIMING.modeCrossfade / 1000,
      ease: 'sine.inOut',
      onUpdate: () => {
        this.fsSprite.alpha = this.heat.v;
        this.fx?.setHeat(this.heat.v);
      },
    });
  }

  destroy(): void {
    this.offTick?.();
    gsap.killTweensOf(this.heat);
    this.fx?.destroy();
    this.root.destroy({ children: true });
    for (const t of this.owned) t.destroy(true);
  }
}
