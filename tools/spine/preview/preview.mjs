/**
 * Spine rig preview on the REAL runtime (pixi.js 8.21 + @esotericsoftware/spine-pixi-v8 4.3.13).
 *
 * URL params: skel=<url .json|.skel>  atlas=<url .atlas>  size=420  w=<px> h=<px> (canvas, default
 * size x size)  zoom=1  capture=1 (manual clock, no UI)  kick=-27 (physicsTranslate y on land, runtime
 * y-down units)  bg=2a0f5e  guides=1  mode=character (auto when the rig has hips and no squash bone)
 *
 * Interactive: buttons per animation + "drop" (runtime-like reel stop). Capture mode exposes
 * window.__spinePreview = { ready, info, reset(), drop(opts), play(name, loop, track, additive),
 * queue(name, loop, delay, track), look(x, y) | look(null), step(dt) -> probe, probe() } and never
 * runs the ticker, so tools/spine/preview/capture.mjs can step exact 1/60 s frames. The runtime
 * binding mirrors ANIMATION_CONTRACT section 5 for symbols and ANIMATION_SET section 5 for 2D
 * characters: root at the feet (bottom centre), mixes 0.25 s (bass_drop_charge -> bass_drop 0),
 * overlays additive on track 1, face on track 2, look(x, y) drives ctrl_look like the runtime's
 * track 3 (offset from its setup position, skeleton units, y up) before the world transform.
 */
import { Application, Assets, Container, Graphics } from 'pixi.js';
import { Interpolation, Physics, Spine } from '@esotericsoftware/spine-pixi-v8';

const q = new URLSearchParams(location.search);
const skelUrl = q.get('skel');
const atlasUrl = q.get('atlas');
const size = Number(q.get('size') ?? 420);
const W = Number(q.get('w') ?? size);
const H = Number(q.get('h') ?? size);
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
  width: W,
  height: H,
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
holder.position.set(W / 2, H / 2);
holder.scale.set(zoom);
app.stage.addChild(holder);
const skelData = Assets.get('preview-skel');
const isChar = q.get('mode') === 'character' || (q.get('mode') !== 'symbol' && !!skelData?.bones?.find?.((b) => b.name === 'hips') && !skelData?.bones?.find?.((b) => b.name === 'squash'));
const floorY = H - 16;
let charZoom = zoom;
if (isChar) {
  // root = the feet point at the bottom centre; fit the setup height plus 22% headroom for raised arms
  const sk = skelData.skeleton ?? {};
  const top = (sk.y ?? 0) + (sk.height ?? 1000);
  charZoom = zoom * Math.min((floorY - 12) / (top * 1.12), (W - 24) / ((sk.width ?? 600) * 1.12));
  holder.position.set(W / 2, floorY);
  holder.scale.set(charZoom);
}

if (guides && isChar) {
  const g = new Graphics();
  g.moveTo(-W / charZoom, 0).lineTo(W / charZoom, 0).stroke({ width: 2 / charZoom, color: 0xffd54a, alpha: 0.45 }); // floor / feet line
  for (let x = -W / charZoom; x < W / charZoom; x += 40) g.moveTo(x, 0).lineTo(x + 20, 14).stroke({ width: 1 / charZoom, color: 0x6b3a57, alpha: 0.5 });
  holder.addChild(g);
} else if (guides) {
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
const lookMark = new Graphics();
if (isChar && guides) {
  lookMark.moveTo(-14, 0).lineTo(14, 0).moveTo(0, -14).lineTo(0, 14).stroke({ width: 3, color: 0xff3fa8, alpha: 0.9 });
  lookMark.circle(0, 0, 9).stroke({ width: 2, color: 0xff3fa8, alpha: 0.9 });
  lookMark.scale.set(1 / charZoom);
  holder.addChild(lookMark);
}
const sd = spine.skeleton.data;
const has = (n) => !!sd.findAnimation(n);
const mixes = spine.state.data;
mixes.defaultMix = isChar ? 0.25 : 0.08; // characters: TIMING.mascot.crossFade; symbols: ANIMATION_CONTRACT 3
const setMix = (a, b, d) => has(a) && has(b) && mixes.setMix(a, b, d);
setMix('land', 'idle', 0.15);
setMix('idle', 'win', 0.06);
setMix('win', 'win_loop', 0);
for (const a of sd.animations) setMix(a.name, 'explode', 0.05);
setMix('blur', 'idle', 0);
setMix('idle', 'blur', 0);
setMix('blur', 'land', 0);
setMix('bass_drop_charge', 'bass_drop', 0); // ANIMATION_SET 5.2

// runtime look-at (ANIMATION_SET 5, track 3): ctrl_look offset from its setup position, applied
// after the animation state and before the world transform, exactly where the runtime drives it
const lookBone = spine.skeleton.findBone('ctrl_look');
const lookSetup = lookBone ? { x: lookBone.data.setupPose.x, y: lookBone.data.setupPose.y } : null;
let lookTarget = null;
spine.beforeUpdateWorldTransforms = () => {
  if (lookBone && lookTarget) {
    lookBone.pose.x = lookSetup.x + lookTarget.x;
    lookBone.pose.y = lookSetup.y + lookTarget.y;
  }
};
spine.afterUpdateWorldTransforms = () => {
  if (lookBone) lookMark.position.set(lookBone.appliedPose.worldX, lookBone.appliedPose.worldY);
};

let time = 0;
let frameEvents = [];
spine.state.addListener({
  event: (_e, ev) => {
    frameEvents.push({ name: ev.data.name, string: ev.stringValue || undefined, float: ev.floatValue || undefined });
    log(`${(time * 1000).toFixed(0)}ms event ${ev.data.name}${ev.stringValue ? ` ${ev.stringValue}` : ''}`);
  },
});

// setup-pose reference for the probe
const physCons = sd.constraints.filter((c) => 'inertiaGlobal' in c);
const physBones = physCons.map((c) => c.bone.name);
const physMode = Object.fromEntries(physCons.map((c) => [c.bone.name, c.rotate > 0 || c.shearX > 0 ? 'rotate' : 'translate']));
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
    y: Math.round(holder.position.y - (isChar ? floorY : H / 2)),
    squashSX: sq ? +sq.scaleX.toFixed(4) : null,
    squashSY: sq ? +sq.scaleY.toFixed(4) : null,
    bodyS: body ? +body.scaleX.toFixed(4) : null,
    bodyRot: body ? +body.rotation.toFixed(3) : null,
    phys: {},
  };
  if (isChar) {
    const hp = sk.findBone('hips')?.appliedPose;
    const hs = setupWorld.get('hips');
    const hd = sk.findBone('head')?.appliedPose;
    const ch = sk.findBone('chest')?.appliedPose;
    out.hipsDX = hp ? +(hp.worldX - hs.x).toFixed(2) : null;
    out.hipsDY = hp ? +(hs.y - hp.worldY).toFixed(2) : null; // y up
    out.headRot = hd ? +(hd.getWorldRotationX() - setupWorld.get('head').r).toFixed(2) : null;
    out.chestS = ch ? +ch.scaleX.toFixed(4) : null;
    if (lookBone) {
      out.lookX = +(lookBone.pose.x - lookSetup.x).toFixed(1);
      out.lookY = +(lookBone.pose.y - lookSetup.y).toFixed(1);
    }
  }
  for (const n of physBones) {
    const b = sk.findBone(n);
    const s = setupWorld.get(n);
    const p = b.appliedPose;
    const tip = tipOf(b);
    out.phys[n] = {
      mode: physMode[n],
      dx: +(p.worldX - s.x).toFixed(2),
      dy: +(p.worldY - s.y).toFixed(2),
      rot: +(p.getWorldRotationX() - s.r).toFixed(2),
      tipX: +tip.x.toFixed(1),
      tipY: +tip.y.toFixed(1),
    };
    if (isChar && b.parent) {
      // characters move whole: plot each spring against its parent (the spring, not the body motion)
      const pp = b.parent.appliedPose;
      const loc = pp.worldToLocal({ x: p.worldX, y: p.worldY });
      out.phys[n].dx = +(loc.x - b.data.setupPose.x).toFixed(2);
      out.phys[n].dy = +(loc.y - b.data.setupPose.y).toFixed(2);
      out.phys[n].rot = +(p.getWorldRotationX() - pp.getWorldRotationX() - b.data.setupPose.rotation).toFixed(2);
    }
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

const play = (name, loop = false, track = 0, additive = false) => {
  const e = spine.state.setAnimation(track, name, loop);
  if (additive) e.additive = true; // ANIMATION_SET 5: track-1 overlays are deltas from the setup pose
  return e.animation.duration;
};
const queue = (name, loop = true, delay = 0, track = 0) => spine.state.addAnimation(track, name, loop, delay);
const look = (x, y) => {
  lookTarget = x === null || x === undefined ? null : { x, y };
};

window.__spinePreview = {
  ready: true,
  info: {
    kind: isChar ? 'character' : 'symbol',
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
    lookTarget = null;
    holder.position.y = isChar ? floorY : H / 2;
    app.render();
  },
  drop,
  play,
  queue,
  look,
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
    const loop = ['idle', 'win_loop', 'anticipation', 'blur', 'anticipation_loop', 'idle_bored', 'meter_heat', 'celebrate'].includes(a.name);
    btn(a.name, () => {
      if (a.name === 'win') {
        play('win', false);
        queue('win_loop', true);
      } else if (isChar && ['wild_land_react', 'pouch_pump'].includes(a.name)) play(a.name, false, 1, true);
      else if (isChar && a.name === 'blink') play(a.name, false, 2);
      else play(a.name, loop);
    });
  }
  if (isChar) btn('look sweep', () => {
    let k = 0;
    const id = setInterval(() => {
      k += 1;
      look(260 * Math.cos(k / 20), 180 * Math.sin(k / 20));
      if (k > 260) (clearInterval(id), look(null));
    }, 33);
  });
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
