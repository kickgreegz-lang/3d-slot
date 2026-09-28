import { Board } from '../../board/Board';
import { Fx } from '../../fx/Fx';
import type { GameContext, GameModule } from '../../game/context';
import { Mascots } from '../../mascots/Mascots';
import { BigWin } from '../../present/BigWin';
import { WinPresenter } from '../../present/WinPresenter';
import { Sound } from '../../audio/Sound';
import { Hud } from '../../ui/hud/Hud';
import { DomUi } from '../../ui/dom/DomUi';
// Swamp Funk's Frame (glass, neon tube, 3-slice pieces) with Bass Drop's painted frame art (manifest/env.ts).
import { Frame } from '../swamp-funk/scene/Frame';
import { Connections } from './connect/Connections';
import { BassDrop } from './drop/BassDrop';
import { GrooveMeter } from './meter/GrooveMeter';
import { BuyScreen } from './screens/BuyScreen';
import { FeatureScreens } from './screens/FeatureScreens';
import { IntroScreen } from './screens/IntroScreen';
import { Background } from './scene/Background';
import { Logo } from './scene/Logo';
import { Stage } from './stage/Stage';

/**
 * SWAMP FUNK: BASS DROP visual modules, in init order (draw order comes from the layers;
 * scene-event handlers of the same event run in this order). The shared engine modules plus
 * the Bass Drop feature modules, which subscribe to the game scene events (./events.ts).
 * The engine FreeSpins presenter is replaced by FeatureScreens (feature intros, plate, outro).
 */
export const createModules = (ctx: GameContext): GameModule[] => [
  new Background(ctx),
  new Frame(ctx, { logo: false }),
  new Logo(ctx),
  new Stage(ctx),
  new GrooveMeter(ctx),
  new Board(ctx),
  new Connections(ctx),
  new WinPresenter(ctx),
  new BassDrop(ctx),
  new Fx(ctx),
  new Mascots(ctx),
  new FeatureScreens(ctx),
  new BigWin(ctx),
  new Hud(ctx),
  new DomUi(ctx),
  new BuyScreen(ctx),
  new IntroScreen(ctx),
  new Sound(ctx),
];
