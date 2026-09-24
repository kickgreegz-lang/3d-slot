import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CustomBounce } from 'gsap/CustomBounce';
import { CustomWiggle } from 'gsap/CustomWiggle';
import { PixiPlugin } from 'gsap/PixiPlugin';
import * as PIXI from 'pixi.js';
import { createArt } from './assets/loader';
import { loadFonts } from './assets/fonts';
import { Board } from './board/Board';
import { clock } from './core/clock';
import { installDevHooks } from './dev/hooks';
import { detectTier, TIER_BUDGETS } from './env/tier';
import { parseUrl } from './env/url';
import { configureI18n } from './i18n';
import { createMoney } from './money/format';
import { FlowController } from './flow/controller';
import { Fx } from './fx/Fx';
import { type GameContext, type GameModule, createEmitters } from './game/context';
import { LANDSCAPE } from './config/layout';
import { Mascots } from './mascots/Mascots';
import { BigWin } from './present/BigWin';
import { FreeSpins } from './present/FreeSpins';
import { WinPresenter } from './present/WinPresenter';
import { createApp } from './render/app';
import { createLayers } from './render/layers';
import { LayoutManager } from './render/layout';
import { Background } from './scene/Background';
import { Frame } from './scene/Frame';
import { Sound } from './audio/Sound';
import { Hud } from './ui/hud/Hud';
import { DomUi } from './ui/dom/DomUi';

gsap.registerPlugin(CustomEase, CustomBounce, CustomWiggle, PixiPlugin);
PixiPlugin.registerPIXI(PIXI);

const boot = async (): Promise<void> => {
  const params = parseUrl();
  const tier = detectTier();
  configureI18n({ lang: params.lang, social: params.social });
  await loadFonts();
  const app = await createApp(tier);
  const layers = createLayers(app.stage);
  const emitters = createEmitters();
  const art = await createArt(app);

  const ctx: GameContext = {
    app,
    layers,
    ...emitters,
    art,
    tier,
    budget: TIER_BUDGETS[tier],
    params,
    money: createMoney(params.currency, params.social),
    layout: LANDSCAPE,
    scale: 1,
  };

  const layout = new LayoutManager(ctx, tier === 'low' ? 1.5 : 2);
  layout.update(true);

  const modules: GameModule[] = [
    new Background(ctx),
    new Frame(ctx),
    new Board(ctx),
    new WinPresenter(ctx),
    new Fx(ctx),
    new Mascots(ctx),
    new FreeSpins(ctx),
    new BigWin(ctx),
    new Hud(ctx),
    new DomUi(ctx),
    new Sound(ctx),
  ];
  for (const m of modules) await m.init?.();
  layout.update(true);

  installDevHooks(ctx, clock);

  if (params.dev === 'lab' || params.dev === 'gallery') {
    const { startLab } = await import('./dev/lab');
    await startLab(ctx, params.dev);
    return;
  }

  const flow = new FlowController(ctx);
  await flow.start();
};

boot().catch((err: unknown) => {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#fff;background:#200;font:14px monospace;white-space:pre-wrap;z-index:99';
  el.textContent = `Boot failed:\n${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`;
  document.body.appendChild(el);
});
