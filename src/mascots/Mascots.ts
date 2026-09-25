import type { Camera, DataTexture, Material, Mesh, Scene, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Position } from '../book/types';
import { GRID, toPaddedRow, toSpotRow } from '../config/game';
import { cellCenter, type LayoutSpec, type Pt } from '../config/layout';
import { clock } from '../core/clock';
import { s, TIMING } from '../core/timing';
import type { MascotCue } from '../game/events';
import type { GameContext, GameModule } from '../game/context';
import { type MascotDef, MASCOTS, makeRng } from './characters';
import { type LoadedModel, Mascot } from './Mascot';
import type { ClipKey } from './MascotController';
import { createThree } from './threeBridge';
import { makeRampTexture } from './toon';

/** Local reaction / staging tuning (presentation feel, not gameplay pacing). */
const REACT = {
  /** showWins at or above this many x bet (book units x100) => win_big instead of react_small */
  bigWinX: 10,
  /** extra hold (ms) after the last anticipating reel before auto-release */
  anticipationTail: 900,
  /** chance of a sulk expression after a dead spin */
  sulkChance: 0.4,
  /** feet line inside the beam when standing on it (fraction of beam height from its top) */
  beamFooting: 0.3,
  /** free-spin groove BPM for both mascots */
  fsGroove: 112,
  /** seconds both heads stay on a cue's `look` point (the meter), per cue */
  lookSeconds: { bassDropCharge: 1.3, meterHeat: 2, meterThreshold: 1.2, featureLock: 1.6 } as Partial<Record<MascotCue, number>>,
  /** default look hold for any other cue that carries a look point */
  lookDefault: 1.2,
};

/**
 * 3D MASCOTS — two real-time toon-shaded glTF characters flanking the reels.
 *
 * three.js shares Pixi's WebGL2 context (see threeBridge.ts for the verified order), renders
 * each character into its own MSAA render target from the game clock (before Pixi renders),
 * and Pixi composites the RTs as Sprites in `layers.mascots` (in front of the frame posts,
 * behind the HUD). Off entirely in the compact layout (popouts): nothing is rendered.
 *
 * Driven by scene events (round/board/win/big-win/free-spin) and explicit `mascot:cue`s;
 * it never holds the round (handlers return nothing). Big-win celebrations loop until the
 * next scene event that ends the presentation (win:final, board:reveal, fs:update, round:*).
 *
 * Files: threeBridge (shared context + RT->Pixi), toon + ToonOutline (look), Mascot (one
 * character: scene, camera, RT sprite, blob shadow), MascotController (clip contract +
 * crossfades), procedural (breath/look-at/springs/expressions), characters (theme data),
 * placeholderDressing (CC0 robot -> gator/frog props; placeholder only).
 *
 * QA: `__slot.emit('mascot:cue', { cue: 'celebrate' })` (any MascotCue); `?tier=low` for the
 * 30 fps / small-RT path; DEV exposes `window.__mascots` ({ list, cue, module }).
 */
export class Mascots implements GameModule {
  private three: WebGLRenderer | null = null;
  private ramp: DataTexture | null = null;
  private mascots: Mascot[] = [];
  private offs: (() => void)[] = [];
  private enabled = false;
  private accum = 0;
  private dirty = true;
  private anticipationLeft = 0;
  private winsThisRound = 0;
  private turn = 0;
  private readonly rand = makeRng(0x5a3f);

  constructor(private ctx: GameContext) {}

  async init(): Promise<void> {
    try {
      await this.setup();
    } catch (err) {
      // mascots are decoration: a device that can't run them still plays the game
      this.destroy();
      if (import.meta.env.DEV) throw err;
    }
  }

  private async setup(): Promise<void> {
    const { ctx } = this;
    const three = createThree(ctx.app);
    this.three = three;
    this.ramp = makeRampTexture();

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const cache = new Map<string, Promise<LoadedModel>>();
    const load = (def: MascotDef): Promise<LoadedModel> => {
      let p = cache.get(def.url);
      if (!p) {
        p = loader.loadAsync(def.url).then((g) => ({ scene: g.scene, animations: g.animations }));
        cache.set(def.url, p);
      }
      return p;
    };
    const models = await Promise.all(MASCOTS.map(load));
    const ramp = this.ramp;
    this.mascots = MASCOTS.map((def, i) => new Mascot(three, ctx.app, def, models[i], ramp, ctx.budget.mascotRT));
    for (const m of this.mascots) ctx.layers.mascots.addChild(m.view);

    await this.precompile();
    this.layout(ctx.layout);
    this.renderFrame(0);
    for (const m of this.mascots) m.show(this.enabled);

    this.offs.push(clock.onUpdate(this.tick));
    this.bindEvents();
    if (import.meta.env.DEV) window.__mascots = { list: this.mascots, cue: (c: MascotCue) => this.onCue(c), module: this };
  }

  /** Compile toon + ink programs for every mascot off the critical path (KHR_parallel_shader_compile). */
  private async precompile(): Promise<void> {
    const three = this.three;
    if (!three) return;
    const jobs: Promise<unknown>[] = [];
    // without the extension compileAsync only polls (and three warns); plain compile is equivalent
    const parallel = three.extensions.has('KHR_parallel_shader_compile');
    const compile = (scene: Scene, camera: Camera): void => {
      if (parallel) jobs.push(three.compileAsync(scene, camera));
      else three.compile(scene, camera);
    };
    for (const m of this.mascots) {
      const { scene, camera, outline } = m.compileTargets();
      three.resetState();
      // program variants depend on the bound target (output colour space), so compile against the RT
      three.setRenderTarget(m.target.rt);
      compile(scene, camera);
      const saved = new Map<Mesh, Material | Material[]>();
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        saved.set(mesh, mesh.material);
        mesh.material = outline;
      });
      compile(scene, camera);
      for (const [mesh, mat] of saved) mesh.material = mat;
      three.setRenderTarget(null);
      this.ctx.app.renderer.resetState();
    }
    await Promise.all(jobs);
  }

  layout(L: LayoutSpec): void {
    const slots = L.mascots;
    this.enabled = slots !== null;
    const pixelScale = this.ctx.scale * this.ctx.app.renderer.resolution;
    const centre = cellCenter(L, (GRID.reels - 1) / 2, (GRID.rows - 1) / 2);
    const faceOf = (r: { x: number; y: number; w: number; h: number }): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h * 0.35 });
    // a slot whose floor line falls inside the frame beam (portrait) stands ON the beam's top
    const beamTop = L.frame.y;
    const beamBottom = L.frame.y + L.frameParts.beam;
    const ground = (r: { y: number; h: number }): number | undefined => {
      const bottom = r.y + r.h;
      return bottom > beamTop && bottom <= beamBottom + 4 ? beamTop + L.frameParts.beam * REACT.beamFooting : undefined;
    };
    for (const m of this.mascots) {
      const rect = slots ? slots[m.def.side] : null;
      const other = slots ? slots[m.def.side === 'left' ? 'right' : 'left'] : null;
      m.layout(rect, pixelScale, centre, other ? faceOf(other) : null, rect ? ground(rect) : undefined);
      m.show(this.enabled);
    }
    this.dirty = true;
  }

  private readonly tick = (dt: number): void => {
    if (!this.enabled || !this.three || document.hidden) return;
    if (this.anticipationLeft > 0 && (this.anticipationLeft -= dt) <= 0) this.all('release');
    this.accum += dt;
    // low tier renders at 30 fps (every other frame); a frozen clock (hit-stop) renders nothing
    const interval = 1 / this.ctx.budget.mascotRT.fps;
    if (this.accum < interval * 0.75 && !this.dirty) return;
    const step = this.accum;
    this.accum = 0;
    this.dirty = false;
    this.renderFrame(step);
  };

  private renderFrame(dt: number): void {
    const three = this.three;
    if (!three || !this.enabled) return;
    three.resetState();
    for (const m of this.mascots) {
      m.update(dt);
      m.render(three);
    }
    three.setRenderTarget(null);
    this.ctx.app.renderer.resetState();
  }

  // ---------------------------------------------------------------- events

  private bindEvents(): void {
    const g = this.ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('mascot:cue', ({ cue, intensity, look }) => {
        if (look) for (const m of this.mascots) m.lookAt(look, REACT.lookSeconds[cue] ?? REACT.lookDefault);
        this.onCue(cue, intensity);
      }),
      g.on('round:start', () => {
        this.winsThisRound = 0;
        this.anticipationLeft = 0;
        this.onCue('spinStart');
      }),
      g.on('board:reveal', ({ anticipation }) => {
        // a new board (next free spin) ends any held celebration
        this.releaseHeld();
        const reels = anticipation.map((a, i) => (a > 0 ? i : -1)).filter((i) => i >= 0);
        if (!reels.length) return;
        this.lookAtCells([{ reel: reels[0], row: toPaddedRow(Math.floor((GRID.rows - 1) / 2)) }], 3);
        this.onCue('anticipation');
        this.anticipationLeft = s(reels.length * TIMING.anticipation.holdPerColumn + REACT.anticipationTail);
      }),
      g.on('board:showWins', ({ wins, totalWin }) => {
        this.anticipationLeft = 0;
        const best = wins.reduce((a, b) => (b.win > a.win ? b : a), wins[0]);
        if (best) this.lookAtCells(best.positions, 2.2);
        this.winsThisRound++;
        if (totalWin >= REACT.bigWinX * 100) this.onCue('winBig');
        else this.onCue(this.winsThisRound === 1 ? 'reactSmall' : 'reactTumble');
      }),
      g.on('board:tumble', ({ exploding }) => this.lookAtCells(exploding, 1.2)),
      g.on('spots:update', () => this.onCue('spotUpgrade')),
      g.on('bigwin:show', () => this.onCue('celebrate')),
      g.on('fs:trigger', ({ positions }) => {
        this.lookAtCells(positions, 2.5);
        this.onCue('fsTrigger');
      }),
      g.on('fs:update', () => this.releaseHeld()),
      g.on('win:final', () => this.releaseHeld()),
      g.on('fs:end', () => this.onCue('fsEnd')),
      g.on('mode:change', ({ gameType }) => {
        // the club gets hotter in free spins: both mascots groove to the beat
        for (const m of this.mascots) m.procedural.setGroove(gameType === 'freegame' ? REACT.fsGroove : m.def.persona.groove);
      }),
      g.on('round:end', ({ totalWin }) => {
        this.anticipationLeft = 0;
        this.all('release');
        if (totalWin === 0 && this.rand() < REACT.sulkChance) {
          const [a, b] = this.mascots;
          a?.flash('angry', 0.45, 1.1);
          b?.flash('sad', 0.5, 1.3);
        }
      }),
    );
  }

  /** Map a scene cue to per-mascot clips (staggered by each character's react delay). */
  private onCue(cue: MascotCue, intensity = 1): void {
    const [left, right] = this.mascots;
    switch (cue) {
      case 'idle':
        this.all('release');
        break;
      case 'spinStart':
        for (const m of this.mascots) {
          m.cue('release', m.def.reactDelay);
          m.procedural.leanKick(0.12 * intensity);
          m.procedural.nodKick(0.5);
        }
        break;
      case 'anticipation':
        this.all('anticipation');
        break;
      case 'reactSmall':
        this.all('react_small');
        break;
      case 'reactTumble': {
        // alternate who cheers so a long tumble chain doesn't look robotic
        const [who, other] = this.turn++ % 2 === 0 ? [left, right] : [right, left];
        who?.cue('react_small', 0);
        other?.procedural.nodKick(0.8);
        break;
      }
      case 'spotUpgrade':
        for (const m of this.mascots) m.procedural.nodKick(0.6 * intensity);
        break;
      case 'winBig':
        this.all('win_big');
        break;
      case 'celebrate':
        this.all('celebrate');
        for (const m of this.mascots) m.lookAt('player', 1.5);
        break;
      case 'fsTrigger':
        this.all('fs_trigger');
        break;
      case 'fsEnd':
        this.all('fs_end');
        break;
      // ---- Groove Meter / Bass Drop cues (DESIGN bass-drop §16) on the 3D clip set ----
      case 'meterHeat':
        // Gumbo glances at the stack / Croak leans on the fader: the held lean-in loop,
        // until meterHeat {intensity: 0}, the next reveal or the round end
        if (intensity <= 0) this.all('release');
        else this.all('anticipation');
        break;
      case 'meterThreshold': {
        // minor notch (intensity = notch / 6): Gumbo points at the meter, Croak nods along
        const k = Math.max(0, Math.min(1, intensity));
        left?.cue('react_small', left.def.reactDelay);
        right?.procedural.nodKick(0.6 + 0.9 * k);
        if (k >= 0.5) right?.cue('react_small', right.def.reactDelay);
        break;
      }
      case 'bassDropCharge':
        // Gumbo braces (squash down, wide eyes); Croak leans in over the drop button
        left?.procedural.flinch(0.9 * intensity);
        left?.flash('surprised', 0.8, 0.6);
        right?.procedural.leanKick(0.28 * intensity);
        right?.procedural.nodKick(-0.8 * intensity);
        right?.flash('angry', 0.5, 0.6);
        break;
      case 'bassDrop':
        // the boom: Gumbo is blown back, Croak follows through (headphones bounce)
        left?.procedural.hop(1.1 * intensity);
        left?.procedural.nodKick(-1.6 * intensity);
        left?.flash('surprised', 1, 0.9);
        right?.procedural.hop(0.8 * intensity);
        right?.procedural.nodKick(1.8 * intensity);
        right?.cue('react_small', right.def.reactDelay);
        right?.flash('happy', 0.9, 1);
        break;
      case 'wildLand':
        // wild_land_react overlay: a flinch + nod on both, no clip change
        for (const m of this.mascots) {
          m.procedural.flinch(0.55 * intensity);
          m.procedural.nodKick(0.7 * intensity);
        }
        break;
      case 'featureLock':
        // 1 = 40 locked (Juke Jam), 2 = 60 locked (Mega Mix)
        this.all(intensity >= 1.5 ? 'win_big' : 'react_small');
        break;
      case 'featureUpgrade':
        left?.cue('win_big', left.def.reactDelay);
        right?.cue('fs_trigger', right.def.reactDelay);
        break;
    }
  }

  /** Drop held loops (celebrate / anticipation / bored) — the presentation they belonged to is over. */
  private releaseHeld(): void {
    this.anticipationLeft = 0;
    this.all('release');
  }

  private all(key: ClipKey | 'release'): void {
    for (const m of this.mascots) m.cue(key, key === 'release' ? 0 : m.def.reactDelay);
  }

  private lookAtCells(positions: readonly Position[], seconds: number): void {
    if (!positions.length) return;
    const L = this.ctx.layout;
    let x = 0;
    let y = 0;
    for (const p of positions) {
      const c = cellCenter(L, p.reel, Math.max(0, Math.min(GRID.rows - 1, toSpotRow(p.row))));
      x += c.x;
      y += c.y;
    }
    const pt = { x: x / positions.length, y: y / positions.length };
    for (const m of this.mascots) m.lookAt(pt, seconds);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    const three = this.three;
    if (three) three.resetState();
    for (const m of this.mascots) m.destroy();
    this.mascots = [];
    this.ramp?.dispose();
    this.ramp = null;
    if (three) {
      three.setRenderTarget(null);
      three.dispose();
      this.ctx.app.renderer.resetState();
    }
    this.three = null;
    if (import.meta.env.DEV) delete window.__mascots;
  }
}

declare global {
  interface Window {
    /** DEV only: mascot handles for look-dev / capture scripts. */
    __mascots?: { list: Mascot[]; cue: (c: MascotCue) => void; module: Mascots };
  }
}
