/**
 * `--kind character` checks for tools/spine/validate.mjs (2D Spine mascots, ANIMATION_SET section 5,
 * section 10 budgets, section 12 CR-8). Everything runs on the official spine-core 4.3.13 runtime.
 *
 * Static (raw JSON): core biped bones + ctrl_look, bone words/prefixes, character budgets (bones,
 *   slots, mesh vertices, physics constraints), physics limit >= 6000, the look transform
 *   constraints, eye_L/R + pupil_L/R slots, every eye slot with every face state, the per-rig
 *   attachment sets (mouth shapes, hand poses), face (track 2) clips that key only face slots/bones
 *   (error), clips that never key root.
 * Runtime: every contract clip present with the exact ANIMATION_SET length, events on their frames,
 *   loop seams (keyed pose, physics excluded), overlays that start and end on zero deltas,
 *   `endsAt` hand-offs (bass_drop_charge -> bass_drop), one-shots ending on idle's first pose (mix
 *   friendliness), no NaN while stepping 60 Hz with physics on the clip's own track (overlays
 *   additive over idle), physics sanity (spring deflection and settling), IK reach (planted feet
 *   and hands never lose their targets), a setup pose that IK does not move, the look-at response,
 *   adult proportions (head <= headMax of the height from the setup attachment bounds) and the
 *   single-page atlas.
 */
const TOL = 0.02;

export function characterStatic(raw, ctx) {
  const { CONTRACT, err, warn, info } = ctx;
  const CC = CONTRACT.characters;
  const bones = raw.bones ?? [];
  const byName = new Map(bones.map((b) => [b.name, b]));
  const re = new RegExp(CONTRACT.boneNames.pattern);
  if (bones[0]?.name !== 'root') err('first bone must be root');
  for (const req of CC.requiredBones) if (!byName.has(req)) err(`bone "${req}" missing (ANIMATION_SET 5 core/limb/look bones)`);
  const words = new Set([...CC.boneNames.core, ...CC.boneNames.words, ...CC.boneNames.limbs]);
  for (const b of bones) {
    if (!re.test(b.name)) err(`bone "${b.name}": not snake_case`);
    const stem = b.name.replace(/_[LR]$/, '');
    if (b.name !== 'root' && !words.has(stem) && !CC.boneNames.prefixes.some((p) => b.name.startsWith(p)))
      warn(`bone "${b.name}": not a contract word and no prefix (${CC.boneNames.prefixes.join(' ')})`);
    if (b.name.startsWith('fx_') && b.parent !== 'root') err(`bone "${b.name}": fx_* bones must be children of root`);
    if (b.name.startsWith('phys_')) {
      const part = b.name.replace(/^phys_/, '').replace(/_\d+$/, '');
      if (!CC.springWords.includes(part)) warn(`bone "${b.name}": spring part "${part}" is not one of ${CC.springWords.join(', ')}`);
    }
  }
  const cons = raw.constraints ?? [];
  const look = cons.find((c) => c.name === CC.look.head);
  if (!look) err(`look-at: transform constraint "${CC.look.head}" (source ${CC.look.bone}, bones [head]) missing (ANIMATION_SET 5)`);
  else {
    if (look.type !== 'transform' || look.source !== CC.look.bone) err(`look-at: "${CC.look.head}" must be a transform constraint with source ${CC.look.bone}`);
    if (!(look.bones ?? []).includes('head')) err(`look-at: "${CC.look.head}" must constrain the head`);
  }
  const eyesC = cons.find((c) => c.name === CC.look.eyes);
  if (!eyesC) warn(`look-at: transform constraint "${CC.look.eyes}" (pupils) missing`);
  for (const c of cons.filter((x) => x.type === 'ik')) {
    if (!String(c.target).startsWith('ik_')) warn(`IK "${c.name}": target "${c.target}" is not an ik_* bone`);
  }
  // slots / attachments
  const atts = new Map();
  for (const skin of raw.skins ?? []) for (const [s, e] of Object.entries(skin.attachments ?? {})) atts.set(s, new Set([...(atts.get(s) ?? []), ...Object.keys(e)]));
  const slots = raw.slots ?? [];
  for (const need of CC.faceStates.slots ?? []) if (!slots.some((s) => s.name === need)) err(`slot "${need}" missing (ANIMATION_SET 5: every mascot has eye_L/R with the face states and pupil_L/R for the look)`);
  for (const s of slots) {
    if (/^eye_[LR]$/.test(s.name)) {
      const have = atts.get(s.name) ?? new Set();
      const miss = CC.faceStates.eyes.filter((st) => !have.has(st));
      if (miss.length) err(`slot "${s.name}": eye states ${miss.join(', ')} missing (every eye slot has ${CC.faceStates.eyes.join(', ')})`);
    }
  }
  const spec = CC.rigs?.[ctx.skelName];
  for (const [slot, want] of Object.entries(spec?.attachments ?? {})) {
    const have = atts.get(slot);
    if (!have) err(`slot "${slot}" missing (ANIMATION_SET: ${want.join(', ')})`);
    else {
      const miss = want.filter((w) => !have.has(w));
      if (miss.length) err(`slot "${slot}": attachment(s) ${miss.join(', ')} missing (ANIMATION_SET)`);
    }
  }
  // clip-level static rules
  for (const [name, a] of Object.entries(raw.animations ?? {})) {
    const rule = spec?.clips?.[name] ?? CC.clips[name];
    const track = rule?.track ?? 0;
    const keyedBones = Object.keys(a.bones ?? {});
    if (keyedBones.includes('root')) err(`${name}: keys the root bone (root is the feet anchor placed by the layout)`);
    if (track === 2) {
      const bad = keyedBones.filter((b) => !/^face_/.test(b));
      // track 2 is applied over the body track at mix 1: any body key there freezes the body clip's bone
      if (bad.length || Object.keys(a.ik ?? {}).length) err(`${name}: face clip (track 2) keys body bones/IK ${[...bad, ...Object.keys(a.ik ?? {})].join(', ')}; they would override track 0 (face clips swap attachments and key face_* bones only)`);
    }
  }
  const physN = cons.filter((c) => c.type === 'physics').length;
  info(`character: ${bones.length} bones, ${slots.length} slots, ${physN} physics constraints (budgets ${CC.budgets.bones}/${CC.budgets.slots}/${CC.budgets.physics})`);
  if (physN > CC.budgets.physics) err(`budget: ${physN} physics constraints > ${CC.budgets.physics}`);
}

export function characterRuntime(data, ctx) {
  const { spine, CONTRACT, FPS, err, warn, info, report, raw, atlas, atlasPath, skelName } = ctx;
  const CC = CONTRACT.characters;
  const spec = CC.rigs?.[skelName] ?? null;
  const clipRule = (name) => (spec?.clips?.[name] ? { ...CC.clips[name], ...spec.clips[name] } : (CC.clips[name] ?? null));
  const nan = (v) => !Number.isFinite(v);
  const tmp = new Float32Array(8192);
  if (!spec) warn(`no rig spec for "${skelName}" in contract.json characters.rigs: only the generic clip windows are checked`);

  // ------------------------------------------------------------------ helpers
  const bounds = (skeleton, filter) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const slot of skeleton.slots) {
      const att = slot.appliedPose.attachment;
      if (!att || !filter(slot)) continue;
      let n = 0;
      if (att instanceof spine.RegionAttachment) {
        att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), tmp, 0, 2);
        n = 8;
      } else if (att instanceof spine.MeshAttachment) {
        n = att.worldVerticesLength;
        att.computeWorldVertices(skeleton, slot, 0, n, tmp, 0, 2);
      } else continue;
      for (let i = 0; i < n; i += 2) {
        x0 = Math.min(x0, tmp[i]);
        x1 = Math.max(x1, tmp[i]);
        y0 = Math.min(y0, tmp[i + 1]);
        y1 = Math.max(y1, tmp[i + 1]);
      }
    }
    return { x0, y0, x1, y1 };
  };
  const snapshot = (s) => {
    const v = [];
    for (const b of s.bones) {
      const p = b.appliedPose;
      v.push(p.worldX, p.worldY, p.a * 100, p.b * 100, p.c * 100, p.d * 100);
    }
    const atts = [];
    for (const sl of s.slots) {
      const p = sl.appliedPose;
      v.push(p.color.r * 255, p.color.g * 255, p.color.b * 255, p.color.a * 255);
      atts.push(p.attachment ? p.attachment.name : null);
    }
    return { v, atts };
  };
  const diff = (a, b) => {
    if (a.atts.join('|') !== b.atts.join('|')) {
      const i = a.atts.findIndex((x, k) => x !== b.atts[k]);
      return { d: Infinity, why: `slot ${data.slots[i]?.name}: ${a.atts[i]} vs ${b.atts[i]}` };
    }
    let d = 0;
    let at = -1;
    for (let i = 0; i < a.v.length; i++) {
      const x = Math.abs(a.v[i] - b.v[i]);
      if (x > d) {
        d = x;
        at = i;
      }
    }
    const nb = data.bones.length * 6;
    const why = at < 0 ? '' : at < nb ? `bone ${data.bones[Math.floor(at / 6)].name}` : `slot ${data.slots[Math.floor((at - nb) / 4)]?.name}`;
    return { d, why };
  };
  /** Keyed pose of `anim` at t over the setup pose (constraints applied, no physics). */
  const sample = (anim, t, additive = false) => {
    const s = new spine.Skeleton(data);
    s.setupPose();
    if (anim) anim.apply(s, t, t, false, null, 1, spine.MixFrom.setup, additive, false, false);
    s.updateWorldTransform(spine.Physics.none);
    return snapshot(s);
  };
  const setupSk = new spine.Skeleton(data);
  setupSk.setupPose();
  setupSk.updateWorldTransform(spine.Physics.none);
  const setupSnap = snapshot(setupSk);

  // ------------------------------------------------------------------ setup pose: IK must not move it
  for (const c of data.constraints) {
    if (!(c instanceof spine.IkConstraintData) || c.setupPose.mix <= 0) continue;
    for (const bd of c.bones) {
      const b = setupSk.bones[bd.index];
      const d = Math.abs(((b.appliedPose.rotation - bd.setupPose.rotation + 540) % 360) - 180);
      if (d > 1) err(`IK "${c.name}": the setup pose moves ${bd.name} by ${d.toFixed(1)} deg (bendPositive or target position wrong)`);
    }
  }

  // ------------------------------------------------------------------ proportions (setup attachments)
  const excl = new Set(CC.proportions.excludeSlots);
  const headIdx = data.findBone('head')?.index;
  const underHead = (bone) => {
    for (let b = bone; b; b = b.parent) if (b.data.index === headIdx) return true;
    return false;
  };
  const all = bounds(setupSk, (sl) => !sl.bone.data.name.startsWith('fx_'));
  const head = bounds(setupSk, (sl) => !sl.bone.data.name.startsWith('fx_') && !excl.has(sl.data.name) && underHead(sl.bone));
  if (Number.isFinite(all.y0) && Number.isFinite(head.y0)) {
    const H = all.y1 - all.y0;
    const h = head.y1 - head.y0;
    const f = h / H;
    report.proportions = { height: Math.round(H * 10) / 10, head: Math.round(h * 10) / 10, headFraction: Math.round(f * 1e4) / 1e4, headMax: CC.proportions.headMax };
    info(`proportions: head ${h.toFixed(0)} of ${H.toFixed(0)} units = ${(f * 100).toFixed(1)}% (adult gate <= ${CC.proportions.headMax * 100}%, ART_BIBLE 7)`);
    if (f > CC.proportions.headMax + 1e-4) err(`proportions: head is ${(f * 100).toFixed(1)}% of the height > ${CC.proportions.headMax * 100}% (child-coded; Stake rejects it)`);
    if (all.y0 < -8) warn(`setup pose reaches ${(-all.y0).toFixed(0)} units below root (root is the feet point; padding + half an outline is 8)`);
  } else err('proportions: no head attachments under the head bone');

  // ------------------------------------------------------------------ look-at response
  const lookBone = data.findBone(CC.look.bone);
  if (lookBone) {
    const probe = (dx, dy) => {
      const s = new spine.Skeleton(data);
      s.setupPose();
      const lb = s.findBone(CC.look.bone);
      lb.pose.x += dx;
      lb.pose.y += dy;
      s.updateWorldTransform(spine.Physics.none);
      return s;
    };
    const base = probe(0, 0);
    const up = probe(0, 100);
    const hd = (s) => s.findBone('head').appliedPose.getWorldRotationX();
    const dr = hd(up) - hd(base);
    info(`look-at: ctrl_look +100 up turns the head ${dr.toFixed(1)} deg`);
    if (Math.abs(dr) < 0.5) err(`look-at: the head turns ${dr.toFixed(1)} deg for a 100-unit ctrl_look offset: the look constraint is dead (mix 0 or wrong source); DESIGN 16 needs heads tracking the wilds`);
    else if (Math.abs(dr) > 30) warn(`look-at: the head turns ${dr.toFixed(1)} deg for a 100-unit look offset (expected 0.5-30)`);
  }

  // ------------------------------------------------------------------ clips
  const required = new Set([...CC.requiredClips, ...Object.keys(spec?.clips ?? {})]);
  for (const n of required) if (!data.findAnimation(n)) err(`missing required clip "${n}"${spec?.clips?.[n] ? ` (ANIMATION_SET: ${spec.clips[n].frames} f)` : ''}`);
  for (const a of data.animations) if (!clipRule(a.name)) warn(`clip "${a.name}" is not in the contract clip table`);
  const idle = data.findAnimation('idle');
  const idleStart = idle ? sample(idle, 0) : null;
  const physCons = data.constraints.filter((c) => c instanceof spine.PhysicsConstraintData);
  const ikCons = data.constraints.filter((c) => c instanceof spine.IkConstraintData);
  const stateData = new spine.AnimationStateData(data);

  for (const anim of data.animations) {
    const rule = clipRule(anim.name) ?? { loop: false, frames: [0, 1e9], track: 0 };
    const frames = Math.round(anim.duration * FPS * 1000) / 1000;
    const track = rule.track ?? 0;
    const rep = { frames, loop: !!rule.loop, track, events: [] };
    report.animations[anim.name] = rep;
    if (typeof rule.frames === 'number') {
      if (Math.abs(frames - rule.frames) > 1e-3) err(`${anim.name}: ${frames} frames, ANIMATION_SET says ${rule.frames}`);
    } else if (rule.frames && (frames < rule.frames[0] - 1e-3 || frames > rule.frames[1] + 1e-3)) err(`${anim.name}: ${frames} frames outside the contract window ${rule.frames.join('-')}`);
    if (Math.abs(frames - Math.round(frames)) > 0.02) warn(`${anim.name}: duration ${anim.duration}s is not a whole number of ${FPS} fps frames`);

    // step on the runtime: body clips on track 0; overlays additive on track 1 over idle; face on track 2 over idle
    const run = (withPhysics) => {
      const s = new spine.Skeleton(data);
      s.setupPose();
      s.updateWorldTransform(spine.Physics.reset);
      const st = new spine.AnimationState(stateData);
      if (track !== 0 && idle) st.setAnimation(0, 'idle', true);
      const e = st.setAnimation(track, anim.name, !!rule.loop);
      if (track === 1) e.additive = true;
      return { s, st, e };
    };
    const A = run(true);
    const B = run(false);
    const fired = [];
    A.e.listener = { event: (_e, ev) => fired.push({ name: ev.data.name, frame: Math.round(ev.time * FPS * 100) / 100, string: ev.stringValue || undefined }) };
    const dt = 1 / 60;
    const clipSteps = Math.ceil((anim.duration + 2 / FPS) / dt) + 1;
    const holdSteps = rule.loop || track !== 0 ? 0 : 150; // one-shots: hold the last frame 2.5 s; springs must be still 2.0-2.5 s after the end
    let nanAt = -1;
    const physMax = {};
    const settle = {};
    let ikMiss = 0;
    let ikWorst = 0;
    let ikWorstName = '';
    for (let i = 0; i <= clipSteps + holdSteps; i++) {
      const d = i === 0 ? 0 : dt;
      for (const { s, st } of [A, B]) {
        st.update(d);
        s.update(d);
        st.apply(s);
      }
      A.s.updateWorldTransform(spine.Physics.update);
      B.s.updateWorldTransform(spine.Physics.none);
      let bad = false;
      for (const b of A.s.bones) {
        const p = b.appliedPose;
        if (nan(p.worldX) || nan(p.worldY) || nan(p.a) || nan(p.b) || nan(p.c) || nan(p.d)) bad = true;
      }
      if (bad && nanAt < 0) nanAt = i;
      for (const pc of physCons) {
        const a = A.s.bones[pc.bone.index].appliedPose;
        const b = B.s.bones[pc.bone.index].appliedPose;
        const rot = Math.abs(((a.getWorldRotationX() - b.getWorldRotationX() + 540) % 360) - 180);
        const mv = Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
        const m = (physMax[pc.name] ??= { rot: 0, move: 0 });
        if (i <= clipSteps) {
          m.rot = Math.max(m.rot, rot);
          m.move = Math.max(m.move, mv);
        } else if (i > clipSteps + holdSteps - 30) {
          const q = (settle[pc.name] ??= { rot: 0, move: 0 });
          q.rot = Math.max(q.rot, rot);
          q.move = Math.max(q.move, mv);
        }
      }
      if (i <= clipSteps) {
        for (const c of ikCons) {
          const k = A.s.constraints[data.constraints.indexOf(c)];
          if (k.appliedPose.mix < 0.999 || c.bones.length !== 2) continue; // partial IK/FK blends miss by design
          const child = A.s.bones[c.bones[1].index].appliedPose;
          const L = c.bones[1].length;
          const tx = child.worldX + L * child.a;
          const ty = child.worldY + L * child.c;
          const t = A.s.bones[c.target.index].appliedPose;
          const miss = Math.hypot(tx - t.worldX, ty - t.worldY);
          if (miss > 3) {
            ikMiss++;
            if (miss > ikWorst) [ikWorst, ikWorstName] = [miss, c.name];
          }
        }
      }
    }
    if (nanAt >= 0) err(`${anim.name}: NaN in the pose at step ${nanAt} (60 Hz with physics)`);
    rep.events = fired;
    rep.physics = Object.fromEntries(Object.entries(physMax).map(([k, v]) => [k, { rot: Math.round(v.rot * 10) / 10, move: Math.round(v.move * 10) / 10 }]));
    for (const [n, v] of Object.entries(physMax)) {
      if (v.rot > 75) warn(`${anim.name}: spring ${n} swings ${v.rot.toFixed(0)} deg off the keyed pose (floppy / unstable)`);
      if (v.move > 90) warn(`${anim.name}: spring ${n} moves ${v.move.toFixed(0)} units off the keyed pose`);
    }
    for (const [n, v] of Object.entries(settle)) {
      if (v.rot > 1 || v.move > 1) warn(`${anim.name}: spring ${n} has not settled 2 s after the end (${v.rot.toFixed(1)} deg, ${v.move.toFixed(1)} units): too little damping`);
    }
    if (ikMiss) {
      rep.ikMiss = { steps: ikMiss, worst: Math.round(ikWorst * 10) / 10, constraint: ikWorstName };
      warn(`${anim.name}: IK "${ikWorstName}" misses its target by up to ${ikWorst.toFixed(0)} units in ${ikMiss} steps (planted limb pops; lower the hips or move the target)`);
    }

    // events on their frames
    for (const ev of rule.events ?? []) {
      const f = fired.find((x) => x.name === ev.name && (x.string ?? null) === (ev.string ?? null));
      const label = `${ev.name}${ev.string ? `:${ev.string}` : ''}`;
      if (!f) err(`${anim.name}: event ${label} did not fire (ANIMATION_SET: frame ${ev.frame})`);
      else if (Math.abs(f.frame - ev.frame) > 1.02) err(`${anim.name}: event ${label} on frame ${f.frame}, ANIMATION_SET says ${ev.frame}`);
      else if (Math.abs(f.frame - ev.frame) > 0.02) warn(`${anim.name}: event ${label} on frame ${f.frame}, target ${ev.frame}`);
    }
    for (const f of fired) {
      if (f.name === 'sfx' && !(rule.events ?? []).some((e) => e.name === 'sfx' && e.string === f.string))
        warn(`${anim.name}: sfx ${f.string} at frame ${f.frame} is not in ANIMATION_SET`);
    }

    // seams / hand-offs / overlay deltas (keyed pose, physics excluded)
    const additive = track === 1;
    const first = sample(anim, 0, additive);
    const last = sample(anim, anim.duration, additive);
    if (rule.loop) {
      const d = diff(first, last);
      rep.seam = Math.round(d.d * 1000) / 1000;
      if (d.d > TOL) err(`${anim.name}: loop seam differs by ${d.d.toFixed(3)} (${d.why}); first and last key must match`);
    }
    if (track === 1) {
      for (const [when, snap] of [['first', first], ['last', last]]) {
        const d = diff(snap, setupSnap);
        if (d.d > TOL && d.d !== Infinity) err(`${anim.name}: additive overlay ${when} frame is not a zero delta (${d.d.toFixed(3)}, ${d.why})`);
      }
    }
    if (rule.endsAt && data.findAnimation(rule.endsAt)) {
      const d = diff(last, sample(data.findAnimation(rule.endsAt), 0));
      if (d.d > TOL) err(`${anim.name}: last pose != first pose of ${rule.endsAt} (diff ${d.d.toFixed(3)}, ${d.why}); the mix is 0`);
    } else if (track === 0 && !rule.loop && idleStart && anim.name !== 'idle') {
      const d = diff(last, idleStart);
      rep.endVsIdle = Number.isFinite(d.d) ? Math.round(d.d * 100) / 100 : 'attachments';
      if (d.d > 1.0) warn(`${anim.name}: ends ${Number.isFinite(d.d) ? `${d.d.toFixed(1)} away from` : 'with other attachments than'} idle's first pose (${d.why}); the return crossfade will swim`);
    }
  }

  // ------------------------------------------------------------------ atlas
  if (atlasPath && atlas) {
    if (atlas.pages.length > CC.atlas.pages) err(`atlas: ${atlas.pages.length} pages > ${CC.atlas.pages} (ANIMATION_SET 10: one page per character)`);
    for (const p of atlas.pages) if (p.width > CC.atlas.maxPage || p.height > CC.atlas.maxPage) err(`atlas page ${p.name}: ${p.width}x${p.height} > ${CC.atlas.maxPage}`);
  }
  void raw;
}
