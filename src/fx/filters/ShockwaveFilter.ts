import { defaultFilterVert, Filter, GlProgram } from 'pixi.js';

/**
 * Radial displacement ring ("shockwave") for scatter hits and big-win slams.
 * Everything is in normalised filter-area space (0..1 across the filterArea), so
 * the caller passes design-space coordinates divided by the area size and the
 * effect is independent of screen resolution / filter resolution.
 */
const fragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uInputClamp;

uniform vec2 uCenter;
uniform float uAspect;
uniform float uRadius;
uniform float uHalfWidth;
uniform float uAmplitude;
uniform float uBrightness;

void main(void)
{
    vec2 toLocal = uInputSize.xy / uOutputFrame.zw;
    vec2 local = vTextureCoord * toLocal;
    vec2 d = local - uCenter;
    d.y /= uAspect;
    float dist = length(d);
    float x = (dist - uRadius) / uHalfWidth;
    vec2 coord = vTextureCoord;
    float light = 0.0;
    if (abs(x) < 1.0 && dist > 0.0001) {
        float env = 1.0 - x * x;
        float wave = sin(x * 3.14159265) * env;
        vec2 dir = d / dist;
        dir.y *= uAspect;
        coord -= dir * wave * uAmplitude / toLocal;
        light = max(0.0, -wave) * uBrightness;
    }
    coord = clamp(coord, uInputClamp.xy, uInputClamp.zw);
    vec4 c = texture(uTexture, coord);
    c.rgb += c.a * light;
    finalColor = c;
}
`;

export interface ShockwaveParams {
  /** centre in normalised area coords */
  x: number;
  y: number;
  /** area width / height */
  aspect: number;
}

export class ShockwaveFilter extends Filter {
  private u: {
    uCenter: Float32Array;
    uAspect: number;
    uRadius: number;
    uHalfWidth: number;
    uAmplitude: number;
    uBrightness: number;
  };

  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'fx-shockwave' }),
      resources: {
        shockUniforms: {
          uCenter: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
          uAspect: { value: 16 / 9, type: 'f32' },
          uRadius: { value: 0, type: 'f32' },
          uHalfWidth: { value: 0.04, type: 'f32' },
          uAmplitude: { value: 0.01, type: 'f32' },
          uBrightness: { value: 0.25, type: 'f32' },
        },
      },
      resolution: 0.5,
      padding: 0,
    });
    this.u = this.resources.shockUniforms.uniforms;
  }

  setCenter(p: ShockwaveParams): void {
    this.u.uCenter[0] = p.x;
    this.u.uCenter[1] = p.y;
    this.u.uAspect = p.aspect;
  }

  /** current ring radius (fraction of area width) */
  get radius(): number {
    return this.u.uRadius;
  }
  set radius(v: number) {
    this.u.uRadius = v;
  }
  /** displacement strength (fraction of area width) */
  get amplitude(): number {
    return this.u.uAmplitude;
  }
  set amplitude(v: number) {
    this.u.uAmplitude = v;
  }
  get halfWidth(): number {
    return this.u.uHalfWidth;
  }
  set halfWidth(v: number) {
    this.u.uHalfWidth = v;
  }
  get brightness(): number {
    return this.u.uBrightness;
  }
  set brightness(v: number) {
    this.u.uBrightness = v;
  }
}
