import { GlProgram, Shader, Texture, UniformGroup } from 'pixi.js';

/**
 * One custom Mesh shader for every per-symbol effect, so a winning / exploding
 * symbol costs one draw call and no render-texture pass (no Filter):
 *   - SHINE   diagonal additive band sweeping top-left -> bottom-right, masked by alpha
 *   - FLASH   mix toward white (hit flash / charge-up)
 *   - DISSOLVE noise-threshold burn from the centre out with a hot edge (explode)
 * The band/noise live in the mesh's plane UV (0..1), so they ride the jelly deformation.
 * Atlas frames are handled through uTextureMatrix (texture.textureMatrix.mapCoord).
 */
const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;
out vec2 vLocal;
out vec4 vColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;

uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform float uRound;

uniform mat3 uTextureMatrix;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = (uTextureMatrix * vec3(aUV, 1.0)).xy;
  vLocal = aUV;
  vColor = uColor * uWorldColorAlpha;
}
`;

const fragment = /* glsl */ `
in vec2 vUV;
in vec2 vLocal;
in vec4 vColor;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uShine;
uniform float uShineWidth;
uniform float uShineIntensity;
uniform float uFlash;
uniform float uDissolve;
uniform vec3 uEdgeColor;
uniform float uNoiseScale;
uniform float uSeed;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main(void) {
  vec4 c = texture(uTexture, vUV);

  if (uDissolve > 0.0) {
    vec2 p = vLocal * uNoiseScale + uSeed;
    float n = vnoise(p) * 0.62 + vnoise(p * 2.3) * 0.38;
    float r = length(vLocal - 0.5) * 1.41421;
    // burn from the centre outward, broken up by noise
    float field = n * 0.55 + r * 0.45;
    float t = uDissolve * 1.15 - 0.05;
    float d = field - t;
    if (d < 0.0) {
      c = vec4(0.0);
    } else {
      float edge = 1.0 - smoothstep(0.0, 0.085, d);
      c.rgb = mix(c.rgb, uEdgeColor * c.a, edge) + uEdgeColor * (edge * edge * 0.9 * c.a);
    }
  }

  c.rgb = mix(c.rgb, vec3(c.a), uFlash);

  float s = (vLocal.x + vLocal.y) * 0.5 - uShine;
  float band = smoothstep(uShineWidth, 0.0, abs(s));
  float core = smoothstep(uShineWidth * 0.28, 0.0, abs(s));
  c.rgb += (band * 0.55 + core * 0.45) * uShineIntensity * c.a;

  finalColor = c * vColor;
}
`;

let program: GlProgram | null = null;
let seedCounter = 0;

export interface SymbolFxParams {
  /** band centre in plane-diagonal units; sweep from ≈ -0.3 to 1.3; < -0.5 = off */
  shine: number;
  shineWidth: number;
  shineIntensity: number;
  flash: number;
  dissolve: number;
}

/** Per-instance shader (uniform values differ per symbol; the GlProgram is shared). */
export class SymbolFxShader {
  /** Shader + `texture` field so it satisfies Mesh's TextureShader slot. */
  readonly shader: Shader & { texture: Texture };
  private readonly fx: UniformGroup;
  private readonly texUniforms: UniformGroup;

  constructor() {
    program ??= GlProgram.from({ vertex, fragment, name: 'symbol-fx' });
    this.fx = new UniformGroup({
      uShine: { value: -1, type: 'f32' },
      uShineWidth: { value: 0.16, type: 'f32' },
      uShineIntensity: { value: 0, type: 'f32' },
      uFlash: { value: 0, type: 'f32' },
      uDissolve: { value: 0, type: 'f32' },
      uEdgeColor: { value: new Float32Array([1, 0.8, 0.3]), type: 'vec3<f32>' },
      uNoiseScale: { value: 7, type: 'f32' },
      uSeed: { value: (seedCounter++ * 17.31) % 97, type: 'f32' },
    });
    this.texUniforms = new UniformGroup({
      uTextureMatrix: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), type: 'mat3x3<f32>' },
    });
    const shader = new Shader({
      glProgram: program,
      // every resource key must exist up front: Shader.resources is a proxy over fixed bindings
      resources: { uTexture: Texture.WHITE.source, fx: this.fx, textureUniforms: this.texUniforms },
    });
    this.shader = Object.assign(shader, { texture: Texture.WHITE });
  }

  setTexture(tex: Texture): void {
    this.shader.resources.uTexture = tex.source;
    tex.textureMatrix.update();
    const m = tex.textureMatrix.mapCoord;
    const u = this.texUniforms.uniforms.uTextureMatrix as Float32Array;
    u[0] = m.a;
    u[1] = m.b;
    u[2] = 0;
    u[3] = m.c;
    u[4] = m.d;
    u[5] = 0;
    u[6] = m.tx;
    u[7] = m.ty;
    u[8] = 1;
    this.texUniforms.update();
  }

  setEdgeColor(color: number, whiten: number): void {
    const e = this.fx.uniforms.uEdgeColor as Float32Array;
    e[0] = lerp(((color >> 16) & 255) / 255, 1, whiten);
    e[1] = lerp(((color >> 8) & 255) / 255, 1, whiten);
    e[2] = lerp((color & 255) / 255, 1, whiten);
  }

  setNoiseScale(v: number): void {
    this.fx.uniforms.uNoiseScale = v;
  }

  apply(p: SymbolFxParams): void {
    const u = this.fx.uniforms;
    u.uShine = p.shine;
    u.uShineWidth = p.shineWidth;
    u.uShineIntensity = p.shineIntensity;
    u.uFlash = p.flash;
    u.uDissolve = p.dissolve;
  }

  destroy(): void {
    this.shader.destroy();
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
