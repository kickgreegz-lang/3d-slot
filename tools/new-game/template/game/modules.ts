// (import order = module evaluation order = lab timing-section order)
import { Board } from '../../board/Board';
import { LayeredEnvironment } from '../../environment/LayeredEnvironment';
import { Fx } from '../../fx/Fx';
import type { GameContext, GameModule } from '../../game/context';
import { BigWin } from '../../present/BigWin';
import { FreeSpins } from '../../present/FreeSpins';
import { WinPresenter } from '../../present/WinPresenter';
import { ENVIRONMENT } from './environment';
import { Frame } from './scene/Frame';
import { Sound } from '../../audio/Sound';
import { Hud } from '../../ui/hud/Hud';
import { DomUi } from '../../ui/dom/DomUi';

/**
 * __TITLE__ visual modules, in init order (main.ts constructs them, awaits each `init()`,
 * then lays them out). Draw order is decided by the layer each module attaches to
 * (render/layers.ts), not by this list.
 *
 * Scaffolded by tools/new-game/scaffold.mjs (docs/new-slot/WORKFLOW.md):
 *  - LayeredEnvironment plays every background state (docs/new-slot/ANIMATION_STATES.md §3)
 *    from ./environment.ts — placeholders until the Higgsfield plates land;
 *  - Frame / placeholder symbols are copied from the template game: replace them in phase C;
 *  - no 3D mascots (2D Spine characters are the mobile-first default, TECH_STACK.md layer 6).
 *    To use the three.js mascots, add `new Mascots(ctx)` (src/mascots/Mascots) after Fx and
 *    remove "assets/characters" from meta.json publicExclude.
 * Add the game's own feature modules (meter, collectors, transforms ...) here, each owning one job.
 */
export const createModules = (ctx: GameContext): GameModule[] => [
  new LayeredEnvironment(ctx, ENVIRONMENT),
  new Frame(ctx, { logoText: __TITLE_LITERAL__ }),
  new Board(ctx),
  new WinPresenter(ctx),
  new Fx(ctx),
  new FreeSpins(ctx),
  new BigWin(ctx),
  new Hud(ctx),
  new DomUi(ctx),
  new Sound(ctx),
];
