import { Board } from '../../board/Board';
import { Fx } from '../../fx/Fx';
import type { GameContext, GameModule } from '../../game/context';
import { Mascots } from '../../mascots/Mascots';
import { BigWin } from '../../present/BigWin';
import { FreeSpins } from '../../present/FreeSpins';
import { WinPresenter } from '../../present/WinPresenter';
import { Sound } from '../../audio/Sound';
import { Hud } from '../../ui/hud/Hud';
import { DomUi } from '../../ui/dom/DomUi';
// Same neon bayou juke joint as Swamp Funk: its scene modules are shared.
import { Background } from '../swamp-funk/scene/Background';
import { Frame } from '../swamp-funk/scene/Frame';

/**
 * SWAMP FUNK: BASS DROP visual modules, in init order (draw order comes from the layers).
 * Minimal boot set: the shared engine modules on the 6x6 layout. The Groove Meter, speaker
 * stack and feature screens subscribe to the groove:* scene events (./events.ts) and slot
 * in here as they are built.
 */
export const createModules = (ctx: GameContext): GameModule[] => [
  new Background(ctx),
  new Frame(ctx, { logoText: 'BASS DROP' }),
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
