import { MeshPlane, Texture } from 'pixi.js';
import { SymbolFxShader } from './symbolFxShader';
import { SYMBOL_TIMING } from './symbolTiming';

/**
 * Where the texture sits inside the symbol rig. Art-local space = texture units
 * with the origin at the content centre; the art container applies `k` and `angle`.
 * Pose space = art space rotated/scaled, origin at the content centre, +y down.
 */
export interface JellyFrame {
  /** content centre in texture units */
  cx: number;
  cy: number;
  /** texture units -> design px */
  k: number;
  /** rest angle (radians) */
  angle: number;
  /** lowest (feet, > 0) and highest (< 0) content point in pose space */
  feetY: number;
  topY: number;
}

/** Deformation field amplitudes (driven by springs in SymbolView). */
export interface JellyField {
  /** barrel bulge of the mid-section, fraction of local x (+ = wider) */
  bulge: number;
  /** vertical lag of the top, fraction of height (+ = top pushed down) */
  lag: number;
  /** horizontal displacement of the top, design px */
  shear: number;
}

/**
 * Jelly deformation for static AI/2D art without Spine: a 10x10 MeshPlane whose
 * vertices are displaced by a bulge/lag/shear field that is pinned at the FEET and
 * grows toward the top (the top lags, the belly bulges). The field is evaluated in
 * screen-aligned body space so gravity reads correctly on tilted specials.
 *
 * Cheap by construction: vertices are only rewritten while a SymbolView is animating;
 * idle symbols swap back to their Sprite. With no custom shader the 100-vertex mesh
 * still batches with sprites; `setFx(true)` swaps in the shine/flash/dissolve shader
 * (one draw call) only for win / explode / glint.
 */
export class JellyMesh {
  readonly mesh: MeshPlane;
  private readonly n = SYMBOL_TIMING.jelly.verts;
  private readonly rest: Float32Array;
  private readonly u: Float32Array;
  private readonly sinU: Float32Array;
  private readonly bx: Float32Array;
  private cos = 1;
  private sin = 0;
  private invK = 1;
  private height = 1;
  private fx: SymbolFxShader | null = null;
  private fxOn = false;

  constructor() {
    this.mesh = new MeshPlane({ texture: Texture.WHITE, verticesX: this.n, verticesY: this.n });
    this.mesh.autoResize = false;
    this.mesh.label = 'jelly';
    const count = this.n * this.n;
    this.rest = new Float32Array(count * 2);
    this.u = new Float32Array(count);
    this.sinU = new Float32Array(count);
    this.bx = new Float32Array(count);
  }

  /** Bind a texture and the rig frame; resets the mesh to its undeformed pose. */
  bind(tex: Texture, f: JellyFrame): void {
    this.mesh.texture = tex;
    if (this.fx) this.fx.setTexture(tex);
    const n = this.n;
    const seg = n - 1;
    // UVs 0..1 span the (possibly trimmed) frame -> place vertices over that frame in orig units
    const ox = (tex.trim?.x ?? 0) - f.cx;
    const oy = (tex.trim?.y ?? 0) - f.cy;
    const fw = tex.frame.width;
    const fh = tex.frame.height;
    this.cos = Math.cos(f.angle);
    this.sin = Math.sin(f.angle);
    this.invK = 1 / f.k;
    this.height = Math.max(1, f.feetY - f.topY);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        const x = ox + (i / seg) * fw;
        const y = oy + (j / seg) * fh;
        this.rest[v * 2] = x;
        this.rest[v * 2 + 1] = y;
        // pose space (rotated + scaled), then height above the feet
        const px = f.k * (this.cos * x - this.sin * y);
        const py = f.k * (this.sin * x + this.cos * y);
        const u = Math.min(1, Math.max(0, (f.feetY - py) / this.height));
        this.u[v] = u;
        this.sinU[v] = Math.sin(Math.PI * u);
        this.bx[v] = px;
      }
    }
    this.apply({ bulge: 0, lag: 0, shear: 0 });
  }

  /** Rewrite vertex positions for the given field (only called while animating). */
  apply(field: JellyField): void {
    const buffer = this.mesh.geometry.getBuffer('aPosition');
    const out = buffer.data as Float32Array;
    const { bulge, lag, shear } = field;
    const H = this.height;
    const c = this.cos;
    const s = this.sin;
    const ik = this.invK;
    const count = this.u.length;
    for (let v = 0; v < count; v++) {
      const u = this.u[v];
      const u2 = u * u;
      // body-space displacement (screen aligned, +y down)
      const dxb = shear * u2 + this.bx[v] * bulge * this.sinU[v];
      const dyb = (lag + bulge * 0.15) * H * u2;
      // back into texture space: R(-angle) / k
      out[v * 2] = this.rest[v * 2] + (c * dxb + s * dyb) * ik;
      out[v * 2 + 1] = this.rest[v * 2 + 1] + (-s * dxb + c * dyb) * ik;
    }
    buffer.update();
  }

  /** The per-instance FX shader (created on first use). */
  get fxShader(): SymbolFxShader {
    if (!this.fx) {
      this.fx = new SymbolFxShader();
      this.fx.setTexture(this.mesh.texture);
    }
    return this.fx;
  }

  /** Swap the shine/flash/dissolve shader in (unbatched) or out (batched). */
  setFx(on: boolean): void {
    if (on === this.fxOn) return;
    this.fxOn = on;
    this.mesh.shader = on ? this.fxShader.shader : null;
  }

  get hasFx(): boolean {
    return this.fxOn;
  }

  destroy(): void {
    this.fx?.destroy();
    this.mesh.destroy();
  }
}

const pool: JellyMesh[] = [];

/** Borrow a jelly mesh (pooled across all SymbolViews). */
export const acquireJelly = (): JellyMesh => pool.pop() ?? new JellyMesh();

/** Detach and return a jelly mesh to the pool (FX shader off, tint/alpha reset). */
export const releaseJelly = (j: JellyMesh): void => {
  j.setFx(false);
  j.mesh.removeFromParent();
  j.mesh.alpha = 1;
  j.mesh.tint = 0xffffff;
  pool.push(j);
};
