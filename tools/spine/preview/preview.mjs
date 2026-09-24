/**
 * Spine rig preview on the REAL runtime (pixi.js 8.21 + @esotericsoftware/spine-pixi-v8 4.3.13).
 *
 * URL params: skel=<url .json|.skel>  atlas=<url .atlas>  size=420  zoom=1  capture=1 (manual clock,
 * no UI)  kick=-27 (physicsTranslate y on land, runtime y-down units)  bg=2a0f5e  guides=1
 *
 * Interactive: buttons per animation + "drop" (runtime-like reel stop). Capture mode exposes
 * window.__spinePreview = { ready, info, reset(), drop(opts), play(name, loop), queue(name, loop),
 * step(dt) -> probe, probe() } and never runs the ticker, so tools/spine/preview/capture.mjs can
 * step exact 1/60 s frames. The runtime binding mirrors ANIMATION_CONTRACT section 5.
 */
import { Application, Assets, Container, Graphics } from 'pixi.js';
import { Interpolation, Physics, Spine } from '@esotericsoftware/spine-pixi-v8';

const q = new URLSearchParams(location.search);
const skelUrl = q.get('skel');
const atlasUrl = q.get('atlas');
const size = Number(q.get('size') ?? 420);
const zoom = Number(q.get('zoom') ?? 1);
const capture = q.get('capture') === '1';
const kickDefault = Number(q.get('kick') ?? -27);
const bg = `#${q.get('bg') ?? '2a0f5e'}`;
const guides = q.get('guides') !== '0';
if (capture) document.body.classList.add('capture');

const logEl = document.getElementById('log');
const log = (s) => {
  if (!capture) logEl.textContent = `${s}\n${logEl.textContent}`.slice(0, 4000);
};

const app = new Application();
await app.init({
  width: size,
  height: size,
  background: bg,
  antialias: true,
  preference: 'webgl',
  resolution: 1,
  autoStart: !capture,
  preserveDrawingBuffer: true,
});
document.getElementById('stage').appendChild(app.canvas);

Assets.add({ alias: 'preview-skel', src: skelUrl });
Assets.add({ alias: 'preview-atlas', src: atlasUrl });
await Assets.load(['preview-skel', 'preview-atlas']);

const holder = new Container();
holder.position.set(size / 2, size / 2);
holder.scale.set(zoom);
app.stage.addChild(holder);

if (guides) {
  // 300 @2x cell (solid) and 360 @2x symbol canvas (dashed-ish) centred on root
  const g = new Graphics();
  g.rect(-150, -150, 300, 300).stroke({ width: 1, color: 0x9a7bff, alpha: 0.55 });
  for (let i = -180; i < 180; i += 12) {
    g.moveTo(i, -180).lineTo(i + 6, -180).moveTo(i, 180).lineTo(i + 6, 180);
    g.moveTo(-180, i).lineTo(-180, i + 6).moveTo(180, i).lineTo(180, i + 6);
  }
  g.stroke({ width: 1, color: 0x6b3a57, alpha: 0.6 });
  g.moveTo(-160, 150).lineTo(160, 150).stroke({ width: 1, color: 0xffd54a, alpha: 0.35 }); // cell floor
  holder.addChild(g);
}

const spine = new Spine({ skeleton: 'preview-skel', atlas: 'preview-atlas', autoUpdate: false });
holder.addChild(spine);
const sd = spine.skeleton.data;
const has = (n) => !!sd.findAnimation(n);
const mixes = spine.state.data;
mixes.defaultMix = 0.08; // ANIMATION_CONTRACT 3: mixes
const setMix = (a, b, d) => has(a) && has(b) && mixes.setMix(a, b, d);
setMix('land', 'idle', 0.15);
setMix('idle', 'win', 0.06);
setMix('win', 'win_loop', 0);
for (const a of sd.animations) setMix(a.name, 'explode', 0.05);
setMix('blur', 'idle', 0);
setMix('idle', 'blur', 0);
setMix('blur', 'land', 0);

let time = 0;
let frameEvents = [];
spine.state.addListener({
  event: (_e, ev) => {
    frameEvents.push({ name: ev.data.name, string: ev.stringValue || undefined, float: ev.floatValue || undefined });
    log(`${(time * 1000).toFixed(0)}ms event ${ev.data.name}${ev.stringValue ? ` ${ev.stringValue}` : ''}`);
  },
});

// setup-pose reference for the probe
const physBones = sd.constraints.filter((c) => c.constructor.name.includes('Physics')).map((c) => c.bone.name);
const setupWorld = new Map();
const resetPose = () => {
  spine.state.clearTracks();
  spine.skeleton.setupPose();
  spine.skeletonPhysics.setPositionInheritance(0, 0);
  spine.skeletonPhysics.resetTransform();
  spine.skeleton.updateWorldTransform(Physics.reset);
  spine.alpha = 1;
};
resetPose();
for (const b of spine.skeleton.bones) {
  const p = b.appliedPose;
  setupWorld.set(b.data.name, { x: p.worldX, y: p.worldY, r: p.getWorldRotationX() });
}

const tipOf = (bone) => {
  const p = bone.appliedPose;
  const L = bone.data.length;
  return { x: p.worldX + L * p.a, y: p.worldY + L * p.c };
};

const probe = () => {
  const sk = spine.skeleton;
  const sq = sk.findBone('squash')?.appliedPose;
  const body = sk.findBone('body')?.appliedPose;
  const out = {
    t: Math.round(time * 1000),
    y: Math.round(holder.position.y - size / 2),
    squashSX: sq ? +sq.scaleX.toFixed(4) : null,
    squashSY: sq ? +sq.scaleY.toFixed(4) : null,
    bodyS: body ? +body.scaleX.toFixed(4) : null,
    bodyRot: body ? +body.rotation.toFixed(3) : null,
    phys: {},
  };
  for (const n of physBones) {
    const b = sk.findBone(n);
    const s = setupWorld.get(n);
    const p = b.appliedPose;
    const tip = tipOf(b);
    out.phys[n] = {
      dx: +(p.worldX - s.x).toFixed(2),
      dy: +(p.worldY - s.y).toFixed(2),
      rot: +(p.getWorldRotationX() - s.r).toFixed(2),
      tipX: +tip.x.toFixed(1),
      tipY: +tip.y.toFixed(1),
    };
  }
  return out;
};

// ---------------------------------------------------------------- scripted reel stop
let dropState = null;
const drop = ({ from = 220, frames = 6, kick = kickDefault, then = 'idle' } = {}) => {
  resetPose();
  const T = frames / 60;
  dropState = { t: 0, T, from, g: (2 * from) / (T * T), kick, then };
  holder.position.y = size / 2 - from;
  if (has('blur')) spine.state.setAnimation(0, 'blur', true);
  spine.skeletonPhysics.setPositionInheritance(0, 0); // parts must not fly off during the spin
};

const contact = () => {
  const { kick, then } = dropState;
  dropState = null;
  holder.position.y = size / 2;
  spine.skeletonPhysics.setPositionInheritance(0, 0.6); // container deceleration drives the jiggle
  if (kick) spine.skeleton.physicsTranslate(0, kick);
  if (has('land')) {
    const e = spine.state.setAnimation(0, 'land', false);
    e.mixInterpolation = Interpolation.smooth;
    if (then && has(then)) spine.state.addAnimation(0, then, true, 0);
  }
};

const step = (dt = 1 / 60) => {
  frameEvents = [];
  if (dropState) {
    dropState.t += dt;
    const t = Math.min(dropState.t, dropState.T);
    holder.position.y = size / 2 - dropState.from + 0.5 * dropState.g * t * t;
    if (dropState.t >= dropState.T - 1e-9) contact();
  }
  time += dt;
  spine.update(dt);
  app.render();
  return { ...probe(), events: frameEvents };
};

const play = (name, loop = false) => {
  const e = spine.state.setAnimation(0, name, loop);
  return e.animation.duration;
};
const queue = (name, loop = true, delay = 0) => spine.state.addAnimation(0, name, loop, delay);

window.__spinePreview = {
  ready: true,
  info: {
    skeleton: skelUrl,
    version: sd.version,
    animations: sd.animations.map((a) => ({ name: a.name, frames: Math.round(a.duration * 30 * 100) / 100 })),
    events: sd.events.map((e) => e.name),
    physics: physBones,
    bones: sd.bones.length,
    slots: sd.slots.length,
  },
  reset: () => {
    resetPose();
    time = 0;
    holder.position.y = size / 2;
    app.render();
  },
  drop,
  play,
  queue,
  step,
  probe,
  spine,
  app,
};

// ---------------------------------------------------------------- interactive UI
if (!capture) {
  const bar = document.getElementById('bar');
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    bar.appendChild(b);
  };
  btn('drop + land', () => drop());
  for (const a of sd.animations) {
    const loop = ['idle', 'win_loop', 'anticipation', 'blur', 'anticipation_loop'].includes(a.name);
    btn(a.name, () => {
      if (a.name === 'win') {
        play('win', false);
        queue('win_loop', true);
      } else play(a.name, loop);
    });
  }
  btn('kick', () => spine.skeleton.physicsTranslate(0, kickDefault));
  btn('reset', () => window.__spinePreview.reset());
  app.ticker.add((tk) => {
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    if (dropState) {
      dropState.t += dt;
      const t = Math.min(dropState.t, dropState.T);
      holder.position.y = size / 2 - dropState.from + 0.5 * dropState.g * t * t;
      if (dropState.t >= dropState.T) contact();
    }
    time += dt;
    spine.update(dt);
  });
  if (has('idle')) play('idle', true);
  log(`loaded ${skelUrl} (spine ${sd.version}): ${sd.animations.map((a) => a.name).join(', ')}`);
} else {
  app.render();
}
