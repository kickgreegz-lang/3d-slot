import { defaultFilterVert, Filter, GlProgram } from 'pixi.js';

/**
 * Radial chromatic-aberration pulse (RGB split growing with distance from a
 * centre) — a 150-250 ms hit on big-win tier upgrades. `amount` is the split at
 * one area-width away from the centre, in normalised units (0.02 = strong).
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
uniform float uAmount;

void main(void)
{
    vec2 toLocal = uInputSize.xy / uOutputFrame.zw;
    vec2 d = vTextureCoord * toLocal - uCenter;
    vec2 off = d * uAmount / toLocal;
    vec4 r = texture(uTexture, clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw));
    vec4 g = texture(uTexture, vTextureCoord);
    vec4 b = texture(uTexture, clamp(vTextureCoord - off, uInputClamp.xy, uInputClamp.zw));
    finalColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}
`;

export class ChromaticFilter extends Filter {
  private u: { uCenter: Float32Array; uAmount: number };

  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'fx-chromatic' }),
      resources: {
        chromaUniforms: {
          uCenter: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
          uAmount: { value: 0, type: 'f32' },
        },
      },
      resolution: 0.5,
      padding: 0,
    });
    this.u = this.resources.chromaUniforms.uniforms;
  }

  setCenter(x: number, y: number): void {
    this.u.uCenter[0] = x;
    this.u.uCenter[1] = y;
  }

  get amount(): number {
    return this.u.uAmount;
  }
  set amount(v: number) {
    this.u.uAmount = v;
  }
}
