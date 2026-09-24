import { type Application, ExternalSource, Texture, WebGLRenderer as PixiWebGLRenderer } from 'pixi.js';
import { ColorManagement, WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * three.js <-> Pixi bridge on ONE WebGL2 context (Pixi owns it).
 * Verified order (scratchpad/x3 prototype, critic.md "RENDER CORE"):
 *  1. `app.renderer.resetState()` immediately BEFORE `new THREE.WebGLRenderer({canvas, context})`
 *     (Pixi leaves UNPACK_PREMULTIPLY_ALPHA=true; three's WebGLState would then create its default
 *     3D textures with it set -> GL INVALID_OPERATION 1282).
 *  2. Every frame: `three.resetState()` -> render into render targets -> `setRenderTarget(null)`
 *     -> `app.renderer.resetState()`, all before Pixi renders.
 *  3. Each render target's resolved colour texture is wrapped as a Pixi ExternalSource; its
 *     origin is bottom-left, so the sprite showing it uses `scale.y = -1`.
 * The pipeline is gamma-space (ColorManagement disabled, NoColorSpace textures) so colours
 * match Pixi's non-linear 2D blending exactly.
 */
export const createThree = (app: Application): WebGLRenderer => {
  const renderer = app.renderer;
  if (!(renderer instanceof PixiWebGLRenderer)) throw new Error('Mascots need the Pixi WebGL renderer');
  ColorManagement.enabled = false;
  renderer.resetState();
  const three = new WebGLRenderer({ canvas: app.canvas, context: renderer.gl });
  three.autoClear = false;
  three.debug.checkShaderErrors = import.meta.env.DEV;
  three.setClearColor(0x000000, 0);
  app.renderer.resetState();
  return three;
};

/** A multisampled render target shown in Pixi through an ExternalSource texture. */
export class RenderTargetView {
  readonly rt: WebGLRenderTarget;
  readonly source: ExternalSource;
  readonly texture: Texture;

  constructor(
    private readonly three: WebGLRenderer,
    app: Application,
    width: number,
    height: number,
    samples: number,
  ) {
    this.rt = new WebGLRenderTarget(width, height, { samples, depthBuffer: true, stencilBuffer: false });
    three.initRenderTarget(this.rt);
    this.source = new ExternalSource({
      resource: this.glTexture(),
      renderer: app.renderer,
      width,
      height,
      label: 'mascot-rt',
    });
    this.texture = new Texture({ source: this.source });
  }

  get width(): number {
    return this.rt.width;
  }

  get height(): number {
    return this.rt.height;
  }

  /** Reallocate at a new size (three recreates the GL texture, so the Pixi source is re-pointed). */
  resize(width: number, height: number): void {
    if (width === this.rt.width && height === this.rt.height) return;
    this.rt.setSize(width, height);
    this.three.initRenderTarget(this.rt);
    this.source.updateGPUTexture(this.glTexture(), width, height);
  }

  private glTexture(): WebGLTexture {
    const props = this.three.properties.get(this.rt.texture) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) throw new Error('Mascot render target was not initialised');
    return props.__webglTexture;
  }

  destroy(): void {
    this.texture.destroy(true);
    this.rt.dispose();
  }
}
