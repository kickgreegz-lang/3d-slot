import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CustomBounce } from 'gsap/CustomBounce';
import { CustomWiggle } from 'gsap/CustomWiggle';
import { PixiPlugin } from 'gsap/PixiPlugin';
import * as PIXI from 'pixi.js';
import { createArt } from './assets/loader';
import { loadFonts } from './assets/fonts';
import { createModules } from '@game/modules';
import { clock } from './core/clock';
import { installDevHooks } from './dev/hooks';
import { detectTier, TIER_BUDGETS } from './env/tier';
import { parseUrl } from './env/url';
import { configureI18n } from './i18n';
import { createMoney } from './money/format';
import { FlowController } from './flow/controller';
import { type GameContext, type GameModule, createEmitters } from './game/context';
import { LAYOUTS } from './config/layout';
import { createApp } from './render/app';
import { createLayers } from './render/layers';
import { LayoutManager } from './render/layout';

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
    layout: LAYOUTS.landscape,
    scale: 1,
  };

  const layout = new LayoutManager(ctx, tier === 'low' ? 1.5 : 2);
  layout.update(true);

  // the active game's modules (src/games/<GAME>/modules.ts, resolved through @game)
  const modules: GameModule[] = createModules(ctx);
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
