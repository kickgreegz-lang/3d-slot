import { GAME_META, spotTier } from '../config/game';
import { clock } from '../core/clock';
import { TIMING, s } from '../core/timing';
import type { GameType } from '../book/types';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents, SfxId } from '../game/events';
import { AudioEngine, type PlayOpts } from './engine';
import type { MusicStem } from './manifest';
import { AUDIO_TIMING } from './mix';

/** localStorage key + encoding of the player's sound choice — shared with ui/dom/DomUi ('on' | 'off'). */
const PREF_KEY = `${GAME_META.storagePrefix}.sound`;
/** Music dips under scene-level fanfares even if the presenter emits no sfx (same values as the sfx rules). */
const SCENE_DUCK = { bigwin: { db: -6, hold: 1.8 }, fsTrigger: { db: -6, hold: 2.4 } } as const;

const readPref = (): boolean => {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
};

const writePref = (on: boolean): void => {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked (private mode / sandbox): the toggle still works this session */
  }
};

/**
 * Sound module: the bridge between scene events and the AudioEngine.
 *
 *  - 'sfx' {id, volume, rate, delayMs} plays a sound; delays run on the GAME clock
 *    (clock.wait: hit-stop and turbo aware), never setTimeout.
 *  - Scene events drive the music and the musical context of SFX:
 *      round:start / round:end   reset escalation, calm the groove
 *      board:reveal              new (free) spin: restart the cascade chain
 *      board:showWins            cascade depth: win_cluster climbs the scale, groove gains layers
 *      spots:update              spot tier -> spot_upgrade pitch
 *      win:set                   win level -> counter_end richness
 *      bigwin:show               big-win groove / stem + duck; bigwin_tier escalates
 *      fs:trigger                duck under the trigger fanfare
 *      music:duck                a game's own scene duck (Bass Drop: feature:trigger t 0)
 *      mode:change               base <-> free-game music (bar-quantised)
 *      music:stem                a game's feature variant ('megamix') over the gameType stem
 *  - bass_charge carries its span (the charge length, speed-scaled) so the riser and the
 *    music's high-pass sweep end on the boom in every speed profile.
 *  - 'ui:sound' toggles sound (persisted); hidden tabs suspend the context.
 *  - The AudioContext is created on the first real user gesture (no autoplay warnings).
 */
export class Sound implements GameModule {
  private readonly engine: AudioEngine;
  private readonly offs: (() => void)[] = [];
  private cascade = 0;
  private spotTierNow = 1;
  private bigwinStep = 0;
  private winLevel = 0;
  private gameType: GameType = 'basegame';
  private musicVariant: MusicStem | null = null;

  constructor(private readonly ctx: GameContext) {
    this.engine = new AudioEngine({ lowTier: ctx.tier === 'low', enabled: readPref() });
  }

  init(): void {
    const { game, ui } = this.ctx;
    const e = this.engine;
    this.offs.push(
      game.on('sfx', (p) => {
        this.onSfx(p);
      }),
      game.on('round:start', () => {
        this.cascade = 0;
        this.bigwinStep = 0;
        e.setEnergy(0);
        e.stopLoop();
      }),
      game.on('board:reveal', () => {
        // every (free) spin starts a new cascade chain
        this.cascade = 0;
        e.setEnergy(0);
      }),
      game.on('board:showWins', () => {
        this.cascade++;
        e.setEnergy(this.cascade);
      }),
      game.on('spots:update', ({ grid, previous }) => {
        this.spotTierNow = changedTier(grid, previous) || this.spotTierNow;
      }),
      game.on('win:set', ({ level }) => {
        this.winLevel = level;
      }),
      game.on('bigwin:show', () => {
        this.bigwinStep = 0;
        e.bigWinStart();
        e.duck(SCENE_DUCK.bigwin.db, SCENE_DUCK.bigwin.hold);
      }),
      game.on('fs:trigger', () => {
        e.duck(SCENE_DUCK.fsTrigger.db, SCENE_DUCK.fsTrigger.hold);
      }),
      game.on('music:duck', ({ db, holdMs }) => {
        e.duck(db, holdMs / 1000);
      }),
      game.on('mode:change', ({ gameType }) => {
        this.gameType = gameType;
        if (gameType === 'basegame') this.musicVariant = null;
        this.applyMusic();
      }),
      game.on('music:stem', ({ stem }) => {
        this.musicVariant = stem;
        this.applyMusic();
      }),
      game.on('round:end', () => {
        this.cascade = 0;
        e.setEnergy(0);
        e.bigWinEnd();
        e.stopLoop();
      }),
      ui.on('ui:sound', ({ enabled }) => {
        writePref(enabled);
        e.setEnabled(enabled);
      }),
      clock.onUpdate(() => e.tick()),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    e.attach();
    e.preload();
    if (import.meta.env.DEV) void import('./devDemo').then((m) => m.installAudioDemo(e));
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.engine.destroy();
  }

  private readonly onVisibility = (): void => {
    this.engine.setHidden(document.hidden);
  };

  private applyMusic(): void {
    this.engine.setMode(this.musicVariant ?? (this.gameType === 'freegame' ? 'freegame' : 'base'));
  }

  private onSfx(p: GameEvents['sfx']): void {
    if (p.id === 'bigwin_tier') this.bigwinStep++;
    const opts: PlayOpts = {
      volume: p.volume,
      rate: p.rate,
      step: this.stepFor(p.id),
      period: s(TIMING.anticipation.pulsePeriod),
      span: s(AUDIO_TIMING.chargeSpan * 1000),
    };
    const fire = (): void => {
      this.engine.play(p.id, opts);
      if (p.id === 'bigwin_end') this.engine.bigWinEnd();
    };
    if (p.delayMs && p.delayMs > 0) void clock.wait(p.delayMs).then(fire);
    else fire();
  }

  /** Musical escalation index for sounds that climb with game state. */
  private stepFor(id: SfxId): number {
    switch (id) {
      case 'win_cluster':
        return Math.max(0, this.cascade - 1);
      case 'spot_mark':
      case 'spot_upgrade':
        return this.spotTierNow;
      case 'bigwin_tier':
        return this.bigwinStep;
      case 'counter_end':
      case 'win_small':
        return this.winLevel;
      default:
        return 0;
    }
  }
}

/** Highest heat tier among spots whose value changed (0 when none). */
const changedTier = (grid: number[][], previous: number[][]): number => {
  let best = 0;
  grid.forEach((col, x) =>
    col.forEach((v, y) => {
      if (v !== (previous[x]?.[y] ?? 0)) best = Math.max(best, spotTier(v));
    }),
  );
  return best;
};
