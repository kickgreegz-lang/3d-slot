import { countReveals, normalizeBook, normalizeEvents } from '../book/adapter';
import {
  type BookContext,
  type FreeSpinsState,
  type RoundPlayback,
  bookEventHandlerMap,
  createRoundPlayback,
  foldHistory,
  restoreScene,
} from '../book/handlers';
import { playBookEvents } from '../book/player';
import type { BookEvent, GameType } from '../book/types';
import { API_MONEY_SCALE } from '../config/game';
import { clock } from '../core/clock';
import { type SpeedProfile, getSpeedProfile, setSpeedProfile } from '../core/timing';
import type { GameContext } from '../game/context';
import type { UiEvents } from '../game/events';
import { configureI18n } from '../i18n';
import { RgsClient } from '../rgs/client';
import { type AuthenticateResponse, type PlayResponse, type RgsRound, RgsError, isRgsError } from '../rgs/types';
import { attractBoard } from './attract';
import { BetLadder } from './bets';
import { endRoundPolicy, resumePosition } from './endRound';
import { type FlowHudState, type FlowState, type ReplayPhase, TRANSITIONS } from './hudState';
import { Jurisdiction, Stopwatch, parseJurisdiction } from './jurisdiction';
import { type FlowMessageKey, errorMessageKey, flowText } from './messages';
import { BASE_MODE, type BetModeDef, modeCost, resolveBetModes } from './modes';

/**
 * FLOW CONTROLLER — the game's typed async state machine (mirrors the web-sdk
 * game/bet/autoBet/resumeBet machines, ~critic.md "flow/"):
 *
 *   rendering -> idle | resume | replay | error
 *   idle -> spinning -> presenting -> idle            (ui:spin, ui:buy)
 *   idle -> autoplay -> (spinning -> presenting)* -> idle
 *   rendering -> resume -> presenting -> idle         (authenticate round.active)
 *   rendering -> replay -> presenting -> replay       (?replay=true, no session calls)
 *
 * Money rules: bet deducted from the displayed balance on spin, win added only when
 * the presentation ends (end-round balance held). 'round:start' is broadcast BEFORE
 * awaiting /wallet/play so the fall-out animation overlaps the network.
 *
 * Autoplay limits (`ui:autoplay` lossLimit / singleWinLimit) are API money units.
 */

const BALANCE_POLL_MS = 60_000;
const RESUME_NOTICE_MS = 1200;

interface AutoplaySession {
  remaining: number;
  lossLimit: number | null;
  singleWinLimit: number | null;
  startBalance: number;
  stopRequested: boolean;
}

interface RoundOutcome {
  /** payout in API units */
  win: number;
  /** debit in API units */
  cost: number;
}

interface ReplaySession {
  phase: ReplayPhase;
  events: BookEvent[];
  mode: string;
  bet: number;
  costMultiplier: number;
  payoutMultiplier: number;
}

/** `window.__slot.flow` — automation surface (playBook/forceBook only in DEV or ?capture=1). */
export interface FlowDevApi {
  readonly state: FlowState;
  readonly hud: FlowHudState | null;
  /** resolves once the flow first reaches idle / replay / error */
  ready: Promise<void>;
  /** press spin; resolves when the round (or replay) has fully settled */
  spin(): Promise<void>;
  /** play any book object (fixture / RGS state) through the real handlers, no RGS */
  playBook?(book: unknown): Promise<void>;
  /** DEV: force the mock RGS to serve this fixture (null = random again) */
  forceBook?(book: string | null, bookMode?: 'base' | 'bonus'): void;
}

const positive = (v: number | undefined): number | null => (typeof v === 'number' && v > 0 ? v : null);
const roundId = (r: RgsRound | null | undefined): number | null => r?.betID ?? r?.roundID ?? null;
const noop = (): void => undefined;

export class FlowController {
  state: FlowState = 'rendering';

  private readonly params: GameContext['params'];
  private client: RgsClient | null = null;
  private jur = new Jurisdiction();
  private uninstallGuards: (() => void) | null = null;
  private modes: Record<string, BetModeDef> = resolveBetModes(undefined);
  private bets = BetLadder.fromConfig(undefined);
  private activeMode = BASE_MODE;
  /** displayed balance (API units) */
  private balance = 0;
  /** displayed win of the current / last round (API units) */
  private hudWin = 0;
  private freeSpins: FreeSpinsState | null = null;
  /** player-selected speed; a slam-stop overrides it until the round ends */
  private playerSpeed: SpeedProfile = 'normal';
  private slammed = false;
  private auto: AutoplaySession | null = null;
  private replay: ReplaySession | null = null;
  private fatal = false;
  /** a response was lost: re-authenticate (and resume) before the next play */
  private needsResync = false;
  private social: boolean;
  private soundEnabled = true;
  /** session wins - bets (API units), for jurisdiction.displayNetPosition */
  private netPosition = 0;
  /** newest round id this session knows (a new id at resync = a /play whose response was lost) */
  private lastRoundId: number | null = null;
  /** a round whose bet is in netPosition but whose end-round response was lost */
  private unsettledWin: { id: number | null; win: number } | null = null;
  private sceneGameType: GameType = 'basegame';
  private sceneBoard: string[][] | null = null;
  private readonly roundWatch = new Stopwatch();
  private readonly sessionWatch: Stopwatch;
  private sessionSecond = -1;
  private pollMs = 0;
  /** bumped when a round starts or the balance is re-read: a balance poll sent before is stale */
  private balanceEpoch = 0;
  private messageShown = false;
  private lastHud: FlowHudState | null = null;
  private betTexts: { currency: string; texts: string[] } | null = null;
  private forced: { book: string; bookMode: string | null } | null = null;
  private waiters: Array<() => void> = [];
  private readyResolve: () => void = noop;
  private readonly ready = new Promise<void>((r) => (this.readyResolve = r));

  constructor(private readonly ctx: GameContext) {
    this.params = ctx.params;
    this.social = ctx.params.social;
    this.sessionWatch = new Stopwatch((ms) => this.onSessionTick(ms));
    clock.onUpdate(() => this.tickBalancePoll());
  }

  async start(): Promise<void> {
    this.exposeDevApi();
    this.wireUi();
    this.broadcastState();
    if (this.params.replay) {
      await this.guard(() => this.startReplay());
      return;
    }
    const conn = this.connection();
    if (!conn) {
      this.fail(new RgsError('ERR_CONFIG', 'Missing sessionID / rgs_url', 0), true);
      return;
    }
    this.client = new RgsClient({
      rgsUrl: conn.rgsUrl,
      sessionID: conn.sessionID,
      language: this.params.lang,
      devQuery: import.meta.env.DEV ? () => this.devQuery() : undefined,
    });
    let auth: AuthenticateResponse;
    try {
      auth = await this.client.authenticate();
    } catch (e) {
      this.fail(e, true);
      return;
    }
    this.applyAuth(auth);
    this.sessionWatch.restart();
    const round = auth.round;
    this.lastRoundId = roundId(round);
    if (round?.active && Array.isArray(round.state)) {
      void this.guard(() => this.resume(round));
      return;
    }
    await this.setScene(attractBoard());
    this.to('idle');
  }

  // ---------------------------------------------------------------- setup

  /** Launch params; with none at all in DEV, default to the local mock RGS. */
  private connection(): { rgsUrl: string; sessionID: string } | null {
    const dev = import.meta.env.DEV;
    const rgsUrl = this.params.rgsUrl ?? (dev ? `${location.host}/__rgs` : null);
    const sessionID = this.params.sessionID ?? (dev ? 'dev' : null);
    return rgsUrl && sessionID ? { rgsUrl, sessionID } : null;
  }

  /** DEV-only passthrough to the mock RGS (forced fixture, currency, jurisdiction overrides). */
  private devQuery(): Record<string, string | null> {
    const q = new URLSearchParams(location.search);
    return {
      book: this.forced ? this.forced.book : this.params.book,
      bookMode: this.forced ? this.forced.bookMode : this.params.bookMode,
      currency: q.get('currency'),
      jurisdiction: q.get('jurisdiction'),
    };
  }

  private applyAuth(auth: AuthenticateResponse): void {
    const cfg = auth.config;
    this.jur = new Jurisdiction(parseJurisdiction(cfg?.jurisdiction));
    this.uninstallGuards?.();
    this.uninstallGuards = this.jur.installDomGuards();
    const socialSwitch = this.jur.flags.socialCasino && !this.social;
    if (socialSwitch) {
      this.social = true;
      configureI18n({ lang: this.params.lang, social: true });
    }
    this.ctx.money.configure?.({ currency: auth.balance?.currency ?? this.params.currency, social: this.social });
    this.balance = auth.balance?.amount ?? 0;
    this.modes = resolveBetModes(cfg?.betModes);
    this.bets = BetLadder.fromConfig(cfg);
    // "refreshing mid-spin keeps the bet": restore from the last / active round
    if (auth.round?.amount) this.bets.select(auth.round.amount);
    this.playerSpeed = this.jur.clampProfile(this.playerSpeed);
    setSpeedProfile(this.playerSpeed);
    this.ctx.money.setBet(this.bets.value);
    // social wording / money are live from here: tell the HUD now (it relabels on `social`)
    if (socialSwitch) this.broadcastState();
  }

  private wireUi(): void {
    const ui = this.ctx.ui;
    ui.on('ui:spin', () => this.onSpin());
    ui.on('ui:skip', () => this.slam());
    ui.on('ui:betUp', () => this.stepBet(1));
    ui.on('ui:betDown', () => this.stepBet(-1));
    ui.on('ui:betSet', (p) => this.setBetIndex(p.index));
    ui.on('ui:turbo', () => this.cycleTurbo());
    ui.on('ui:autoplay', (p) => {
      if (p) void this.guard(() => this.autoplay(p));
      else this.stopAutoplay();
    });
    ui.on('ui:buy', (p) => this.buy(p.mode));
    ui.on('ui:sound', (p) => {
      this.soundEnabled = p.enabled;
      this.broadcastState();
    });
  }

  // ---------------------------------------------------------------- UI commands

  private onSpin(): void {
    switch (this.state) {
      case 'idle':
        void this.guard(() => this.singleRound(BASE_MODE));
        break;
      case 'spinning':
      case 'presenting':
      case 'resume':
        if (this.auto) this.stopAutoplay();
        else this.slam();
        break;
      case 'autoplay':
        this.stopAutoplay();
        break;
      case 'replay':
        void this.guard(() => this.playReplay());
        break;
      case 'error':
        if (!this.fatal) {
          this.message(null);
          this.to('idle');
        }
        break;
      default:
        break;
    }
  }

  /**
   * A slam-stop would do something: the round is running, the jurisdiction allows it, it
   * was not used yet and the slam profile is faster than the current one (under
   * disabledTurbo, or already at superTurbo, there is nothing to speed up).
   */
  private get canSlam(): boolean {
    const busy = this.state === 'spinning' || this.state === 'presenting' || this.state === 'resume';
    return busy && this.jur.slamStopAllowed && !this.slammed && this.jur.slamProfile !== getSpeedProfile();
  }

  /** Slam-stop / skip: the rest of this round (and what is already moving) plays at slam speed until round end. */
  private slam(): void {
    if (!this.canSlam) return;
    this.slammed = true;
    setSpeedProfile(this.jur.slamProfile);
    this.broadcastState();
  }

  private betChangeAllowed(): boolean {
    return this.state === 'idle' && !this.replay && !this.fatal;
  }

  private stepBet(delta: number): void {
    if (this.betChangeAllowed() && this.bets.step(delta)) this.applyBet();
  }

  private setBetIndex(index: number): void {
    if (this.betChangeAllowed() && this.bets.setIndex(index)) this.applyBet();
  }

  private applyBet(): void {
    this.ctx.money.setBet(this.bets.value);
    this.broadcastState();
  }

  private cycleTurbo(): void {
    const next = this.jur.nextProfile(this.playerSpeed);
    if (next === this.playerSpeed) return;
    this.playerSpeed = next;
    if (!this.slammed) setSpeedProfile(next);
    this.broadcastState();
  }

  private buy(mode: string): void {
    if (this.state !== 'idle' || this.replay || this.fatal || !this.jur.buyAllowed) return;
    const def = this.modes[mode.toUpperCase()];
    if (!def?.buy) return;
    void this.guard(() => this.singleRound(def.key));
  }

  private stopAutoplay(): void {
    if (!this.auto || this.auto.stopRequested) return;
    this.auto.stopRequested = true;
    this.broadcastState();
  }

  // ---------------------------------------------------------------- rounds

  private async singleRound(mode: string): Promise<void> {
    if (this.needsResync && (await this.resync())) return;
    await this.playRound(mode, 'idle');
  }

  private async autoplay(cfg: NonNullable<UiEvents['ui:autoplay']>): Promise<void> {
    if (this.state !== 'idle' || this.replay || this.fatal || !this.jur.autoplayAllowed) return;
    if (!(cfg.rounds > 0)) return;
    if (this.needsResync && (await this.resync())) return;
    const auto: AutoplaySession = {
      remaining: cfg.rounds,
      lossLimit: positive(cfg.lossLimit),
      singleWinLimit: positive(cfg.singleWinLimit),
      startBalance: this.balance,
      stopRequested: false,
    };
    this.auto = auto;
    this.message(null);
    this.to('autoplay');
    let stop: FlowMessageKey | null = null;
    while (!auto.stopRequested && auto.remaining > 0) {
      const cost = Math.round(this.bets.value * modeCost(this.modes, BASE_MODE));
      if (this.balance < cost) {
        stop = 'autoplayFunds';
        break;
      }
      // never start a spin that could take the session loss past the limit
      if (auto.lossLimit !== null && auto.startBalance - this.balance + cost > auto.lossLimit) {
        stop = 'autoplayLossLimit';
        break;
      }
      auto.remaining -= 1;
      const outcome = await this.playRound(BASE_MODE, 'autoplay');
      if (!outcome || !this.is('autoplay')) break;
      if (auto.singleWinLimit !== null && outcome.win >= auto.singleWinLimit) {
        stop = 'autoplayWinLimit';
        break;
      }
    }
    this.auto = null;
    if (this.is('autoplay')) this.to('idle');
    if (stop) this.message(flowText(stop, this.social), 'info');
    this.broadcastState();
  }

  /**
   * One paid round: validate -> debit display -> round:start (fall-out) || /play ->
   * present the book (+ /bet/event per reveal in bonus rounds) -> end-round per policy
   * -> credit display -> round:end -> minimum-duration hold -> `after`.
   */
  private async playRound(mode: string, after: 'idle' | 'autoplay'): Promise<RoundOutcome | null> {
    const client = this.client;
    if (!client) return null;
    const bet = this.bets.value;
    const cost = Math.round(bet * modeCost(this.modes, mode));
    if (this.balance < cost) {
      this.message(flowText('insufficientFunds', this.social), 'error');
      return null;
    }
    this.message(null);
    this.activeMode = mode;
    this.ctx.money.setBet(bet);
    this.beginRound();
    const balanceBefore = this.balance;
    this.balance = balanceBefore - cost;
    this.to('spinning');

    const fallOut = this.ctx.game.broadcastAsync('round:start', { profile: getSpeedProfile() });
    const [played, fell] = await Promise.allSettled([
      client.play({ amount: bet, mode, currency: this.ctx.money.currency }),
      fallOut,
    ]);
    if (fell.status === 'rejected') this.devReport(fell.reason);
    if (played.status === 'rejected') {
      const e: unknown = played.reason;
      this.balance = balanceBefore;
      if (!isRgsError(e) || e.code === 'ERR_NETWORK' || e.status >= 500) this.needsResync = true;
      await this.setScene(this.sceneBoard ?? attractBoard());
      await this.ctx.game.broadcastAsync('round:end', { totalWin: 0 });
      this.endRoundCleanup();
      this.fail(e);
      return null;
    }
    const res: PlayResponse = played.value;
    const round = res.round;
    this.lastRoundId = roundId(round);
    const events = normalizeEvents(round.state);
    const policy = endRoundPolicy(round, countReveals(events));
    // single-reveal win: settle now, but HOLD the balance until the animation is over
    const settled = policy === 'immediate' ? client.endRound() : null;
    settled?.catch(noop);

    this.to('presenting');
    const playback = this.newPlayback();
    let presentError: unknown = null;
    try {
      await this.present(events, { record: policy === 'afterPresentation', playback });
    } catch (e) {
      presentError = e;
    }

    const win = typeof round.payout === 'number' ? round.payout : this.ctx.money.fromBook(playback.roundTotal);
    let finalBalance = res.balance.amount;
    try {
      if (settled) finalBalance = (await settled).balance.amount;
      else if (policy === 'afterPresentation') finalBalance = (await client.endRound()).balance.amount;
    } catch (e) {
      // the bet is spent; the win is counted once a resync finds the round settled
      this.netPosition -= cost;
      this.unsettledWin = { id: roundId(round), win };
      this.needsResync = true;
      await this.finishRound(playback.roundTotal, 'idle');
      this.fail(e);
      return null;
    }
    this.balance = finalBalance;
    this.netPosition += win - cost;
    await this.finishRound(playback.roundTotal, after);
    if (presentError) {
      this.fail(presentError);
      this.devReport(presentError);
      return null;
    }
    return { win, cost };
  }

  /** Authenticate round.active: rebuild the scene from history, finish the round, settle it. */
  private async resume(round: RgsRound): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.to('resume');
    this.message(flowText('resuming', this.social), 'info');
    const events = normalizeEvents(round.state);
    const mode = (round.mode ?? BASE_MODE).toUpperCase();
    this.activeMode = mode;
    if (round.amount) {
      this.bets.select(round.amount);
      this.ctx.money.setBet(round.amount);
    }
    const policy = endRoundPolicy(round, countReveals(events));
    const from = policy === 'afterPresentation' ? resumePosition(events, round.event) : 0;
    const playback = this.newPlayback();
    this.beginRound();
    if (from > 0) {
      foldHistory(playback, events.slice(0, from), this.ctx.money);
      this.hudWin = playback.hudWin;
      this.freeSpins = playback.freeSpins ? { ...playback.freeSpins } : null;
      this.sceneGameType = playback.gameType;
      await restoreScene(this.ctx, playback);
      this.broadcastState();
      await clock.waitUi(RESUME_NOTICE_MS);
    } else {
      await this.setScene(this.sceneBoard ?? attractBoard());
      await clock.waitUi(RESUME_NOTICE_MS);
      await this.ctx.game.broadcastAsync('round:start', { profile: getSpeedProfile() });
    }
    const settled = policy === 'immediate' ? client.endRound() : null;
    settled?.catch(noop);
    this.message(null);
    this.to('presenting');
    let presentError: unknown = null;
    try {
      await this.present(events, { record: policy === 'afterPresentation', from, playback });
    } catch (e) {
      presentError = e;
    }
    // the bet is already counted (at /play, by resync for a lost /play) or predates this session
    const win = typeof round.payout === 'number' ? round.payout : this.ctx.money.fromBook(playback.roundTotal);
    try {
      const final = settled ? await settled : policy === 'afterPresentation' ? await client.endRound() : await client.balance();
      this.balance = final.balance.amount;
      this.netPosition += win;
      this.unsettledWin = null;
    } catch (e) {
      this.unsettledWin = { id: roundId(round), win };
      this.needsResync = true;
      await this.finishRound(playback.roundTotal, 'idle');
      this.fail(e);
      return;
    }
    this.ctx.money.setBet(this.bets.value);
    await this.finishRound(playback.roundTotal, 'idle');
    if (presentError) {
      this.fail(presentError);
      this.devReport(presentError);
    }
  }

  /** After a lost response: re-authenticate; resume if the RGS still holds an active round. */
  private async resync(): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    this.to('resume');
    let auth: AuthenticateResponse;
    try {
      auth = await client.authenticate();
    } catch (e) {
      this.fail(e);
      return true;
    }
    this.needsResync = false;
    this.balance = auth.balance.amount;
    this.balanceEpoch += 1;
    this.reconcileNet(auth.round);
    if (auth.round?.active && Array.isArray(auth.round.state)) {
      await this.resume(auth.round);
      return true;
    }
    this.to('idle');
    return false;
  }

  /**
   * displayNetPosition after lost responses: count the bet of a /play the RGS took but
   * whose response never arrived (a round id this session has not seen; its win, if
   * still open, is counted by resume), and the win of a round whose end-round response
   * was lost but which the RGS has settled since.
   */
  private reconcileNet(round: RgsRound | null): void {
    const id = roundId(round);
    if (round && id !== this.lastRoundId) {
      this.lastRoundId = id;
      const mode = (round.mode ?? BASE_MODE).toUpperCase();
      this.netPosition -= Math.round((round.amount ?? 0) * modeCost(this.modes, mode));
      if (!round.active) this.netPosition += round.payout ?? 0;
    }
    const pending = this.unsettledWin;
    if (pending && !(round?.active && id === pending.id)) {
      this.netPosition += pending.win;
      this.unsettledWin = null;
    }
  }

  private newPlayback(): RoundPlayback {
    return createRoundPlayback(this.sceneGameType, this.sceneBoard, this.activeMode);
  }

  private beginRound(): void {
    this.roundWatch.restart();
    this.slammed = false;
    setSpeedProfile(this.playerSpeed);
    this.hudWin = 0;
    this.freeSpins = null;
    this.pollMs = 0;
    this.balanceEpoch += 1;
  }

  private endRoundCleanup(): void {
    this.roundWatch.stop();
    this.slammed = false;
    setSpeedProfile(this.playerSpeed);
    if (!this.replay) this.activeMode = BASE_MODE;
  }

  /** Credit display -> round:end -> jurisdiction minimum round duration -> `after`. */
  private async finishRound(totalWin: number, after: FlowState): Promise<void> {
    this.broadcastState();
    await this.ctx.game.broadcastAsync('round:end', { totalWin });
    await this.roundWatch.reached(this.jur.minimumRoundMs);
    this.endRoundCleanup();
    this.freeSpins = null;
    this.to(after);
  }

  /** Play book events through the real handlers (sequential, animation-paced). */
  private async present(
    events: readonly BookEvent[],
    opts: { record: boolean; from?: number; playback: RoundPlayback },
  ): Promise<RoundPlayback> {
    const state = opts.playback;
    const bookCtx: BookContext = {
      ctx: this.ctx,
      bookEvents: events,
      state,
      hooks: {
        onReveal: (e) => {
          if (opts.record) this.client?.event(e.index).catch(noop);
        },
        onHudChange: (s) => {
          this.hudWin = s.hudWin;
          this.freeSpins = s.freeSpins ? { ...s.freeSpins } : null;
          this.broadcastState();
        },
      },
    };
    try {
      await playBookEvents(bookEventHandlerMap, events, bookCtx, { from: opts.from });
    } finally {
      this.sceneGameType = state.gameType;
      this.sceneBoard = state.board;
    }
    return state;
  }

  private async setScene(board: string[][]): Promise<void> {
    this.sceneBoard = board;
    await this.ctx.game.broadcastAsync('board:set', { board });
  }

  // ---------------------------------------------------------------- replay

  private async startReplay(): Promise<void> {
    const p = this.params;
    const mode = (p.mode ?? BASE_MODE).toUpperCase();
    const bet = p.amount && p.amount > 0 ? Math.round(p.amount) : API_MONEY_SCALE;
    const replay: ReplaySession = {
      phase: 'loading',
      events: [],
      mode,
      bet,
      costMultiplier: modeCost(this.modes, mode),
      payoutMultiplier: 0,
    };
    this.replay = replay;
    this.activeMode = mode;
    // docs: missing currency/amount -> 1 USD, or 1 SC in social mode
    const hasCurrency = new URLSearchParams(location.search).has('currency');
    this.ctx.money.configure?.({ currency: hasCurrency ? p.currency : this.social ? 'XSC' : 'USD', social: this.social });
    this.bets = BetLadder.fixed(bet);
    this.ctx.money.setBet(bet);
    this.to('replay');
    this.message(flowText('replayLoading', this.social), 'info');

    const rgsUrl = p.rgsUrl ?? (import.meta.env.DEV ? `${location.host}/__rgs` : null);
    if (!rgsUrl || !p.game || !p.version || !p.mode || !p.event) {
      this.replayFailed('replayMissing');
      return;
    }
    // replay makes NO session calls: a session-less client that only issues GET /bet/replay
    const client = new RgsClient({ rgsUrl, sessionID: null, language: p.lang });
    try {
      const res = await client.replay({ game: p.game, version: p.version, mode: p.mode, event: p.event });
      replay.events = normalizeEvents(res.state);
      if (res.costMultiplier > 0) replay.costMultiplier = res.costMultiplier;
      replay.payoutMultiplier = res.payoutMultiplier ?? 0;
    } catch (e) {
      this.replayFailed(isRgsError(e) && e.code === 'NOT_FOUND' ? 'replayNotFound' : errorMessageKey(this.asRgsError(e)));
      return;
    }
    await this.setScene(attractBoard());
    replay.phase = 'ready';
    this.message(this.replayInfoText(), 'info');
    this.broadcastState();
  }

  private replayFailed(key: FlowMessageKey): void {
    if (this.replay) this.replay.phase = 'error';
    this.fatal = true;
    this.to('error');
    this.message(flowText(key, this.social), 'error');
  }

  private async playReplay(): Promise<void> {
    const r = this.replay;
    if (!r || (r.phase !== 'ready' && r.phase !== 'done')) return;
    r.phase = 'playing';
    this.message(null);
    this.beginRound();
    this.to('presenting');
    await this.ctx.game.broadcastAsync('round:start', { profile: getSpeedProfile() });
    const playback = this.newPlayback();
    try {
      await this.present(r.events, { record: false, playback });
    } finally {
      r.phase = 'done';
      await this.finishRound(playback.roundTotal, 'replay');
      this.message(this.replayResultText(), 'info');
    }
  }

  private replayInfoText(): string {
    const r = this.replay;
    if (!r) return '';
    const fmt = this.ctx.money.format;
    return flowText('replayInfo', this.social, {
      mode: r.mode,
      bet: fmt(r.bet),
      cost: fmt(Math.round(r.bet * r.costMultiplier)),
    });
  }

  private replayResultText(): string {
    const r = this.replay;
    if (!r) return '';
    return flowText('replayResult', this.social, {
      mult: r.payoutMultiplier.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      win: this.ctx.money.format(Math.round(r.bet * r.payoutMultiplier)),
    });
  }

  // ---------------------------------------------------------------- state, messages, errors

  /** State check that TS does not narrow across awaits. */
  private is(s: FlowState): boolean {
    return this.state === s;
  }

  private to(next: FlowState): void {
    if (next === this.state) return;
    if (import.meta.env.DEV && !TRANSITIONS[this.state].includes(next)) {
      throw new Error(`Flow: illegal transition ${this.state} -> ${next}`);
    }
    this.state = next;
    if (next === 'idle' || next === 'replay' || next === 'error') {
      this.readyResolve();
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w();
    }
    this.broadcastState();
  }

  private asRgsError(e: unknown): RgsError {
    return isRgsError(e) ? e : new RgsError('ERR_GEN', e instanceof Error ? e.message : String(e), 0);
  }

  /** Show the error; session-level (or forced) failures are terminal, others return to idle. */
  private fail(e: unknown, forceFatal = false): void {
    const err = this.asRgsError(e);
    if (this.auto) this.auto.stopRequested = true;
    this.message(flowText(errorMessageKey(err), this.social), 'error');
    if (forceFatal || err.fatal || this.replay) {
      this.fatal = true;
      this.to('error');
    } else if (this.state !== 'idle') {
      this.to('idle');
    }
    this.broadcastState();
  }

  /** Run an async flow task; failures become player-facing errors (and resurface in DEV). */
  private async guard(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (e) {
      if (this.state !== 'error') this.fail(e);
      this.devReport(e);
    }
  }

  /** DEV: rethrow non-RGS bugs asynchronously so they surface as page errors (no console). */
  private devReport(e: unknown): void {
    if (import.meta.env.DEV && !isRgsError(e)) {
      queueMicrotask(() => {
        throw e;
      });
    }
  }

  private message(text: string | null, kind: 'info' | 'error' = 'info'): void {
    if (text === null && !this.messageShown) return;
    this.messageShown = text !== null;
    this.ctx.hud.broadcast('hud:message', text === null ? null : { text, kind });
  }

  private tickBalancePoll(): void {
    this.pollMs += clock.realDt * 1000;
    if (this.pollMs < BALANCE_POLL_MS) return;
    this.pollMs = 0;
    const client = this.client;
    if (!client || this.state !== 'idle' || this.replay) return;
    const epoch = this.balanceEpoch;
    client
      .balance()
      .then((r) => {
        // a round (or resync) since the request makes this answer stale
        if (this.state !== 'idle' || epoch !== this.balanceEpoch) return;
        this.balance = r.balance.amount;
        this.broadcastState();
      })
      .catch(noop);
  }

  private onSessionTick(ms: number): void {
    if (!this.jur.flags.displaySessionTimer) return;
    const sec = Math.floor(ms / 1000);
    if (sec === this.sessionSecond) return;
    this.sessionSecond = sec;
    this.broadcastState();
  }

  private levelTexts(): string[] {
    const currency = this.ctx.money.currency;
    if (!this.betTexts || this.betTexts.currency !== currency || this.betTexts.texts.length !== this.bets.count) {
      this.betTexts = { currency, texts: this.bets.levels.map((v) => this.ctx.money.format(v)) };
    }
    return this.betTexts.texts;
  }

  private buildHud(): FlowHudState {
    const fmt = (v: number): string => this.ctx.money.format(v);
    const replayMode = this.params.replay;
    const r = this.replay;
    const idle = this.state === 'idle';
    const busy = this.state === 'spinning' || this.state === 'presenting' || this.state === 'resume';
    const canSlam = this.canSlam;
    const flags = this.jur.flags;
    const mode = this.modes[this.activeMode] ?? this.modes[BASE_MODE];
    const secs = Math.floor(this.sessionWatch.elapsedMs / 1000);
    const hms = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    const spinEnabled = replayMode
      ? r?.phase === 'ready' || r?.phase === 'done' || canSlam
      : !this.fatal && (idle || this.state === 'autoplay' || canSlam || (busy && this.auto !== null));
    return {
      balanceText: replayMode ? '' : fmt(this.balance),
      betText: fmt(this.bets.value),
      winText: fmt(this.hudWin),
      balance: replayMode ? 0 : this.balance,
      bet: this.bets.value,
      win: this.hudWin,
      spinEnabled,
      isSpinning: busy,
      betUpEnabled: this.betChangeAllowed() && this.bets.canUp,
      betDownEnabled: this.betChangeAllowed() && this.bets.canDown,
      turbo: this.playerSpeed,
      turboAllowed: this.jur.turboAllowed,
      autoplayAllowed: !replayMode && this.jur.autoplayAllowed,
      autoplayRemaining: this.auto && !this.auto.stopRequested ? this.auto.remaining : null,
      buyAllowed: !replayMode && idle && !this.fatal && this.jur.buyAllowed && Object.values(this.modes).some((m) => m.buy),
      freeSpins: this.freeSpins ? { ...this.freeSpins } : null,
      replay: replayMode,
      social: this.social,

      phase: this.state,
      mode: mode?.key ?? BASE_MODE,
      modeCost: mode?.cost ?? 1,
      betIndex: this.bets.position,
      betLevelCount: this.bets.count,
      betLevelTexts: this.levelTexts(),
      canAfford: this.balance >= Math.round(this.bets.value * modeCost(this.modes, BASE_MODE)),
      slamStopAllowed: this.jur.slamStopAllowed,
      spacebarAllowed: this.jur.spacebarAllowed,
      fullscreenAllowed: this.jur.fullscreenAllowed,
      turboProfiles: this.jur.profiles,
      soundEnabled: this.soundEnabled,
      netPositionText:
        flags.displayNetPosition && !replayMode ? `${this.netPosition > 0 ? '+' : ''}${fmt(this.netPosition)}` : null,
      rtpText: flags.displayRTP && mode ? `RTP ${(mode.rtp * 100).toFixed(2)}%` : null,
      sessionTimeText: flags.displaySessionTimer ? hms : null,
      replayPhase: r?.phase ?? null,
      replayButtonText: r
        ? flowText(r.phase === 'done' ? 'replayAgain' : 'replayStart', this.social)
        : null,
      replayInfoText: r && r.phase !== 'loading' && r.phase !== 'error' ? this.replayInfoText() : null,
      replayResultText: r?.phase === 'done' ? this.replayResultText() : null,
    };
  }

  private broadcastState(): void {
    const s = this.buildHud();
    this.lastHud = s;
    this.ctx.hud.broadcast('hud:state', s);
  }

  // ---------------------------------------------------------------- automation

  private waitSettled(): Promise<void> {
    if (this.state === 'idle' || this.state === 'error' || (this.state === 'replay' && this.replay?.phase !== 'playing')) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Plays a book through the real handlers with no RGS and no money movement. */
  private async playBook(raw: unknown): Promise<void> {
    if (this.state !== 'idle') throw new Error(`playBook: flow is ${this.state}`);
    const book = normalizeBook(raw);
    this.message(null);
    this.beginRound();
    this.to('presenting');
    const playback = this.newPlayback();
    try {
      await this.ctx.game.broadcastAsync('round:start', { profile: getSpeedProfile() });
      await this.present(book.events, { record: false, playback });
    } finally {
      await this.finishRound(playback.roundTotal, 'idle');
    }
  }

  private exposeDevApi(): void {
    const hooks = window.__slot;
    if (!hooks) return;
    const tools = import.meta.env.DEV || this.params.capture;
    const state = (): FlowState => this.state;
    const hud = (): FlowHudState | null => this.lastHud;
    const api: FlowDevApi = {
      get state() {
        return state();
      },
      get hud() {
        return hud();
      },
      ready: this.ready,
      spin: () => {
        this.onSpin();
        return this.waitSettled();
      },
    };
    if (tools) {
      api.playBook = (book) => this.playBook(book);
      api.forceBook = (book, bookMode) => {
        this.forced = book === null ? null : { book, bookMode: bookMode ?? null };
      };
    }
    hooks.flow = api;
  }
}
