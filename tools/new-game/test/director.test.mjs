// EnvironmentDirector (src/environment/director.ts): every background state, the flash limiter,
// reduced motion and hit-stop freezing. Run: pnpm test:kit
//   node --experimental-transform-types --import ./tools/new-game/test/register.mjs --test tools/new-game/test/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvironmentDirector } from '../../../src/environment/director.ts';
import { ENV_TIMING as T } from '../../../src/environment/spec.ts';

const COLORS = { anticipation: 0xffd54a, bigwin: 0xffc23f, feature: 0xff4f6a };

const make = (opts = {}) => {
  const looks = [];
  const states = [];
  const d = new EnvironmentDirector(
    { reduced: () => !!opts.reduced, look: (w) => looks.push(w), state: (s) => states.push(s) },
    COLORS,
  );
  return { d, looks, states };
};
/** step `seconds` of game time at 60 fps; returns the max/min of a channel over the window */
const run = (d, seconds, ch) => {
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    d.update(1 / 60, 1000 / 60);
    if (ch) {
      max = Math.max(max, d.value(ch));
      min = Math.min(min, d.value(ch));
    }
  }
  return { max, min };
};

test('spin holds a lean-in that land releases', () => {
  const { d } = make();
  d.spinStart();
  assert.equal(d.state, 'spin');
  run(d, 1.5);
  assert.ok(Math.abs(d.value('zoom') - T.spin.zoom) < T.spin.zoom * 0.1, `zoom ${d.value('zoom')}`);
  d.land(1);
  assert.equal(d.state, 'land');
  assert.ok(!d.activeHolds().includes('spin'));
  run(d, 2);
  assert.ok(Math.abs(d.value('zoom')) < 0.002, `zoom settles, got ${d.value('zoom')}`);
});

test('land kicks the parallax down and springs back', () => {
  const { d } = make();
  d.land(1.6);
  const { max } = run(d, 0.3, 'lift');
  const want = T.land.lift * 1.6;
  assert.ok(Math.abs(max - want) < want * 0.2, `lift peak ${max} ~ ${want}`);
  run(d, 1.5);
  assert.ok(Math.abs(d.value('lift')) < 0.2, `lift settles, got ${d.value('lift')}`);
});

test('connect lights and tints toward the winner, tumble releases it', () => {
  const { d } = make();
  d.wins(0x33ff66);
  assert.equal(d.state, 'connect');
  assert.equal(d.color, 0x33ff66);
  run(d, 1.5);
  assert.ok(d.value('tint') > 0.9, `tint ${d.value('tint')}`);
  assert.ok(d.value('light') > T.connect.light * 0.9, `light ${d.value('light')}`);
  d.tumble();
  run(d, 2);
  assert.ok(d.value('tint') < 0.05, `tint released, got ${d.value('tint')}`);
});

test('explode kicks light + zoom; a second flash inside the gap is softened (<= 3/s)', () => {
  const a = make().d;
  a.burst();
  assert.equal(a.state, 'explode');
  const first = run(a, 0.25, 'light').max;

  const b = make().d;
  b.burst();
  run(b, 0.1); // 100 ms later: inside flashGapMs
  b.burst();
  const second = run(b, 0.25, 'light').max;

  const c = make().d;
  c.burst();
  run(c, 0.5); // 500 ms later: outside the gap
  c.burst();
  const third = run(c, 0.25, 'light').max;

  // kicks peak at their amplitude (+ the idle breath, <= T.idle.breathe)
  assert.ok(Math.abs(first - T.explode.light) < T.explode.light * 0.2 + T.idle.breathe, `first flash ${first} ~ ${T.explode.light}`);
  assert.ok(second < third, `limited ${second} < unlimited ${third}`);
});

test('a dead spin is a timed miss that returns to idle', () => {
  const { d, states } = make();
  d.spinStart();
  d.roundEnd(0);
  assert.equal(d.state, 'miss');
  const { max } = run(d, T.miss.holdMs / 1000, 'dim');
  assert.ok(max > T.miss.dim * 0.5, `dim ${max}`);
  run(d, 0.2);
  assert.equal(d.state, 'idle');
  run(d, 3);
  assert.ok(d.value('dim') < 0.01, `dim recovers, got ${d.value('dim')}`);
  assert.deepEqual(states.slice(0, 2), ['spin', 'miss']);
});

test('a winning round ends idle, a big win holds until the round ends', () => {
  const { d } = make();
  d.bigWin();
  assert.equal(d.state, 'bigwin');
  run(d, 1);
  assert.ok(d.value('light') > T.bigwin.light * 0.8);
  d.roundEnd(500);
  assert.equal(d.state, 'idle');
  assert.deepEqual(d.activeHolds(), []);
});

test('anticipation only when the reveal says so', () => {
  const { d } = make();
  d.reveal(false);
  assert.equal(d.state, 'idle');
  d.reveal(true);
  assert.equal(d.state, 'anticipation');
  assert.equal(d.color, COLORS.anticipation);
  run(d, 1.5);
  assert.ok(d.value('dim') > T.anticipation.dim * 0.8);
  d.wins(0xffffff);
  assert.ok(!d.activeHolds().includes('anticipation'));
});

test('feature trigger + mode change crossfade the look once', () => {
  const { d, looks } = make();
  d.featureTrigger();
  assert.equal(d.state, 'feature');
  const tint = run(d, 0.6, 'tint').max;
  assert.ok(Math.abs(tint - 1) < 0.2, `critically damped tint kick peaks ~1, got ${tint}`);
  d.mode('freegame');
  d.mode('freegame');
  d.mode('basegame');
  assert.deepEqual(looks, ['feature', 'base']);
});

test('reduced motion removes zoom and lift, keeps light', () => {
  const { d } = make({ reduced: true });
  d.spinStart();
  d.land(1.6);
  d.burst();
  const zoom = run(d, 0.5, 'zoom');
  assert.equal(zoom.max, 0);
  assert.equal(zoom.min, 0);
  assert.equal(d.value('lift'), 0);
  assert.ok(d.value('light') > 0);
});

test('hit-stop (dt 0) freezes the springs', () => {
  const { d } = make();
  d.land(1);
  run(d, 0.05);
  const before = d.value('lift');
  for (let i = 0; i < 10; i++) d.update(0, 16);
  assert.equal(d.value('lift'), before);
});

test('reset drops every hold and settles at rest', () => {
  const { d } = make();
  d.spinStart();
  d.reveal(true);
  d.bigWin();
  run(d, 0.5);
  d.reset();
  assert.equal(d.state, 'idle');
  assert.deepEqual(d.activeHolds(), []);
  assert.equal(d.value('zoom'), 0);
});
