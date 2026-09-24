import { type FolderApi, Pane, type TabPageApi } from 'tweakpane';
import timingSource from '../core/timing.ts?raw';
import { SYMBOLS, SYMBOL_IDS, WIN_TIERS } from '../config/game';
import { clock } from '../core/clock';
import { getSpeedProfile, setSpeedProfile, type SpeedProfile, TIMING, TIMING_SECTIONS } from '../core/timing';
import type { GameContext } from '../game/context';
import type { SymbolGallery } from './gallery';
import type { DevSlotHooks } from './hooks';
import type { InspectorPlacement } from './inspector';
import { BURST_KINDS, MASCOT_CUES } from './scenarios';
import {
  changedLeaves,
  CORE_SECTION,
  exportTimingSource,
  isColorLeaf,
  onTimingChange,
  rangeFor,
  resetTiming,
  saveTimingEdit,
  sectionsJson,
} from './timingEdit';

/**
 * DEV-ONLY Tweakpane UI for the animation lab. Docked right; while expanded the
 * game canvas is narrowed so the pane never covers the grid.
 *
 * Tabs: PLAY (transport + scenarios) · TIMING (every TIMING leaf, export) ·
 * SYMBOL (single-symbol inspector). Shortcuts: P pause/resume, . step one frame.
 */

const PANE_WIDTH = 320;
const DOCK_GAP = 16;
const FRAME_MS = 1000 / 60;
const MONITOR_INTERVAL = 250;

const THEME: Record<string, string> = {
  '--tp-base-background-color': 'hsla(228, 28%, 9%, 0.96)',
  '--tp-base-shadow-color': 'hsla(0, 0%, 0%, 0.45)',
  '--tp-base-font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  '--tp-button-background-color': 'hsla(222, 26%, 62%, 0.16)',
  '--tp-button-background-color-active': 'hsla(190, 70%, 60%, 0.55)',
  '--tp-button-background-color-focus': 'hsla(190, 60%, 60%, 0.34)',
  '--tp-button-background-color-hover': 'hsla(190, 60%, 60%, 0.26)',
  '--tp-button-foreground-color': 'hsla(210, 60%, 94%, 0.95)',
  '--tp-container-background-color': 'hsla(228, 22%, 70%, 0.08)',
  '--tp-container-background-color-active': 'hsla(228, 22%, 70%, 0.2)',
  '--tp-container-background-color-focus': 'hsla(228, 22%, 70%, 0.16)',
  '--tp-container-background-color-hover': 'hsla(228, 22%, 70%, 0.12)',
  '--tp-container-foreground-color': 'hsla(215, 40%, 88%, 0.9)',
  '--tp-groove-foreground-color': 'hsla(228, 22%, 70%, 0.12)',
  '--tp-input-background-color': 'hsla(228, 22%, 70%, 0.1)',
  '--tp-input-background-color-active': 'hsla(228, 22%, 70%, 0.24)',
  '--tp-input-background-color-focus': 'hsla(228, 22%, 70%, 0.2)',
  '--tp-input-background-color-hover': 'hsla(228, 22%, 70%, 0.16)',
  '--tp-input-foreground-color': 'hsla(215, 50%, 92%, 0.95)',
  '--tp-label-foreground-color': 'hsla(215, 25%, 72%, 0.8)',
  '--tp-monitor-background-color': 'hsla(228, 30%, 4%, 0.5)',
  '--tp-monitor-foreground-color': 'hsla(160, 60%, 70%, 0.85)',
  '--tp-blade-value-width': '150px',
};

export interface LabPaneOptions {
  ctx: GameContext;
  hooks: DevSlotHooks;
  mode: 'lab' | 'gallery';
  gallery: SymbolGallery | null;
  /** re-applies the lab's idle board (lab mode) */
  resetScene: () => Promise<void>;
}

export class LabPane {
  private readonly pane: Pane;
  private readonly host: HTMLDivElement;
  private readonly status = { message: 'ready', running: 'idle', time: '0.000 s', fps: 0, changed: 0 };
  private readonly transport = { profile: getSpeedProfile() as SpeedProfile, slowmo: 1, paused: false };
  private readonly insp = {
    id: 'H1',
    velocity: 4200,
    magnify: 2,
    placement: 'left' as InspectorPlacement,
    blurWhileFalling: true,
    anticipation: false,
    dim: false,
    blur: false,
    state: '',
  };

  constructor(private readonly o: LabPaneOptions) {
    this.host = document.createElement('div');
    this.host.id = 'lab-pane';
    this.host.style.cssText = `position:fixed;top:8px;right:8px;width:${PANE_WIDTH}px;max-height:calc(100vh - 16px);overflow-y:auto;z-index:1000;scrollbar-width:thin;`;
    for (const [k, v] of Object.entries(THEME)) this.host.style.setProperty(k, v);
    document.body.appendChild(this.host);

    this.pane = new Pane({ container: this.host, title: o.mode === 'gallery' ? 'SYMBOL GALLERY' : 'ANIMATION LAB' });
    const tabs = this.pane.addTab({
      pages: o.mode === 'gallery' ? [{ title: 'Play' }, { title: 'Timing' }] : [{ title: 'Play' }, { title: 'Timing' }, { title: 'Symbol' }],
    });
    this.buildPlay(tabs.pages[0]);
    this.buildTiming(tabs.pages[1]);
    if (tabs.pages[2]) this.buildSymbol(tabs.pages[2]);

    this.pane.on('fold', (ev) => this.dock(ev.expanded));
    onTimingChange(() => {
      this.pane.refresh();
      this.status.changed = changedLeaves().length;
    });
    this.status.changed = changedLeaves().length;
    window.addEventListener('keydown', this.onKey);
    this.dock(true);
  }

  // -------------------------------------------------------------------- PLAY

  private buildPlay(page: TabPageApi): void {
    const t = page.addFolder({ title: 'Transport' });
    t.addBinding(this.transport, 'profile', {
      label: 'speed',
      options: { normal: 'normal', turbo: 'turbo', superTurbo: 'superTurbo' },
    }).on('change', (ev) => {
      setSpeedProfile(ev.value);
      this.o.gallery?.restart();
    });
    t.addBinding(this.transport, 'slowmo', { label: 'slow-mo', min: 0.05, max: 1, step: 0.05 }).on('change', (ev) => {
      this.o.hooks.slowmo(ev.value);
    });
    t.addButton({ title: 'Pause / Resume  (P)' }).on('click', () => this.togglePause());
    t.addButton({ title: 'Step 1 frame  (.)' }).on('click', () => this.step(1));
    t.addButton({ title: 'Step 10 frames' }).on('click', () => this.step(10));
    t.addBinding(this.status, 'time', { label: 'game time', readonly: true, interval: MONITOR_INTERVAL });
    t.addBinding(this.status, 'fps', {
      readonly: true,
      interval: MONITOR_INTERVAL,
      format: (v: number) => v.toFixed(0),
    });

    if (this.o.mode === 'lab') {
      const groups: Array<[string, string]> = [
        ['board', 'Board scenarios'],
        ['present', 'Presentation'],
        ['fx', 'FX'],
        ['symbol', 'Inspector scenarios'],
      ];
      for (const [group, title] of groups) {
        const f = page.addFolder({ title, expanded: group === 'board' });
        for (const sc of this.o.hooks.scenarios().filter((d) => d.group === group)) {
          f.addButton({ title: sc.label }).on('click', () => this.run(sc.name));
        }
        if (group === 'present') {
          const tiers = f.addFolder({ title: 'Big win tier', expanded: false });
          for (const tier of WIN_TIERS) {
            tiers.addButton({ title: tier.label }).on('click', () => this.run('bigWin', { tiers: [tier.key] }));
          }
          const cues = f.addFolder({ title: 'Mascot cue', expanded: false });
          for (const cue of MASCOT_CUES) {
            cues.addButton({ title: cue }).on('click', () => this.run('mascots', { cues: [cue] }));
          }
        }
        if (group === 'fx') {
          const kinds = f.addFolder({ title: 'Burst kind', expanded: false });
          for (const kind of BURST_KINDS) {
            kinds.addButton({ title: kind }).on('click', () => this.run('particles', { kinds: [kind] }));
          }
        }
      }
      page.addButton({ title: 'Reset scene' }).on('click', () => {
        void this.o.resetScene().then(() => this.say('scene reset'));
      });
    }
    page.addBinding(this.status, 'running', { readonly: true, interval: MONITOR_INTERVAL });
    page.addBinding(this.status, 'message', { label: 'status', readonly: true, interval: MONITOR_INTERVAL });

    clock.onUpdate(() => {
      this.status.time = `${clock.time.toFixed(3)} s`;
      this.status.fps = this.o.ctx.app.ticker.FPS;
      this.status.running = this.o.hooks.running() ?? 'idle';
      if (this.o.mode === 'lab') this.insp.state = this.o.hooks.inspector().state;
    });
  }

  private run(name: string, opts: Parameters<DevSlotHooks['scenario']>[1] = {}): void {
    this.say(`▶ ${name}`);
    this.o.hooks
      .scenario(name, opts)
      .then((r) => this.say(`✔ ${name} ${(r.durationMs / 1000).toFixed(2)} s · ${r.events.length} events`))
      .catch((err: unknown) => this.say(`✖ ${name}: ${err instanceof Error ? err.message : String(err)}`));
  }

  private togglePause(): void {
    this.transport.paused = !clock.isManual;
    clock.setManual(this.transport.paused);
    this.say(this.transport.paused ? 'paused' : 'running');
  }

  private step(frames: number): void {
    if (!clock.isManual) {
      clock.setManual(true);
      this.transport.paused = true;
    }
    for (let i = 0; i < frames; i++) clock.step(FRAME_MS);
    this.status.time = `${clock.time.toFixed(3)} s`;
    this.pane.refresh();
  }

  // ------------------------------------------------------------------ TIMING

  private buildTiming(page: TabPageApi): void {
    page.addBinding(this.status, 'changed', {
      label: 'overrides',
      readonly: true,
      interval: MONITOR_INTERVAL,
      format: (v: number) => v.toFixed(0),
    });
    page.addButton({ title: 'Export → timing.ts + sections JSON' }).on('click', () => this.exportTiming());
    page.addButton({ title: 'Reset to compiled defaults' }).on('click', () => {
      resetTiming();
      this.say('timing reset');
    });

    // core TIMING: one folder per top-level group (strings = eases, editable as text)
    const core = page.addFolder({ title: `${CORE_SECTION} (TIMING)`, expanded: true });
    const root = TIMING as unknown as Record<string, unknown>;
    for (const group of Object.keys(root)) {
      const f = core.addFolder({ title: group, expanded: group === 'land' });
      this.bindNode(f, root[group] as Record<string, unknown>, group, true);
    }
    // module sections registered via registerTiming(): numeric leaves only
    for (const [name, table] of Object.entries(TIMING_SECTIONS)) {
      if (name === CORE_SECTION) continue;
      const f = page.addFolder({ title: name, expanded: false });
      this.bindNode(f, table, name, false);
    }
  }

  /** Binds leaves under `node`; `path` is the qualified path prefix (bare for core). */
  private bindNode(folder: FolderApi, node: Record<string, unknown> | readonly unknown[], path: string, strings: boolean): number {
    let bound = 0;
    for (const key of Object.keys(node)) {
      const value = (node as Record<string, unknown>)[key];
      const leafPath = `${path}.${key}`;
      const label = Array.isArray(node) ? `[${key}]` : key;
      if (typeof value === 'object' && value !== null) {
        const sub = folder.addFolder({ title: key, expanded: false });
        const n = this.bindNode(sub, value as Record<string, unknown>, leafPath, strings);
        if (n === 0) folder.remove(sub);
        bound += n;
        continue;
      }
      const target = node as Record<string, unknown>;
      let binding;
      if (typeof value === 'number' && isColorLeaf(leafPath)) {
        binding = folder.addBinding(target, key, { label, view: 'color' });
      } else if (typeof value === 'number') {
        binding = folder.addBinding(target, key, { label, ...rangeFor(leafPath, value) });
      } else if (typeof value === 'string' && strings) {
        binding = folder.addBinding(target, key, { label });
      } else continue;
      bound++;
      binding.on('change', () => {
        saveTimingEdit();
        this.status.changed = changedLeaves().length;
      });
    }
    return bound;
  }

  private download(name: string, text: string, type: string): void {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  /**
   * timing.ts = the patched core TIMING source; timing-sections.json = every
   * registered section ({core, board, symbol, ...}) to paste back into its owner
   * file. The sections JSON is also copied to the clipboard.
   */
  private exportTiming(): void {
    const { text, patched } = exportTimingSource(timingSource);
    const json = sectionsJson();
    this.download('timing.ts', text, 'text/typescript');
    this.download('timing-sections.json', json, 'application/json');
    const n = changedLeaves().length;
    const what = patched ? 'timing.ts (patched source)' : 'TIMING literal';
    navigator.clipboard
      .writeText(json)
      .then(() => this.say(`exported ${what} + sections, ${n} changed · JSON copied`))
      .catch(() => this.say(`exported ${what} + sections, ${n} changed · clipboard blocked`));
  }

  // ------------------------------------------------------------------ SYMBOL

  private buildSymbol(page: TabPageApi): void {
    const insp = this.o.hooks.inspector();
    const sync = () => {
      insp.id = this.insp.id;
      insp.velocity = this.insp.velocity;
      insp.magnify = this.insp.magnify;
      insp.placement = this.insp.placement;
      insp.blurWhileFalling = this.insp.blurWhileFalling;
      insp.show(this.insp.id);
      insp.refresh();
    };
    const ids = Object.fromEntries(SYMBOL_IDS.map((id) => [`${id} ${SYMBOLS[id].label}`, id]));
    page.addBinding(this.insp, 'id', { label: 'symbol', options: ids }).on('change', sync);
    page.addBinding(this.insp, 'velocity', { label: 'impact v', min: 200, max: 8000, step: 50 }).on('change', sync);
    page.addBinding(this.insp, 'magnify', { min: 1, max: 3, step: 0.1 }).on('change', sync);
    page.addBinding(this.insp, 'placement', {
      options: { left: 'left', center: 'center', right: 'right' },
    }).on('change', sync);
    page.addBinding(this.insp, 'blurWhileFalling', { label: 'fall blur' }).on('change', sync);

    const act = page.addFolder({ title: 'Actions' });
    const call = (name: string, fn: () => Promise<void>) => {
      sync();
      fn().catch((err: unknown) => this.say(`✖ ${name}: ${err instanceof Error ? err.message : String(err)}`));
    };
    act.addButton({ title: 'Land (drop from v)' }).on('click', () => call('land', () => insp.land(this.insp.velocity)));
    act.addButton({ title: 'Win' }).on('click', () => call('win', () => insp.win()));
    act.addButton({ title: 'Explode' }).on('click', () => call('explode', () => insp.explode()));
    act.addButton({ title: 'Idle accent' }).on('click', () => call('idle', () => insp.idleAccent()));
    act.addBinding(this.insp, 'anticipation').on('change', (ev) => call('anticipation', () => insp.setAnticipation(ev.value)));
    act.addBinding(this.insp, 'dim').on('change', (ev) => call('dim', () => insp.setDim(ev.value)));
    act.addBinding(this.insp, 'blur').on('change', (ev) => call('blur', () => insp.setBlur(ev.value)));
    act.addButton({ title: 'Reset' }).on('click', () => {
      this.insp.anticipation = this.insp.dim = this.insp.blur = false;
      this.pane.refresh();
      call('reset', () => insp.reset());
    });
    act.addButton({ title: 'Hide inspector' }).on('click', () => insp.hide());
    act.addBinding(this.insp, 'state', { readonly: true, interval: MONITOR_INTERVAL });
  }

  // ------------------------------------------------------------------ misc

  /** Show a message in the status monitor. */
  notify(message: string): void {
    this.say(message);
  }

  private say(message: string): void {
    this.status.message = message;
  }

  /** Narrows the game canvas (and DOM UI root) so the expanded pane never covers the grid. */
  private dock(expanded: boolean): void {
    const inset = expanded ? `${PANE_WIDTH + DOCK_GAP}px` : '0px';
    for (const id of ['app', 'ui-root']) {
      const el = document.getElementById(id);
      if (el) el.style.right = inset;
    }
    const app = document.getElementById('app');
    if (app) this.o.ctx.app.resizeTo = app;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'p' || e.key === 'P') this.togglePause();
    else if (e.key === '.') this.step(1);
    else return;
    e.preventDefault();
  };

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.pane.dispose();
    this.host.remove();
  }
}
