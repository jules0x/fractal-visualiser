import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ITER_MAX,
  ITER_MIN,
  adaptScale,
  clampFlight,
  decayFlight,
  iterationsFromSlider,
  sensitivityScale,
  sliderFromIterations,
  thrustFromWheel,
  FLIGHT_MAX,
} from '../src/core/tuning.ts';

test('iteration curve spends its travel where the useful values are', () => {
  assert.equal(iterationsFromSlider(0), ITER_MIN);
  assert.equal(iterationsFromSlider(1), ITER_MAX);

  // Half travel should land well under half the range — that is the whole
  // point of the curve, and what the linear slider got wrong.
  const mid = iterationsFromSlider(0.5);
  assert.ok(mid < ITER_MAX * 0.3, `half travel gave ${mid}`);
  assert.ok(mid > 800, `half travel gave ${mid}, too coarse to be useful`);

  // Monotonic, and fine-grained at the bottom end.
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const v = iterationsFromSlider(t);
    assert.ok(v >= prev, 'curve must not go backwards');
    prev = v;
  }
  assert.ok(iterationsFromSlider(0.1) - ITER_MIN < 120, 'low end should creep, not leap');
});

test('iteration curve round-trips through its inverse', () => {
  for (const n of [80, 200, 400, 1200, 3000, 6000]) {
    assert.equal(iterationsFromSlider(sliderFromIterations(n)), n);
  }
  // And clamps rather than extrapolating.
  assert.equal(sliderFromIterations(1), 0);
  assert.equal(sliderFromIterations(99999), 1);
});

test('the old ceiling is gone', () => {
  assert.ok(ITER_MAX <= 6000, 'the 20000 ceiling was unusable');
});

test('shape controls ease off as the view deepens', () => {
  assert.equal(sensitivityScale(0), 1);
  const surface = sensitivityScale(0);
  const deep = sensitivityScale(Math.log2(1e17));
  const deeper = sensitivityScale(Math.log2(1e60));

  assert.ok(deep < surface / 10, `only damped to ${deep} at 1e17`);
  assert.ok(deeper < deep, 'must keep easing off with depth');
  assert.ok(deeper > 0, 'must never reach zero, or the control dies');

  // One drag should stay worth a similar fraction of the visible structure.
  assert.ok(Math.abs(deep * 18 - 1) < 0.2, `expected ~1/18 at 1e17, got ${deep}`);
});

test('wheel thrust is normalised across browser delta units', () => {
  // Same physical gesture, three different reporting modes.
  const pixels = thrustFromWheel(-120, 0);
  const lines = thrustFromWheel(-7.5, 1);
  assert.ok(pixels > 0 && lines > 0, 'scrolling up must zoom in');
  assert.ok(Math.abs(pixels - lines) < 0.2, `${pixels} vs ${lines} — units not normalised`);
  assert.ok(thrustFromWheel(120, 0) < 0, 'scrolling down must zoom out');

  // A violent trackpad flick must not launch you into the abyss.
  assert.ok(Math.abs(thrustFromWheel(-99999, 0)) <= 3);
});

test('flight accelerates on repeated pushes but stays capped', () => {
  let v = 0;
  for (let i = 0; i < 20; i++) v = clampFlight(v + thrustFromWheel(-120, 0));
  assert.ok(v > 1, 'repeated flicks should build speed');
  assert.ok(v <= FLIGHT_MAX, `velocity escaped the cap at ${v}`);
});

test('flight coasts down and then stops dead', () => {
  let v = 4;
  for (let i = 0; i < 60; i++) v = decayFlight(v, 1 / 60, false);
  assert.ok(v < 4 && v > 0, `after a second it should have slowed, got ${v}`);

  let guard = 0;
  while (v !== 0 && guard++ < 10000) v = decayFlight(v, 1 / 60, false);
  assert.equal(v, 0, 'must settle exactly, not creep forever');
  assert.ok(guard < 10000, 'took too long to settle');
});

test('cruise hold keeps the speed exactly', () => {
  let v = 2.5;
  for (let i = 0; i < 600; i++) v = decayFlight(v, 1 / 60, true);
  assert.equal(v, 2.5);
});

test('the shape-control window narrows with depth but never shuts', () => {
  // What relativeSlider spans: a fixed base times the damping factor.
  const base = 0.35;
  const at = (zoom: number) => base * sensitivityScale(Math.log2(zoom));

  assert.ok(Math.abs(at(1) - base) < 1e-9, 'full width at the surface');
  assert.ok(at(1e6) < base / 5, 'should have tightened noticeably by 1e6');
  assert.ok(at(1e60) < at(1e17), 'must keep tightening');
  assert.ok(at(1e300) > 0, 'a zero-width window would be a dead control');

  // One sweep of the track should stay worth a comparable slice of the visible
  // structure: window over view-radius wants to stay within an order or two.
  for (const zoom of [1e3, 1e10, 1e40]) {
    const ratio = at(zoom) / (2 / zoom);
    assert.ok(Number.isFinite(ratio) && ratio > 0, `degenerate at ${zoom}`);
  }
});

test('render scale falls under load and recovers, within bounds', () => {
  let s = 1;
  for (let i = 0; i < 40; i++) s = adaptScale(s, 12);
  assert.equal(s, 0.25, 'should bottom out at the floor, not below');

  for (let i = 0; i < 60; i++) s = adaptScale(s, 120);
  assert.equal(s, 1, 'should climb back to full, not overshoot');

  // A rate inside the hysteresis gap holds where it is — that is the point of
  // the gap, and it means this is the resolution the machine sustains.
  assert.equal(adaptScale(0.6, 51), 0.6);
});

/**
 * The regression this exists for.
 *
 * Recovery used to require more than 75 fps. On a 60 Hz display vsync makes
 * that number unreportable, so the condition to climb back could never be met
 * and the first stutter of a session cost the resolution permanently. Falling
 * was also three times quicker than climbing.
 */
test('render scale recovers on a vsync-capped display, as fast as it fell', () => {
  const travel = (from: number, fps: number, stop: (s: number) => boolean) => {
    let s = from;
    let n = 0;
    while (!stop(s) && n < 500) {
      s = adaptScale(s, fps);
      n++;
    }
    return n;
  };

  // A 60 Hz display can never report more than 60, so 60 has to be enough.
  for (const refresh of [60, 75, 120, 144]) {
    let s = 0.25;
    for (let i = 0; i < 60; i++) s = adaptScale(s, refresh);
    assert.equal(s, 1, `${refresh} fps should climb all the way back to full`);
  }

  assert.equal(
    travel(1, 20, (s) => s <= 0.25),
    travel(0.25, 60, (s) => s >= 1),
    'down and up should take the same travel',
  );
});
