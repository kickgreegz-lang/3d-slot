import { MeshRope, Point, type Texture } from 'pixi.js';
import { canvasToTexture, createCanvas } from '../../../fx/textures';

/**
 * Floppy speaker cable (the `cable_*` meshes with a `floppy` physics preset, ANIMATION_SET
 * §0: 3.0 Hz / zeta 0.20): a MeshRope from a socket to the floor with a gravity sag, kicked
 * into a decaying whip by `kick(power)` (boom_follow). Points are mutated in place every
 * frame (no allocation); the rope geometry follows them.
 */
const SEGMENTS = 10;
const HZ = 3;
const ZETA = 0.2;

const cableTex = new Map<number, Texture>();

/**
 * 64 x 16 rubber cable: black outline rows, violet-black core, one light stripe (key light
 * top-left). A MeshRope is as thick as its texture is tall, so the texture resolution carries
 * the wanted thickness (cached per width).
 */
const cableTexture = (width: number): Texture => {
  const key = Math.max(2, Math.round(width * 2) / 2);
  let tex = cableTex.get(key);
  if (tex) return tex;
  const [c, g] = createCanvas(64, 16);
  const rows: Array<[number, string]> = [
    [2, '#000000'],
    [3, '#3b3150'],
    [2, '#6a5d86'],
    [5, '#241c33'],
    [4, '#000000'],
  ];
  let y = 0;
  for (const [hgt, col] of rows) {
    g.fillStyle = col;
    g.fillRect(0, y, 64, hgt);
    y += hgt;
  }
  tex = canvasToTexture(c, 16 / key);
  cableTex.set(key, tex);
  return tex;
};

export class Cable {
  readonly rope: MeshRope;
  private readonly pts: Point[] = [];
  private ax = 0;
  private ay = 0;
  private bx = 0;
  private by = 0;
  private sag = 0;
  /** whip oscillator (displacement along the rope's normal, px) */
  private x = 0;
  private v = 0;

  constructor(width: number) {
    for (let i = 0; i <= SEGMENTS; i++) this.pts.push(new Point());
    this.rope = new MeshRope({ texture: cableTexture(width), points: this.pts, textureScale: 0 });
  }

  /** Cable thickness (px): swaps to the texture baked for it. */
  setWidth(width: number): void {
    const tex = cableTexture(width);
    if (this.rope.texture !== tex) this.rope.texture = tex;
  }

  /** Socket (a) -> floor end (b) with a sag depth (all in the parent's local px). */
  set(ax: number, ay: number, bx: number, by: number, sag: number): void {
    this.ax = ax;
    this.ay = ay;
    this.bx = bx;
    this.by = by;
    this.sag = sag;
    this.apply();
  }

  /** Whip kick (boom_follow): a velocity impulse on the damped oscillator. */
  kick(power: number): void {
    this.v += power;
  }

  update(dt: number): void {
    if (dt <= 0 || (Math.abs(this.x) < 0.02 && Math.abs(this.v) < 0.05)) return;
    const w = Math.PI * 2 * HZ;
    // semi-implicit Euler on a damped spring, sub-stepped for stability
    const n = Math.ceil(dt / 0.008);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-w * w * this.x - 2 * ZETA * w * this.v) * h;
      this.x += this.v * h;
    }
    this.apply();
  }

  private apply(): void {
    const dx = this.bx - this.ax;
    const dy = this.by - this.ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const bell = 4 * t * (1 - t);
      // the whip travels down the cable: phase lag toward the floor end
      const lag = Math.sin(Math.PI * t) * (1 - 0.35 * t);
      const p = this.pts[i];
      p.x = this.ax + dx * t + nx * this.x * lag;
      p.y = this.ay + dy * t + this.sag * bell + ny * this.x * lag;
    }
  }
}
