import { Sound } from '../../audio/Sound';
import { Board } from '../../board/Board';
import { Fx } from '../../fx/Fx';
import type { GameContext, GameModule } from '../../game/context';
import { BigWin } from '../../present/BigWin';
import { WinPresenter } from '../../present/WinPresenter';
import { DomUi } from '../../ui/dom/DomUi';
import { Hud } from '../../ui/hud/Hud';
import { Background } from './scene/Background';
import { Frame } from './scene/Frame';
import { Logo } from './scene/Logo';
import { Connections } from './connect/Connections';
import { Glint } from './glint/Glint';
import { HeistScreens } from './screens/HeistScreens';
import { BuyScreen } from './screens/BuyScreen';
import { IntroScreen } from './screens/IntroScreen';
import { Monty } from './mascots/Monty';
import { HeistSound } from './audio/HeistSound';

/**
 * MAGPIE HEIST visual modules, in init order (draw order comes from the layers; scene-event handlers
 * of the same event run in this order). The engine modules plus the heist feature modules, which
 * subscribe to the game scene events (./events.ts). The engine FreeSpins presenter is replaced by
 * HeistScreens (trigger, intros, retriggers, upgrade, counter plate, outro).
 */
export const createModules = (ctx: GameContext): GameModule[] => [
  new Background(ctx),
  new Frame(ctx),
  new Logo(ctx),
  new Board(ctx),
  new Connections(ctx),
  new Glint(ctx),
  new WinPresenter(ctx),
  new Fx(ctx),
  new Monty(ctx),
  new HeistScreens(ctx),
  new BigWin(ctx),
  new Hud(ctx),
  new DomUi(ctx),
  new BuyScreen(ctx),
  new IntroScreen(ctx),
  new HeistSound(ctx),
  new Sound(ctx),
];
