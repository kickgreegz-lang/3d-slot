import { type Application, Container, Graphics, Sprite } from 'pixi.js';
import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  type Material,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Pt, Rect } from '../config/layout';
import { speedScale } from '../core/timing';
import type { TierBudget } from '../env/tier';
import { type MascotDef, makeRng } from './characters';
import { type ClipKey, MascotController } from './MascotController';
import { type Dressing, dressPlaceholder } from './placeholderDressing';
import { type Expr, findBones, ProceduralLayers } from './procedural';
import { RenderTargetView } from './threeBridge';
import { addToonLights, bakeOutlineNormals, toonify } from './toon';
import { ToonOutline } from './ToonOutline';

/** Framing of a character inside its render target (all local look-dev constants). */
export const FRAME = {
  /** RT width / height (pixel count stays within the tier budget's w*h) */
  aspect: 0.9,
  /** vertical field of view (deg): narrow = flatter, closer to the 2D art */
  fov: 20,
  /** standing height as a fraction of the RT height (the rest is jump/arm headroom) */
  fill: 0.72,
  /** feet line above the RT bottom (fraction of RT height) */
  feet: 0.06,
  /** standing height as a fraction of the layout slot height */
  slotFill: 0.98,
  /** idle silhouette width as a fraction of the slot width (keeps snouts/tails off the reels) */
  slotWidth: 0.92,
  /** ink width in DESIGN px (2D symbols use ~4 px at 150 px cells) */
  outlinePx: 3.4,
  /** look targets sit this many body heights in front of the reel plane */
  lookDepth: 1.1,
  /** blob shadow half-width as a fraction of standing height */
  shadow: 0.3,
};

export interface LoadedModel {
  scene: Object3D;
  animations: AnimationClip[];
}

type Focus =
  | { kind: 'board'; x: number; y: number }
  | { kind: 'player' }
  | { kind: 'point'; x: number; y: number };

interface PendingCue {
  key: ClipKey | 'release';
  left: number;
}

/**
 * One flanking 3D mascot: toon-shaded glTF in its own scene/camera, rendered into a
 * multisampled render target that Pixi shows as a Sprite (plus a cel blob shadow).
 */
export class Mascot {
  readonly view: Container;
  readonly controller: MascotController;
  readonly procedural: ProceduralLayers;
  readonly target: RenderTargetView;

  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly placement = new Group();
  private readonly build = new Group();
  private readonly model: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly outline = new ToonOutline();
  private readonly materials: Material[];
  private readonly dressing: Dressing | null;
  private readonly sprite: Sprite;
  private readonly shadow: Graphics;
  private readonly rand: () => number;
  /** idle silhouette in world units (camera-aligned): standing height, width, x centre */
  private readonly height: number;
  private readonly width: number;
  private readonly centerX: number;
  private readonly aspect: number;
  private readonly maxH: number;

  private rect: Rect | null = null;
  private displayH = 0;
  private feetX = 0;
  private wantSize: { w: number; h: number } | null = null;
  private pending: PendingCue[] = [];
  private focus: Focus = { kind: 'board', x: 0, y: 0 };
  private focusLeft = 0;
  private glanceLeft = 1;
  private boardCentre: Pt = { x: 0, y: 0 };
  private friend: Pt | null = null;

  constructor(
    three: WebGLRenderer,
    app: Application,
    readonly def: MascotDef,
    source: LoadedModel,
    ramp: Texture,
    budget: TierBudget['mascotRT'],
  ) {
    this.rand = makeRng(def.seed);
    this.aspect = FRAME.aspect;
    this.maxH = Math.round(Math.sqrt((budget.w * budget.h) / this.aspect));

    this.model = cloneSkinned(source.scene);
    this.dressing = def.dress ? dressPlaceholder(this.model, def.dress.kind, def.dress.colors) : null;
    this.materials = toonify(this.model, ramp, def.palette);
    this.model.traverse((o) => {
      if ((o as Mesh).isMesh) bakeOutlineNormals((o as Mesh).geometry);
    });
    this.placement.rotation.y = def.facing;
    this.build.scale.set(def.build.width, def.build.height, def.build.width);
    this.placement.add(this.build);
    this.build.add(this.model);
    this.scene.add(this.placement);

    // settle into the first idle frame, then measure the silhouette (world = camera axes) and ground the feet
    this.mixer = new AnimationMixer(this.model);
    this.controller = new MascotController(this.mixer, source.animations, def.tempo, this.rand, def.idlePhase);
    this.mixer.update(0);
    this.placement.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.model, true);
    this.height = Math.max(1e-3, box.max.y - box.min.y);
    this.width = Math.max(1e-3, box.max.x - box.min.x);
    this.centerX = (box.max.x + box.min.x) / 2;
    this.model.position.y = -box.min.y / def.build.height;
    this.placement.updateMatrixWorld(true);

    const lightTarget = new Group();
    lightTarget.position.set(0, this.height * 0.6, 0);
    this.scene.add(lightTarget);
    addToonLights(this.scene, lightTarget);

    this.camera = new PerspectiveCamera(FRAME.fov, this.aspect, 0.1, 100);
    this.frameCamera();

    this.procedural = new ProceduralLayers(
      { placement: this.placement, build: this.build, model: this.model, bones: findBones(this.model), height: this.height },
      def.persona,
      this.rand,
    );
    this.procedural.setBuild(def.build.width, def.build.height);
    this.procedural.calibrate();

    this.target = new RenderTargetView(three, app, this.widthFor(this.maxH), this.maxH, budget.samples);
    this.sprite = new Sprite(this.target.texture);
    this.sprite.anchor.set(0.5, FRAME.feet);
    this.sprite.label = `${def.id}:rt`;
    this.shadow = new Graphics()
      .ellipse(0, 0, 1, 0.24)
      .fill({ color: 0x12061c, alpha: 0.22 })
      .ellipse(0, 0, 0.7, 0.17)
      .fill({ color: 0x12061c, alpha: 0.32 });
    this.shadow.label = `${def.id}:shadow`;
    this.view = new Container({ label: `mascot:${def.id}` });
    this.view.addChild(this.shadow, this.sprite);
    this.view.visible = false;
  }

  /** Materials of both passes, for three.compileAsync() before the first frame. */
  compileTargets(): { scene: Scene; camera: PerspectiveCamera; outline: Material } {
    return { scene: this.scene, camera: this.camera, outline: this.outline.material };
  }

  /**
   * Place in a layout slot (feet at the rect's bottom-centre, standing height ~ rect height).
   * `pixelScale` = design px -> physical px (root scale * renderer resolution).
   */
  layout(rect: Rect | null, pixelScale: number, boardCentre: Pt, friend: Pt | null): void {
    this.rect = rect;
    this.boardCentre = boardCentre;
    this.friend = friend;
    if (!rect) {
      this.view.visible = false;
      return;
    }
    // fit the idle silhouette into the slot (height AND width), then centre it horizontally
    const charPx = Math.min(rect.h * FRAME.slotFill, (rect.w * FRAME.slotWidth * this.height) / this.width);
    const pxPerUnit = charPx / this.height;
    this.displayH = charPx / FRAME.fill;
    this.feetX = rect.x + rect.w / 2 - this.centerX * pxPerUnit;
    // RT no bigger than it is on screen (and never above the tier budget)
    const h = Math.max(128, Math.min(this.maxH, Math.ceil((this.displayH * pixelScale) / 32) * 32));
    const w = this.widthFor(h);
    this.wantSize = { w, h };
    this.view.position.set(this.feetX, rect.y + rect.h);
    this.applySpriteScale(this.target.width, this.target.height); // re-applied after the RT resize
    const sw = this.displayH * FRAME.fill * FRAME.shadow;
    this.shadow.scale.set(sw, sw);
    if (this.focus.kind === 'board') this.focus = { kind: 'board', x: boardCentre.x, y: boardCentre.y };
  }

  /** Visible once it has a slot and a rendered frame. */
  show(on: boolean): void {
    this.view.visible = on && this.rect !== null;
  }

  get active(): boolean {
    return this.rect !== null;
  }

  /** Queue a clip after `delayMs` (game time). */
  cue(key: ClipKey | 'release', delayMs = 0): void {
    this.pending.push({ key, left: delayMs / 1000 });
  }

  /** Look at a design-space point for `seconds` (then resume idle glances). */
  lookAt(p: Pt | 'player', seconds = 2.5): void {
    this.focus = p === 'player' ? { kind: 'player' } : { kind: 'point', x: p.x, y: p.y };
    this.focusLeft = seconds;
  }

  flash(e: Expr, weight: number, seconds: number): void {
    this.procedural.flashExpr(e, weight, seconds);
  }

  update(dt: number): void {
    // un-offset first: actions started below bind (and snapshot) clean bone values
    this.procedural.restore();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.left -= dt;
      if (p.left > 0) continue;
      this.pending.splice(i, 1);
      this.fire(p.key);
    }
    this.updateFocus(dt);
    this.controller.update(dt);
    this.mixer.update(dt * speedScale());
    this.placement.updateMatrixWorld(true);
    this.procedural.apply(dt, this.controller.state, this.controller.stateTime);
    const lift = Math.min(0.6, this.procedural.lift * 1.8);
    this.shadow.alpha = 1 - lift;
    const sw = this.displayH * FRAME.fill * FRAME.shadow * (1 - lift * 0.6);
    this.shadow.scale.set(sw, sw);
  }

  /** Render into the RT. Call between three.resetState() and app.renderer.resetState(). */
  render(three: WebGLRenderer): void {
    if (this.wantSize) {
      const { w, h } = this.wantSize;
      this.wantSize = null;
      this.target.resize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.applySpriteScale(w, h);
    }
    this.outline.setWidth((FRAME.outlinePx * this.target.height) / Math.max(1, this.displayH), this.target.height, this.camera);
    three.setRenderTarget(this.target.rt);
    three.setClearColor(0x000000, 0);
    three.clear();
    this.outline.render(three, this.scene, this.camera, this.dressing?.glints);
  }

  destroy(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.materials) m.dispose();
    for (const m of this.dressing?.materials ?? []) m.dispose();
    for (const g of this.dressing?.geometries ?? []) g.dispose();
    this.outline.dispose();
    this.view.destroy({ children: true });
    this.target.destroy();
  }

  private fire(key: ClipKey | 'release'): void {
    if (key === 'release') {
      this.controller.release();
      return;
    }
    this.controller.poke();
    this.controller.play(key);
    if (key === 'react_small' || key === 'fs_end') this.procedural.hop(0.6);
    if (key === 'win_big' || key === 'fs_trigger') this.procedural.hop(1);
    if (key === 'anticipation') this.procedural.flinch(0.5);
  }

  private widthFor(h: number): number {
    return Math.round((h * this.aspect) / 2) * 2;
  }

  private applySpriteScale(w: number, h: number): void {
    if (!this.displayH) return;
    const dh = this.displayH;
    this.sprite.scale.set((dh * this.aspect) / w, -dh / h);
  }

  private frameCamera(): void {
    const frameH = this.height / FRAME.fill;
    const dist = frameH / 2 / Math.tan((FRAME.fov * Math.PI) / 360);
    const y = (0.5 - FRAME.feet) * frameH;
    this.camera.position.set(0, y, dist);
    this.camera.near = dist * 0.3;
    this.camera.far = dist * 3;
    this.camera.lookAt(0, y, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Idle glances between the board, the other mascot and the player; explicit focus wins. */
  private updateFocus(dt: number): void {
    const state = this.controller.state;
    if (this.focusLeft > 0) {
      this.focusLeft -= dt;
    } else if (state === 'celebrate' || state === 'fs_trigger') {
      this.focus = { kind: 'player' };
    } else if ((this.glanceLeft -= dt) <= 0) {
      const r = this.rand();
      this.glanceLeft = 2.5 + this.rand() * 4.5;
      if (r < 0.14) this.focus = { kind: 'player' };
      else if (r < 0.24 && this.friend) this.focus = { kind: 'point', x: this.friend.x, y: this.friend.y };
      else {
        const L = this.boardCentre;
        this.focus = { kind: 'board', x: L.x + (this.rand() - 0.5) * 700, y: L.y + (this.rand() - 0.5) * 420 };
      }
    }
    const out = this.procedural.lookTarget;
    if (this.focus.kind === 'player') {
      out.copy(this.camera.position);
    } else {
      this.designToWorld(this.focus.x, this.focus.y, out);
    }
    this.placement.worldToLocal(out);
    this.procedural.lookWeight = state === 'idle_bored' ? 0.35 : 1;
  }

  /** Unproject a design-space point onto a plane in front of the character (world space). */
  private designToWorld(x: number, y: number, out: Vector3): Vector3 {
    const rect = this.rect;
    if (!rect || !this.displayH) return out.set(0, this.height * 0.8, this.height * 4);
    const feetX = this.feetX;
    const feetY = rect.y + rect.h;
    const ndcX = (2 * (x - feetX)) / (this.displayH * this.aspect);
    const ndcY = 2 * (FRAME.feet + (feetY - y) / this.displayH) - 1;
    const z = this.height * FRAME.lookDepth;
    const halfH = (this.camera.position.z - z) * Math.tan((FRAME.fov * Math.PI) / 360);
    return out.set(ndcX * halfH * this.aspect, this.camera.position.y + ndcY * halfH, z);
  }
}

