// (import order = module evaluation order = lab timing-section order; kept as main.ts had it)
import { Board } from '../../board/Board';
import { Fx } from '../../fx/Fx';
import type { GameContext, GameModule } from '../../game/context';
import { Mascots } from '../../mascots/Mascots';
import { BigWin } from '../../present/BigWin';
import { FreeSpins } from '../../present/FreeSpins';
import { WinPresenter } from '../../present/WinPresenter';
import { Background } from './scene/Background';
import { Frame } from './scene/Frame';
import { Sound } from '../../audio/Sound';
import { Hud } from '../../ui/hud/Hud';
import { DomUi } from '../../ui/dom/DomUi';

/**
 * SWAMP FUNK visual modules, in init order (main.ts constructs them, awaits each
 * `init()`, then lays them out). Draw order is decided by the layer each module
 * attaches to (render/layers.ts), not by this list.
 */
export const createModules = (ctx: GameContext): GameModule[] => [
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
